import crypto from "node:crypto";

const asNumber = (raw, fallback) => {
  const value = typeof raw === "string" ? raw.replace(/_/g, "") : raw;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

export function getXpPolicy(env = process.env) {
  const sessionTtlSec = Math.max(0, asNumber(env.XP_SESSION_TTL_SEC, 604800));
  return {
    dailyCap: Math.max(0, asNumber(env.XP_DAILY_CAP, 3000)),
    sessionCap: Math.max(0, asNumber(env.XP_SESSION_CAP, 300)),
    deltaCap: Math.max(0, asNumber(env.XP_DELTA_CAP, 300)),
    sessionTtlSec,
    sessionTtlMs: sessionTtlSec * 1000,
    anonConversionCap: Math.max(0, asNumber(env.XP_ANON_CONVERSION_MAX_XP, 100000)),
  };
}

export function resolveXpIdentity({ anonId, authContext }) {
  const normalizedAnonId = typeof anonId === "string" ? anonId.trim() : null;
  const supabaseUserId = authContext?.valid && typeof authContext.userId === "string"
    ? authContext.userId.trim()
    : null;
  return {
    anonId: normalizedAnonId || null,
    supabaseUserId: supabaseUserId || null,
    identityId: supabaseUserId || normalizedAnonId || null,
  };
}

export function isValidXpAnonId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(value);
}

const GAME_ID_ALIASES = Object.freeze({
  "open-2048": "2048",
  "block-stacker": "tetris",
  "open-tetris": "tetris",
  "t-rex-runner": "t-rex",
  trex: "t-rex",
  "open-pacman": "pacman",
  "maze-muncher": "pacman",
  "catch-cats": "cats",
  "game-cats": "cats",
  game_cats: "cats",
});

export function canonicalizeXpGameId(value) {
  const normalized = typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    : "";
  if (!normalized) return "default";
  return GAME_ID_ALIASES[normalized] || normalized;
}

const keyTotal = (namespace, userId) => `${namespace}:total:${userId}`;
const keyMigration = (namespace, anonId, userId) => `${namespace}:migration:${hash(`${anonId}|${userId}`)}`;
const keyUserMigration = (namespace, userId) => `${namespace}:migration:user:${hash(userId)}`;

const ANON_CONVERSION_SCRIPT = `
  local anonTotalKey = KEYS[1]
  local userTotalKey = KEYS[2]
  local markerKey = KEYS[3]
  local userMarkerKey = KEYS[4]
  local conversionCap = tonumber(ARGV[1]) or 0

  local currentUserTotal = tonumber(redis.call('GET', userTotalKey) or '0')
  local existingUserMarker = redis.call('GET', userMarkerKey)
  if existingUserMarker then return {0, currentUserTotal, tonumber(existingUserMarker) or 0, 1} end
  local existingMarker = redis.call('GET', markerKey)
  if existingMarker then return {0, currentUserTotal, tonumber(existingMarker) or 0, 1} end

  local anonTotal = tonumber(redis.call('GET', anonTotalKey) or '0')
  if anonTotal <= 0 then return {0, currentUserTotal, 0, 0} end
  local converted = math.min(anonTotal, conversionCap)
  if converted <= 0 then return {0, currentUserTotal, anonTotal, 0} end

  currentUserTotal = tonumber(redis.call('INCRBY', userTotalKey, converted))
  redis.call('DEL', anonTotalKey)
  redis.call('SET', markerKey, tostring(converted))
  redis.call('SET', userMarkerKey, tostring(converted))
  return {converted, currentUserTotal, anonTotal, 0}
`;

export async function migrateAnonXpToUser({ store, namespace, anonId, userId, conversionCap }) {
  if (!anonId || !userId || anonId === userId) {
    return { converted: 0, userTotal: null, anonTotal: 0, alreadyConverted: false };
  }
  const result = await store.eval(
    ANON_CONVERSION_SCRIPT,
    [keyTotal(namespace, anonId), keyTotal(namespace, userId), keyMigration(namespace, anonId, userId), keyUserMigration(namespace, userId)],
    [String(Math.max(0, Number(conversionCap) || 0))],
  );
  return {
    converted: Math.max(0, Math.floor(Number(result?.[0]) || 0)),
    userTotal: Math.max(0, Math.floor(Number(result?.[1]) || 0)),
    anonTotal: Math.max(0, Math.floor(Number(result?.[2]) || 0)),
    alreadyConverted: Number(result?.[3]) === 1,
  };
}
