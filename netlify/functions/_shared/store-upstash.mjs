// Minimal Upstash REST client (no extra deps).
const BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USER_PROFILE_PREFIX = "kcswh:xp:user:";
const ANON_PROFILE_PREFIX = "kcswh:xp:anon:";

function logStoreError(message, meta) {
  if (typeof klog === "function") {
    klog(message, meta || {});
  } else {
    console.error(message, meta || {});
  }
}

if (!BASE || !TOKEN) {
  console.warn("[store-upstash] Missing UPSTASH env; falling back to in-memory store.");
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

  const pipelineFactory = () => {
    const operations = [];
    return {
      operations,
      incrby(key, value) {
        operations.push({ op: "incrby", key, value });
        const entry = sweep(key);
        const current = Number(entry?.value ?? "0");
        setValue(key, current + Number(value), remainingTtlMs(entry));
        return this;
      },
      decrby(key, value) {
        operations.push({ op: "decrby", key, value });
        const entry = sweep(key);
        const current = Number(entry?.value ?? "0");
        setValue(key, current - Number(value), remainingTtlMs(entry));
        return this;
      },
      del(key) {
        operations.push({ op: "del", key });
        memory.delete(key);
        return this;
      },
      set(key, value) {
        operations.push({ op: "set", key, value });
        setValue(key, value, null);
        return this;
      },
      exec() {
        return Promise.resolve(operations);
      },
    };
  };

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

        let sessionTotal = Number(getValue(sessionKey) ?? "0");
        let lastSync = Number(getValue(sessionSyncKey) ?? "0");
        let dailyTotal = Number(getValue(dailyKey) ?? "0");
        let lifetime = Number(getValue(totalKey) ?? "0");

        try {
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
    pipeline: () => pipelineFactory(),
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
      // Log the actual error response for debugging
      let errorDetail = "";
      try {
        const errorBody = await res.text();
        errorDetail = `: ${errorBody}`;
        logStoreError(`[Upstash] eval failed with status ${res.status}${errorDetail}`);
      } catch {
        logStoreError(`[Upstash] eval failed with status ${res.status} (could not read error body)`);
      }
      throw new Error(`Upstash eval failed: ${res.status}${errorDetail}`);
    }
    const data = await res.json();
    return data.result;
  },
  pipeline() {
    const operations = [];
    const execOps = async () => {
      for (const op of operations) {
        if (op.op === "incrby") await remoteStore.incrBy(op.key, op.value);
        else if (op.op === "decrby") await remoteStore.decrBy(op.key, op.value);
        else if (op.op === "del") await call("DEL", op.key);
        else if (op.op === "set") await remoteStore.set(op.key, op.value);
      }
      return operations;
    };
    return {
      operations,
      incrby(key, value) { operations.push({ op: "incrby", key, value }); return this; },
      decrby(key, value) { operations.push({ op: "decrby", key, value }); return this; },
      del(key) { operations.push({ op: "del", key }); return this; },
      set(key, value) { operations.push({ op: "set", key, value }); return this; },
      exec: execOps,
    };
  },
};

export const store = (!BASE || !TOKEN) ? createMemoryStore() : remoteStore;

const clampTotalXp = (value) => {
  const parsed = Math.floor(Number(value) || 0);
  return parsed < 0 ? 0 : parsed;
};

const profileKey = (userId) => `${USER_PROFILE_PREFIX}${userId}`;
const anonProfileKey = (anonId) => `${ANON_PROFILE_PREFIX}${anonId}`;

