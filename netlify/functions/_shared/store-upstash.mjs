// Minimal Upstash REST client (no extra deps).
import { klog } from "./supabase-admin.mjs";

const BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USER_PROFILE_PREFIX = "kcswh:xp:user:";
const FORCE_MEMORY_STORE = process.env.XP_TEST_MODE === "1";

// Track whether we're using memory store (for fallback logic)
export const isMemoryStore = FORCE_MEMORY_STORE || !BASE || !TOKEN;

// Log memory-store fallback once on cold start
let didLogMemoryFallback = false;
if (isMemoryStore && !didLogMemoryFallback) {
  didLogMemoryFallback = true;
  klog("upstash_env_missing_falling_back_to_memory", {
    hasBase: !!BASE,
    hasToken: !!TOKEN,
    forcedForTest: FORCE_MEMORY_STORE,
  });
}

function createMemoryStore() {
  const memory = new Map();

  function sweep(key) {
    const entry = memory.get(key);
    if (!entry) return null;
    if (entry.expiry && entry.expiry <= Date.now()) {
      memory.delete(key);
      return null;
    }
    return entry;
  }

  function getValue(key) {
    const entry = sweep(key);
    return entry ? entry.value : null;
  }

  function setValue(key, value, ttlMs) {
    memory.set(key, {
      value: String(value),
      expiry: typeof ttlMs === "number" ? Date.now() + ttlMs : null,
    });
  }

  function setExpiryMs(key, ttlMs) {
    if (!ttlMs || ttlMs <= 0) return;
    const entry = sweep(key);
    if (!entry) return;
    setValue(key, entry.value, ttlMs);
  }

  function remainingTtlMs(entry) {
    if (!entry || entry.expiry == null) return null;
    return Math.max(0, entry.expiry - Date.now());
  }

  return {
    async get(key) { return getValue(key); },
    async set(key, value) { setValue(key, value, null); return "OK"; },
    async setex(key, seconds, value) { setValue(key, value, seconds * 1000); return "OK"; },
    async incrBy(key, delta) {
      const entry = sweep(key);
      const prev = Number(entry?.value ?? "0");
      const current = prev + Number(delta);
      setValue(key, current, remainingTtlMs(entry));
      return current;
    },
    async decrBy(key, delta) {
      const entry = sweep(key);
      const prev = Number(entry?.value ?? "0");
      const current = prev - Number(delta);
      setValue(key, current, remainingTtlMs(entry));
      return current;
    },
    async expire(key, seconds) {
      const entry = sweep(key);
      if (!entry) return 0;
      setValue(key, entry.value, seconds * 1000);
      return 1;
    },
    async ttl(key) {
      const entry = sweep(key);
      if (!entry) return -2;
      if (entry.expiry == null) return -1;
      const ttl = entry.expiry - Date.now();
      return ttl > 0 ? Math.ceil(ttl / 1000) : -2;
    },
    async del(key) {
      return memory.delete(key) ? 1 : 0;
    },
    async eval(_script, keys = [], argv = []) {
      // Memory impl supports only v2 delta script signature [sessionKey, sessionSyncKey, dailyKey, totalKey, lockKey] x [now, delta, dailyCap, sessionCap, ts, lockTtl, sessionTtl].
      if (keys.length === 5 && argv.length === 7) {
        const [sessionKey, sessionSyncKey, dailyKey, totalKey, lockKey] = keys;
        const now = Number(argv[0]);
        const delta = Number(argv[1]);
        const dailyCap = Number(argv[2]);
        const sessionCap = Number(argv[3]);
        const ts = Number(argv[4]);
        const lockTtl = Number(argv[5]);
        const sessionTtlMs = Number(argv[6]);

        const lockEntry = sweep(lockKey);
        if (lockEntry) {
          const currentDaily = Number(getValue(dailyKey) ?? "0");
          const sessionTotalLocked = Number(getValue(sessionKey) ?? "0");
          const lifetimeLocked = Number(getValue(totalKey) ?? "0");
          const lastSyncLocked = Number(getValue(sessionSyncKey) ?? "0");
          return [0, currentDaily, sessionTotalLocked, lifetimeLocked, lastSyncLocked, 6];
        }

        setValue(lockKey, now, lockTtl);

        const release = () => { memory.delete(lockKey); };

        // Wrap all operations after lock acquisition in try block to ensure cleanup
        try {
          let sessionTotal = Number(getValue(sessionKey) ?? "0");
          let lastSync = Number(getValue(sessionSyncKey) ?? "0");
          let dailyTotal = Number(getValue(dailyKey) ?? "0");
          let lifetime = Number(getValue(totalKey) ?? "0");
          if (lastSync > 0 && ts <= lastSync) {
            return [0, dailyTotal, sessionTotal, lifetime, lastSync, 2];
          }

          const remainingDaily = dailyCap - dailyTotal;
          if (remainingDaily <= 0) {
            return [0, dailyTotal, sessionTotal, lifetime, lastSync, 3];
          }

          const remainingSession = sessionCap - sessionTotal;
          if (remainingSession <= 0) {
            return [0, dailyTotal, sessionTotal, lifetime, lastSync, 5];
          }

          let grant = delta;
          let status = 0;
          if (grant > remainingDaily) {
            grant = remainingDaily;
            status = 1;
          }
          if (grant > remainingSession) {
            grant = remainingSession;
            status = 4;
          }

          if (grant <= 0) {
            if (ts > lastSync) {
              lastSync = ts;
              setValue(sessionSyncKey, lastSync, sessionTtlMs > 0 ? sessionTtlMs : null);
            }
            if (sessionTtlMs > 0) setExpiryMs(sessionKey, sessionTtlMs);
            return [0, dailyTotal, sessionTotal, lifetime, lastSync, status];
          }

          dailyTotal += grant;
          sessionTotal += grant;
          lifetime += grant;
          lastSync = ts;

          setValue(dailyKey, dailyTotal, null);
          setValue(sessionKey, sessionTotal, sessionTtlMs > 0 ? sessionTtlMs : null);
          setValue(totalKey, lifetime, null);
          setValue(sessionSyncKey, lastSync, sessionTtlMs > 0 ? sessionTtlMs : null);

          return [grant, dailyTotal, sessionTotal, lifetime, lastSync, status];
        } finally {
          release();
        }
      }

      throw new Error("Unsupported eval signature in memory store");
    },
  };
}

