// Minimal Upstash REST client (no extra deps).
import { createHash } from "node:crypto";
import { klog, beginSql } from "./supabase-admin.mjs";
import { assertAccountActive, lockAccountLifecycle } from "../../../shared/account-deletion.mjs";

const BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const XP_NAMESPACE = process.env.XP_KEY_NS ?? "kcswh:xp:v2";
const USER_PROFILE_PREFIX = "kcswh:xp:user:";
const FORCE_MEMORY_STORE = process.env.XP_TEST_MODE === "1";

// UUID ownership is supplied explicitly by server callers, never inferred from keys.
const ACCOUNT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EPOCH_KEY = 'account-deletion:redis:epoch';
const permitKey = (id) => 'account-deletion:redis:permit:' + id;
const fenceError = () => Object.assign(new Error('account_redis_fenced'), { code: 'account_redis_fenced' });
const INIT_PERMIT = `-- account-permit-init
if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end
local current=redis.call('GET',KEYS[2])
if current == 'BLOCKED' then return 0 end
if not current then redis.call('SET',KEYS[2],'ACTIVE:'..ARGV[1],'NX') end
return redis.call('GET',KEYS[2]) == 'ACTIVE:'..ARGV[1] and 1 or 0`;
// Missing/old permits deny at execution. Only an authoritative SQL check under
// the lifecycle lock may initialize one. BLOCKED is never overwritten.
export async function withRedisIdentityPermit(userIds, fn, deps = {}) {
  if (process.env.ACCOUNT_DELETION_ENABLED !== '1') return fn(null);
  if (!Array.isArray(userIds) || !userIds.length || userIds.some((id) => typeof id !== 'string' || !id.trim())) throw fenceError();
  const ids = [...new Set(userIds.filter((id) => ACCOUNT_UUID.test(String(id))).map((id) => id.toLowerCase()))].sort();
  if (!ids.length) return fn(null); // Existing non-UUID anonymous identities.
  const target = deps.store || store;
  if (isMemoryStore && target === store && !FORCE_MEMORY_STORE) throw fenceError();
  const transaction = deps.beginSql || beginSql;
  return transaction(async (tx) => {
    const anonymous = new Set((deps.anonymousIds || []).map((id) => String(id).toLowerCase()));
    for (const id of ids) {
      if (!anonymous.has(id)) { await assertAccountActive(tx, id); continue; }
      // Browser anonymous IDs are UUIDs too. They must never alias a current
      // Auth identity or an old deletion identity, even as a conversion source.
      await lockAccountLifecycle(tx, [id]);
      const [identity] = await tx.unsafe(`select exists(select 1 from auth.users where id=$1) as present,
        exists(select 1 from public.account_deletion_requests where old_user_id=$1) as deleting,
        exists(select 1 from public.chips_accounts where retired_user_id=$1) as retired;`, [id]);
      if (identity?.present !== false || identity?.deleting !== false || identity?.retired !== false) throw fenceError();
    }
    // Recovery must install a fresh epoch after quiescing old issuers. Requests
    // never initialize it: a delayed NX epoch initializer could replay after flush.
    const epoch = await target.get(EPOCH_KEY);
    if (!epoch) throw fenceError();
    for (const id of ids) {
      if (Number(await target.eval(INIT_PERMIT, [EPOCH_KEY, permitKey(id)], [epoch])) !== 1) throw fenceError();
    }
    return fn({ epoch, ids });
  });
}

// Blocking is sticky even across an epoch change. Flush removes it, but missing
// permits still deny and SQL prevents a suspended UUID from initializing again.
export async function blockRedisIdentity(userId, target = store) {
  if (!ACCOUNT_UUID.test(String(userId))) throw fenceError();
  if (await target.set(permitKey(userId.toLowerCase()), 'BLOCKED') !== 'OK') throw fenceError();
}