export async function getUserProfile(userId) {
  if (!userId) return null;
  try {
    const raw = await store.get(profileKey(userId));
    const nowIso = new Date().toISOString();
    if (!raw) {
      return {
        userId,
        totalXp: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
        hasConvertedAnonXp: false,
        anonConversionCompleted: false,
        convertedFromAnonId: null,
        anonConversionAt: null,
      };
    }
    const parsed = JSON.parse(raw);
    const totalXp = clampTotalXp(parsed.totalXp ?? parsed.total ?? 0);
    const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : nowIso;
    const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : createdAt;
    const hasConvertedAnonXp = parsed.hasConvertedAnonXp === true;
    const anonConversionCompleted = parsed.anonConversionCompleted === true || hasConvertedAnonXp;
    const convertedFromAnonId = typeof parsed.convertedFromAnonId === "string" ? parsed.convertedFromAnonId : null;
    const anonConversionAt = typeof parsed.anonConversionAt === "string" ? parsed.anonConversionAt : null;
    return {
      userId,
      totalXp,
      createdAt,
      updatedAt,
      hasConvertedAnonXp,
      anonConversionCompleted,
      convertedFromAnonId,
      anonConversionAt,
    };
  } catch {
    return null;
  }
}

export async function saveUserProfile({
  userId,
  totalXp,
  now = Date.now(),
  hasConvertedAnonXp = false,
  anonConversionCompleted = false,
  convertedFromAnonId = null,
  anonConversionAt = null,
}) {
  if (!userId) return null;
  const existing = await getUserProfile(userId);
  const timestamp = new Date(now).toISOString();
  const profile = {
    userId,
    totalXp: clampTotalXp(totalXp),
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    hasConvertedAnonXp: existing?.hasConvertedAnonXp === true || hasConvertedAnonXp === true,
    anonConversionCompleted: existing?.anonConversionCompleted === true || anonConversionCompleted === true,
    convertedFromAnonId: convertedFromAnonId ?? existing?.convertedFromAnonId ?? null,
    anonConversionAt: anonConversionAt ?? existing?.anonConversionAt ?? null,
  };
  try {
    await store.set(profileKey(userId), JSON.stringify(profile));
    return profile;
  } catch (err) {
    logStoreError("[store-upstash] Failed to persist user profile", { userId, error: err?.message });
    return existing || profile;
  }
}

export function initAnonProfile(anonId, now, dayKey) {
  return {
    anonId,
    totalAnonXp: 0,
    // First profile creation corresponds to an active day when XP is earned.
    anonActiveDays: 1,
    lastActivityTs: now,
    createdAt: new Date(now).toISOString(),
    convertedToUserId: null,
    lastActiveDayKey: dayKey,
  };
}

export async function getAnonProfile(anonId) {
  if (!anonId) return null;
  try {
    const raw = await store.get(anonProfileKey(anonId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const totalAnonXp = Number(parsed.totalAnonXp) || 0;
    let anonActiveDays = Number(parsed.anonActiveDays) || 0;

    if (totalAnonXp > 0 && anonActiveDays <= 0) {
      anonActiveDays = 1;
    }

    return {
      anonId,
      totalAnonXp,
      anonActiveDays,
      lastActivityTs: Number(parsed.lastActivityTs) || 0,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      convertedToUserId: parsed.convertedToUserId ?? null,
      lastActiveDayKey: parsed.lastActiveDayKey,
    };
  } catch {
    return null;
  }
}

export async function saveAnonProfile(profile) {
  if (!profile || !profile.anonId) return null;
  const normalized = {
    anonId: profile.anonId,
    totalAnonXp: Number(profile.totalAnonXp) || 0,
    anonActiveDays: Number(profile.anonActiveDays) || 0,
    lastActivityTs: Number(profile.lastActivityTs) || 0,
    createdAt: typeof profile.createdAt === "string" ? profile.createdAt : new Date().toISOString(),
    convertedToUserId: profile.convertedToUserId ?? null,
    lastActiveDayKey: profile.lastActiveDayKey,
  };
  try {
    await store.set(anonProfileKey(profile.anonId), JSON.stringify(normalized));
    return normalized;
  } catch (err) {
    logStoreError("[store-upstash] Failed to persist anon profile", { anonId: profile.anonId, error: err?.message });
    return normalized;
  }
}