async function call(cmd, ...args) {
  const url = `${BASE}/${cmd}/${args.map(encodeURIComponent).join("/")}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash ${cmd} failed: ${res.status}`);
  const data = await res.json();
  return data.result;
}

const remoteStore = {
  async get(key) { return call("GET", key); },
  async set(key, value) { return call("SET", key, String(value)); },
  async setex(key, seconds, value) { return call("SETEX", key, String(seconds), String(value)); },
  async incrBy(key, delta) { return call("INCRBY", key, String(delta)); },
  async decrBy(key, delta) { return call("DECRBY", key, String(delta)); },
  async expire(key, seconds) { return call("EXPIRE", key, String(seconds)); },
  async ttl(key) { return call("TTL", key); },
  async del(key) { return call("DEL", key); },
  async eval(script, keys = [], argv = []) {
    // Upstash REST API expects array format: ["eval", script, numkeys, key1, key2, ..., arg1, arg2, ...]
    // The command name must be included as the first element when POSTing to the root endpoint
    // See: https://github.com/upstash/redis-js/blob/main/pkg/commands/eval.ts
    const body = ["eval", script, keys.length, ...keys, ...argv];
    const res = await fetch(BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Intentionally mutating properties on const object for cleaner code
      const logPayload = {
        op: "eval",
        status: res.status,
        statusText: res.statusText,
        keysCount: Array.isArray(keys) ? keys.length : 0,
        argvCount: Array.isArray(argv) ? argv.length : 0,
      };
      try {
        const rawBody = await res.text();
        logPayload.bodyPreview = rawBody.slice(0, 500);
        logPayload.bodyTruncated = rawBody.length > 500;
      } catch {
        logPayload.bodyPreview = "unavailable";
      }
      klog("upstash_eval_failed", logPayload);
      throw new Error(`Upstash eval failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return data.result;
  },
};

export const store = isMemoryStore ? createMemoryStore() : remoteStore;

/**
 * Rate limit increment with TTL.
 * Atomic in Upstash via Lua EVAL; memory fallback is best-effort (non-atomic).
 * Returns { count, ttlSet } where ttlSet indicates if TTL was (re)applied.
 */
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local ttl_seconds = tonumber(ARGV[1])
local count = redis.call('INCR', key)
local current_ttl = redis.call('TTL', key)
if current_ttl < 0 then
  redis.call('EXPIRE', key, ttl_seconds)
  return {count, 1}
end
return {count, 0}
`;

export async function atomicRateLimitIncr(key, ttlSeconds = 60) {
  // Memory store doesn't support the rate-limit Lua script; use non-atomic fallback
  if (isMemoryStore) {
    const count = await store.incrBy(key, 1);
    const ttl = await store.ttl(key);
    if (ttl < 0) {
      await store.expire(key, ttlSeconds);
      return { count, ttlSet: true };
    }
    return { count, ttlSet: false };
  }

  // Upstash: use atomic Lua script (let errors propagate to caller)
  const result = await store.eval(RATE_LIMIT_SCRIPT, [key], [String(ttlSeconds)]);
  if (Array.isArray(result)) {
    return { count: Number(result[0]) || 0, ttlSet: result[1] === 1 };
  }
  return { count: Number(result) || 0, ttlSet: false };
}

const clampTotalXp = (value) => {
  const parsed = Math.floor(Number(value) || 0);
  return parsed < 0 ? 0 : parsed;
};

const profileKey = (userId) => `${USER_PROFILE_PREFIX}${userId}`;

export async function getUserProfile(userId) {
  if (!userId) return null;
  try {
    const raw = await store.get(profileKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const totalXp = clampTotalXp(parsed.totalXp ?? parsed.total ?? 0);
    const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : null;
    const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : createdAt;
    return { userId, totalXp, createdAt, updatedAt };
  } catch {
    return null;
  }
}

export async function saveUserProfile({ userId, totalXp, now = Date.now() }) {
  if (!userId) return null;
  const existing = await getUserProfile(userId);
  const timestamp = new Date(now).toISOString();
  const profile = {
    userId,
    totalXp: clampTotalXp(totalXp),
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
  try {
    await store.set(profileKey(userId), JSON.stringify(profile));
    return profile;
  } catch (err) {
    klog("upstash_save_user_profile_failed", { userId, error: err?.message });
    return existing || profile;
  }
}