export async function guardedRedisEval({ store: target = store, userIds, anonymousIds = [], script, keys, args, beginSql: transaction }) {
  return withRedisIdentityPermit(userIds, async (permit) => {
    if (!permit) return target.eval(script, keys, args);
    const n = permit.ids.length;
    const prefix = `-- account-guard:${n}\nlocal expected=ARGV[1]\nif redis.call('GET',KEYS[1]) ~= expected then return redis.error_reply('account_redis_fenced') end\nfor i=2,${n + 1} do if redis.call('GET',KEYS[i]) ~= 'ACTIVE:'..expected then return redis.error_reply('account_redis_fenced') end end\nfor i=1,${n + 1} do table.remove(KEYS,1) end\ntable.remove(ARGV,1)\n-- account-guard-end\n`;
    return target.eval(prefix + script, [EPOCH_KEY, ...permit.ids.map(permitKey), ...keys], [permit.epoch, ...args]);
  }, { store: target, anonymousIds, ...(transaction ? { beginSql: transaction } : {}) });
}

// Narrow server-only mutation vocabulary; do not expose commands/keys over HTTP.
const MUTATE = `-- account-user-mutate
local op=ARGV[1]
if op=='set' then return redis.call('SET',KEYS[1],ARGV[2]) end
if op=='setex' then return redis.call('SETEX',KEYS[1],ARGV[3],ARGV[2]) end
if op=='zadd' then return redis.call('ZADD',KEYS[1],ARGV[3],ARGV[2]) end
if op=='touch' then
 local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
 local data=cjson.decode(raw); if data.userId~=ARGV[4] then return redis.error_reply('session_owner_mismatch') end
 data.lastActivity=tonumber(ARGV[2]); redis.call('SETEX',KEYS[1],ARGV[3],cjson.encode(data)); return 1
end
return redis.error_reply('invalid_guarded_operation')`;
export async function guardedUserMutation({ store: target = store, userId, anonymous = false, operation, key, value, ttl, score, beginSql: transaction }) {
  if (!['set', 'setex', 'zadd', 'touch'].includes(operation)) throw new TypeError('invalid_guarded_operation');
  if (process.env.ACCOUNT_DELETION_ENABLED !== '1') {
    if (operation === 'set') return target.set(key, value);
    if (operation === 'setex') return target.setex(key, ttl, value);
    if (operation === 'zadd') return target.zadd(key, score, value);
    const raw = await target.get(key); if (!raw) return 0;
    const data = JSON.parse(raw); if (data.userId !== userId) throw new Error('session_owner_mismatch');
    data.lastActivity = Number(value); await target.setex(key, ttl, JSON.stringify(data)); return 1;
  }
  return guardedRedisEval({ store: target, userIds: [userId], anonymousIds: anonymous ? [userId] : [], script: MUTATE, keys: [key],
    args: [operation, String(value), String(ttl ?? score ?? ''), String(userId)], beginSql: transaction });
}

const REMOVE_OWNED_SESSION = `-- account-remove-owned-session
if redis.call('GET',KEYS[1])~='BLOCKED' then return redis.error_reply('account_redis_fenced') end
local raw=redis.call('GET',KEYS[2]); if not raw then return 0 end
local data=cjson.decode(raw); if data.userId~=ARGV[1] then return 0 end
return redis.call('DEL',KEYS[2])`;

// Removal-only bounded subset. Legacy opaque session/migration hashes have no
// complete owner index, so a full scan is NOT proof of complete user erasure.
// Caller persists cursor progress; activation needs a reviewed legacy cutover.
export async function cleanupRedisIdentity({ userId, cursor = null, limit = 50, namespace = XP_NAMESPACE, store: target = store }) {
  if (!ACCOUNT_UUID.test(String(userId)) || !/^[A-Za-z0-9:_-]+$/.test(namespace)) throw fenceError();
  userId = userId.toLowerCase();
  if (await target.get(permitKey(userId)) !== 'BLOCKED') throw fenceError();
  const budget = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const board = namespace + ':leaderboard:v1:';
  // Exact-owner keys only; never DEL a shared leaderboard or lifecycle fence.
  for (const key of [USER_PROFILE_PREFIX + userId, namespace + ':total:' + userId,
    board + 'hidden:' + userId, namespace + ':migration:user:' + hash(userId)]) await target.del(key);
  const start = cursor?.scanCursor || '0';
  const page = await target.scan(start, { match: namespace + ':*', count: budget });
  const position = page.cursor;
  const batch = page.keys.slice(0, budget);
  for (const key of batch) {
    if (typeof key !== 'string' || !key.startsWith(namespace + ':')) continue;
    if (key.startsWith(namespace + ':daily:' + userId + ':') || key.startsWith(namespace + ':ratelimit:user:' + userId + ':')) {
      await target.del(key);
    } else if (key === board + 'all_time' || key.startsWith(board + 'day:') || key.startsWith(board + 'week:')) {
      await target.zrem(key, userId);
    } else if (key.startsWith(namespace + ':server-session:')) {
      const raw = await target.get(key);
      let owner; try { owner = JSON.parse(raw)?.userId; } catch { continue; }
      if (owner !== userId) continue;
      await target.eval(REMOVE_OWNED_SESSION, [permitKey(userId), key], [userId]);
      const sessionId = key.slice((namespace + ':server-session:').length);
      const digest = hash(userId + '|' + sessionId);
      for (const family of ['session:', 'session:last:', 'session:state:', 'registry:', 'lock:']) {
        await target.del(namespace + ':' + family + digest);
      }
    }
  }
  // SCAN COUNT is a hint. Do not persist page keys containing unrelated users'
  // identifiers. An oversized page cannot be proved drained within this budget.
  const overflow = page.keys.length > budget;
  const scanned = position === '0' && !overflow;
  return { done: false, reason: overflow ? 'redis_cleanup_page_overflow' : scanned ? 'legacy_redis_ownership_unproven' : 'redis_cleanup_scanning',
    cursor: scanned ? null : { scanCursor: overflow ? start : position }, scanned };
}

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
  const scanPages = new Map();
  let nextScanCursor = 1;

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
    memory.set(key, { ...entry, expiry: Date.now() + ttlMs });
  }

  function getSortedSet(key, create = false) {
    const entry = sweep(key);
    if (entry?.kind === "zset") return entry.value;
    if (!create) return null;
    const value = new Map();
    memory.set(key, { kind: "zset", value, expiry: null });
    return value;
  }

  function sortedEntries(key, reverse = false) {
    const set = getSortedSet(key);
    if (!set) return [];
    return [...set.entries()].sort((left, right) => {
      const scoreOrder = left[1] - right[1];
      if (scoreOrder !== 0) return reverse ? -scoreOrder : scoreOrder;
      const memberOrder = left[0] < right[0] ? -1 : (left[0] > right[0] ? 1 : 0);
      return reverse ? -memberOrder : memberOrder;
    });
  }

  function zaddValue(key, score, member) {
    const set = getSortedSet(key, true);
    const exists = set.has(String(member));
    set.set(String(member), Number(score));
    return exists ? 0 : 1;
  }

  function remainingTtlMs(entry) {
    if (!entry || entry.expiry == null) return null;
    return Math.max(0, entry.expiry - Date.now());
  }

  return {
    async scan(cursor = '0', { match = '*', count = 100 } = {}) {
      const escaped = match.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
      const pattern = new RegExp('^' + escaped + '$');
      const candidates = String(cursor) === '0'
        ? [...memory.keys()].filter((key) => sweep(key) && pattern.test(key)).sort()
        : scanPages.get(String(cursor));
      if (!candidates) throw new Error('invalid_scan_cursor');
      const keys = candidates.slice(0, count);
      const remaining = candidates.slice(count);
      const next = remaining.length ? String(nextScanCursor++) : '0';
      if (remaining.length) scanPages.set(next, remaining);
      return { cursor: next, keys };
    },
    async get(key) { return getValue(key); },
    async mget(keys) { return keys.map((key) => getValue(key)); },
    async set(key, value) { setValue(key, value, null); return "OK"; },
    async setex(key, seconds, value) { setValue(key, value, seconds * 1000); return "OK"; },
    async setNxEx(key, seconds, value) {
      const existing = sweep(key);
      if (existing) return null;
      setValue(key, value, seconds * 1000);
      return "OK";
    },
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
      memory.set(key, { ...entry, expiry: Date.now() + seconds * 1000 });
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
    async zadd(key, score, member) { return zaddValue(key, score, member); },
    async zincrBy(key, delta, member) {
      const set = getSortedSet(key, true);
      const next = Number(set.get(String(member)) ?? 0) + Number(delta);
      set.set(String(member), next);
      return next;
    },
    async zrem(key, member) {
      const set = getSortedSet(key);
      return set?.delete(String(member)) ? 1 : 0;
    },
    async zrevrangeWithScores(key, start, stop) {
      const entries = sortedEntries(key, true);
      const normalizedStop = Number(stop) < 0 ? entries.length + Number(stop) : Number(stop);
      return entries.slice(Number(start), normalizedStop + 1).map(([member, score]) => ({ member, score }));
    },
    async zrevrank(key, member) {
      const index = sortedEntries(key, true).findIndex(([candidate]) => candidate === String(member));
      return index < 0 ? null : index;
    },
    async zscore(key, member) {
      const score = getSortedSet(key)?.get(String(member));
      return score == null ? null : score;
    },
    async zcount(key, min, max) {
      const parseBound = (raw, infinity) => {
        if (raw === infinity) return { value: infinity === "-inf" ? -Infinity : Infinity, exclusive: false };
        const text = String(raw);
        return { value: Number(text.startsWith("(") ? text.slice(1) : text), exclusive: text.startsWith("(") };
      };
      const lower = parseBound(min, "-inf");
      const upper = parseBound(max, "+inf");
      return sortedEntries(key).filter(([, score]) => (
        (lower.exclusive ? score > lower.value : score >= lower.value)
        && (upper.exclusive ? score < upper.value : score <= upper.value)
      )).length;
    },
    async zcard(key) { return getSortedSet(key)?.size ?? 0; },
    async eval(_script, keys = [], argv = []) {
      if (_script.startsWith('-- account-remove-owned-session')) {
        if (getValue(keys[0]) !== 'BLOCKED') throw fenceError();
        const raw = getValue(keys[1]); if (!raw || JSON.parse(raw)?.userId !== argv[0]) return 0;
        memory.delete(keys[1]); return 1;
      }
      if (_script.startsWith('-- account-permit-init')) {
        if (getValue(keys[0]) !== argv[0] || getValue(keys[1]) === 'BLOCKED') return 0;
        if (!getValue(keys[1])) setValue(keys[1], 'ACTIVE:' + argv[0], null);
        return getValue(keys[1]) === 'ACTIVE:' + argv[0] ? 1 : 0;
      }
      if (_script.startsWith('-- account-guard:')) {
        const count = Number(_script.split('\n')[0].split(':')[1]);
        if (getValue(keys[0]) !== argv[0] || keys.slice(1, count + 1).some((key) => getValue(key) !== 'ACTIVE:' + argv[0])) throw fenceError();
        return this.eval(_script.split('-- account-guard-end\n')[1], keys.slice(count + 1), argv.slice(1));
      }
      if (_script.startsWith('-- account-user-mutate')) {
        const [op, value, parameter, owner] = argv;
        if (op === 'set') { setValue(keys[0], value, null); return 'OK'; }
        if (op === 'setex') { setValue(keys[0], value, Number(parameter) * 1000); return 'OK'; }
        if (op === 'zadd') return zaddValue(keys[0], parameter, value);
        if (op === 'touch') {
          const raw = getValue(keys[0]); if (!raw) return 0;
          const data = JSON.parse(raw); if (data.userId !== owner) throw new Error('session_owner_mismatch');
          data.lastActivity = Number(value); setValue(keys[0], JSON.stringify(data), Number(parameter) * 1000); return 1;
        }
        throw new TypeError('invalid_guarded_operation');
      }
      // Memory impl supports the XP award signatures used by calculate-xp.
      if (((keys.length === 8 || keys.length === 9) && argv.length === 10) || (keys.length === 5 && argv.length === 7) || (keys.length === 4 && argv.length === 6)) {
        const [sessionKey, sessionSyncKey, dailyKey, totalKey, maybeLockKey] = keys;
        const hasLock = keys.length !== 4;
        const lockKey = hasLock ? maybeLockKey : null;
        const now = Number(argv[0]);
        const delta = Number(argv[1]);
        const dailyCap = Number(argv[2]);
        const sessionCap = Number(argv[3]);
        const ts = Number(argv[4]);
        const lockTtl = hasLock ? Number(argv[5]) : 0;
        const sessionTtlMs = hasLock ? Number(argv[6]) : Number(argv[5]);
        const leaderboardMember = keys.length >= 8 ? String(argv[7] || "") : "";
        const dayExpiresAtSec = keys.length >= 8 ? Number(argv[8]) : 0;
        const weekExpiresAtSec = keys.length >= 8 ? Number(argv[9]) : 0;

        const lockEntry = lockKey ? sweep(lockKey) : null;
        if (lockKey && lockEntry) {
          const currentDaily = Number(getValue(dailyKey) ?? "0");
          const sessionTotalLocked = Number(getValue(sessionKey) ?? "0");
          const lifetimeLocked = Number(getValue(totalKey) ?? "0");
          const lastSyncLocked = Number(getValue(sessionSyncKey) ?? "0");
          return [0, currentDaily, sessionTotalLocked, lifetimeLocked, lastSyncLocked, 6];
        }

        if (lockKey) setValue(lockKey, now, lockTtl);

        const release = () => { if (lockKey) memory.delete(lockKey); };

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

          const leaderboardVisible = keys.length < 9 || getValue(keys[8]) === null;
          if (leaderboardMember && leaderboardVisible) {
            zaddValue(keys[5], lifetime, leaderboardMember);
            zaddValue(keys[6], dailyTotal, leaderboardMember);
            const weekly = getSortedSet(keys[7], true);
            weekly.set(leaderboardMember, Number(weekly.get(leaderboardMember) ?? 0) + grant);
            setExpiryMs(keys[6], Math.max(0, dayExpiresAtSec * 1000 - Date.now()));
            setExpiryMs(keys[7], Math.max(0, weekExpiresAtSec * 1000 - Date.now()));
          }

          return [grant, dailyTotal, sessionTotal, lifetime, lastSync, status];
        } finally {
          release();
        }
      }

      if ((keys.length === 5 && argv.length === 2) || (keys.length === 6 && argv.length === 2) || (keys.length === 4 && argv.length === 1)) {
        const [anonTotalKey, userTotalKey, markerKey, userMarkerKey] = keys;
        const conversionCap = Math.max(0, Math.floor(Number(argv[0]) || 0));
        const existingUserMarker = getValue(userMarkerKey);
        const currentUserTotal = Number(getValue(userTotalKey) ?? "0") || 0;
        if (existingUserMarker !== null) {
          return [0, currentUserTotal, Number(existingUserMarker) || 0, 1];
        }
        const existingMarker = getValue(markerKey);
        if (existingMarker !== null) {
          return [0, currentUserTotal, Number(existingMarker) || 0, 1];
        }
        const anonTotal = Math.max(0, Math.floor(Number(getValue(anonTotalKey) ?? "0") || 0));
        const converted = Math.min(anonTotal, conversionCap);
        let userTotal = currentUserTotal;
        if (converted <= 0) return [0, userTotal, anonTotal, 0];
        userTotal += converted;
        setValue(userTotalKey, userTotal, null);
        memory.delete(anonTotalKey);
        setValue(markerKey, converted, null);
        setValue(userMarkerKey, converted, null);
        const leaderboardVisible = keys.length < 6 || getValue(keys[5]) === null;
        if (keys.length >= 5 && argv[1] && leaderboardVisible) zaddValue(keys[4], userTotal, argv[1]);
        return [converted, userTotal, anonTotal, 0];
      }

      if (keys.length >= 7 && argv.length === 4) {
        const [hiddenKey, allTimeKey, dayKey, weekKey, totalKey, todayTotalKey] = keys;
        const visible = String(argv[0]) === "1";
        const member = String(argv[1] || "");
        if (!visible) {
          setValue(hiddenKey, "1", null);
          getSortedSet(allTimeKey)?.delete(member);
          getSortedSet(dayKey)?.delete(member);
          getSortedSet(weekKey)?.delete(member);
          return [0, 0, 0];
        }
        memory.delete(hiddenKey);
        const lifetime = Math.max(0, Math.floor(Number(getValue(totalKey)) || 0));
        const today = Math.max(0, Math.floor(Number(getValue(todayTotalKey)) || 0));
        const week = keys.slice(6).reduce((sum, key) => sum + Math.max(0, Math.floor(Number(getValue(key)) || 0)), 0);
        const setScore = (key, score) => {
          if (score > 0) zaddValue(key, score, member);
          else getSortedSet(key)?.delete(member);
        };
        setScore(allTimeKey, lifetime);
        setScore(dayKey, today);
        setScore(weekKey, week);
        if (today > 0) setExpiryMs(dayKey, Math.max(0, Number(argv[2]) * 1000 - Date.now()));
        if (week > 0) setExpiryMs(weekKey, Math.max(0, Number(argv[3]) * 1000 - Date.now()));
        return [lifetime, today, week];
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
  if (data?.error) throw Object.assign(new Error("redis_command_failed"), { code: String(data.error).includes("account_redis_fenced") ? "account_redis_fenced" : "redis_command_failed" });
  return data.result;
}

const SET_NX_EX_SCRIPT = `
local key = KEYS[1]
local value = ARGV[1]
local ttlSec = tonumber(ARGV[2])
return redis.call('SET', key, value, 'EX', ttlSec, 'NX')
`;

const remoteStore = {
  async scan(cursor = '0', { match = '*', count = 100 } = {}) {
    const result = await call('SCAN', String(cursor), 'MATCH', match, 'COUNT', String(count));
    if (!Array.isArray(result) || !Array.isArray(result[1])) throw new Error('invalid_scan_result');
    return { cursor: String(result[0]), keys: result[1] };
  },
  async get(key) { return call("GET", key); },
  async mget(keys) { return keys.length ? call("MGET", ...keys) : []; },
  async set(key, value) { return call("SET", key, String(value)); },
  async setex(key, seconds, value) { return call("SETEX", key, String(seconds), String(value)); },
  async setNxEx(key, seconds, value) { return remoteStore.eval(SET_NX_EX_SCRIPT, [key], [String(value), String(seconds)]); },
  async incrBy(key, delta) { return call("INCRBY", key, String(delta)); },
  async decrBy(key, delta) { return call("DECRBY", key, String(delta)); },
  async expire(key, seconds) { return call("EXPIRE", key, String(seconds)); },
  async ttl(key) { return call("TTL", key); },
  async del(key) { return call("DEL", key); },
  async zadd(key, score, member) { return call("ZADD", key, String(score), String(member)); },
  async zincrBy(key, delta, member) { return call("ZINCRBY", key, String(delta), String(member)); },
  async zrem(key, member) { return call("ZREM", key, String(member)); },
  async zrevrangeWithScores(key, start, stop) {
    const result = await call("ZREVRANGE", key, String(start), String(stop), "WITHSCORES");
    if (Array.isArray(result?.[0])) {
      return result.map(([member, score]) => ({ member: String(member), score: Number(score) || 0 }));
    }
    const rows = [];
    for (let index = 0; index < (result?.length ?? 0); index += 2) {
      rows.push({ member: String(result[index]), score: Number(result[index + 1]) || 0 });
    }
    return rows;
  },
  async zrevrank(key, member) {
    const result = await call("ZREVRANK", key, String(member));
    return result == null ? null : Number(result);
  },
  async zscore(key, member) {
    const result = await call("ZSCORE", key, String(member));
    return result == null ? null : Number(result);
  },
  async zcount(key, min, max) { return Number(await call("ZCOUNT", key, String(min), String(max))) || 0; },
  async zcard(key) { return Number(await call("ZCARD", key)) || 0; },
  async eval(script, keys = [], argv = []) {
    // Upstash REST API expects array format: ["eval", script, numkeys, key1, key2, ..., arg1, arg2, ...]
    // The command name must be included as the first element when POSTing to the root endpoint
    // See: https://github.com/upstash/redis-js/blob/main/pkg/commands/eval.ts
    const body = ["eval", script, keys.length, ...keys, ...argv];
    const res = await fetch(BASE, {
      ...(process.env.ACCOUNT_DELETION_ENABLED === '1' ? { signal: AbortSignal.timeout(10000) } : {}),
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
    if (data?.error) throw Object.assign(new Error("redis_eval_failed"), { code: String(data.error).includes("account_redis_fenced") ? "account_redis_fenced" : "redis_eval_failed" });
    return data.result;
  },
};

export const store = isMemoryStore ? createMemoryStore() : remoteStore;
export const __remoteStoreForTests = remoteStore;
export const __createMemoryStoreForTests = createMemoryStore;
export const __setNxExScriptForTests = SET_NX_EX_SCRIPT;

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
const xpTotalKey = (userId) => `${XP_NAMESPACE}:total:${userId}`;

function normalizeUserProfile(raw, userId) {
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  const totalXp = clampTotalXp(parsed.totalXp ?? parsed.total ?? 0);
  const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : null;
  const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : createdAt;
  return { userId, totalXp, createdAt, updatedAt };
}

export async function getUserProfile(userId) {
  if (!userId) return null;
  try {
    return normalizeUserProfile(await store.get(profileKey(userId)), userId);
  } catch {
    return null;
  }
}

export async function getUserProfileStrict(userId) {
  if (!userId) return null;
  if (isMemoryStore && !FORCE_MEMORY_STORE) {
    const error = new Error("xp_store_unavailable");
    error.code = "xp_store_unavailable";
    throw error;
  }
  return normalizeUserProfile(await store.get(profileKey(userId)), userId);
}

export async function getUserXpTotalStrict(userId) {
  if (!userId) return 0;
  if (isMemoryStore && !FORCE_MEMORY_STORE) {
    const error = new Error("xp_store_unavailable");
    error.code = "xp_store_unavailable";
    throw error;
  }
  const raw = await store.get(xpTotalKey(userId));
  if (raw == null) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error("invalid_xp_total");
  return clampTotalXp(parsed);
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
    await guardedUserMutation({ userId, operation: "set", key: profileKey(userId), value: JSON.stringify(profile) });
    return profile;
  } catch (err) {
    if (process.env.ACCOUNT_DELETION_ENABLED === "1") throw err;
    klog("upstash_save_user_profile_failed", { userId, error: err?.message });
    return existing || profile;
  }
}
