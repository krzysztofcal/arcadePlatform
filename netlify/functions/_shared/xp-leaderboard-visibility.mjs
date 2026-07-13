import { store as defaultStore } from "./store-upstash.mjs";
import { createXpLeaderboardKeys, getXpLeaderboardPeriods, getXpLeaderboardWeekDayKeys } from "./xp-leaderboard.mjs";

const SYNC_LEADERBOARD_VISIBILITY_SCRIPT = `
  local hiddenKey = KEYS[1]
  local allTimeKey = KEYS[2]
  local dayKey = KEYS[3]
  local weekKey = KEYS[4]
  local totalKey = KEYS[5]
  local todayTotalKey = KEYS[6]
  local visible = ARGV[1] == '1'
  local member = ARGV[2]
  local dayExpiresAt = tonumber(ARGV[3])
  local weekExpiresAt = tonumber(ARGV[4])

  if not visible then
    redis.call('SET', hiddenKey, '1')
    redis.call('ZREM', allTimeKey, member)
    redis.call('ZREM', dayKey, member)
    redis.call('ZREM', weekKey, member)
    return {0, 0, 0}
  end

  redis.call('DEL', hiddenKey)
  local lifetime = tonumber(redis.call('GET', totalKey) or '0')
  local today = tonumber(redis.call('GET', todayTotalKey) or '0')
  local week = 0
  for index = 7, #KEYS do
    week = week + tonumber(redis.call('GET', KEYS[index]) or '0')
  end

  local function setScore(key, score)
    if score > 0 then redis.call('ZADD', key, score, member)
    else redis.call('ZREM', key, member) end
  end

  setScore(allTimeKey, lifetime)
  setScore(dayKey, today)
  setScore(weekKey, week)
  if today > 0 and dayExpiresAt and dayExpiresAt > 0 then redis.call('EXPIREAT', dayKey, dayExpiresAt) end
  if week > 0 and weekExpiresAt and weekExpiresAt > 0 then redis.call('EXPIREAT', weekKey, weekExpiresAt) end
  return {lifetime, today, week}
`;

async function syncUserLeaderboardVisibility(userId, visible, deps = {}) {
  if (typeof userId !== "string" || !userId.trim() || typeof visible !== "boolean") throw new TypeError("invalid_leaderboard_visibility_sync");
  const store = deps.store || defaultStore;
  const namespace = deps.namespace || process.env.XP_KEY_NS || "kcswh:xp:v2";
  const now = Number.isFinite(deps.now) ? deps.now : Date.now();
  const periods = getXpLeaderboardPeriods(now);
  const weekDayKeys = getXpLeaderboardWeekDayKeys(now);
  const keys = createXpLeaderboardKeys({ namespace });
  const result = await store.eval(
    SYNC_LEADERBOARD_VISIBILITY_SCRIPT,
    [
      keys.hidden(userId),
      keys.allTime(),
      keys.day(periods.dayKey),
      keys.week(periods.weekKey),
      `${namespace}:total:${userId}`,
      `${namespace}:daily:${userId}:${periods.dayKey}`,
      ...weekDayKeys.map((dayKey) => `${namespace}:daily:${userId}:${dayKey}`),
    ],
    [visible ? "1" : "0", userId, String(periods.dayExpiresAtSec), String(periods.weekExpiresAtSec)],
  );
  return {
    visible,
    allTime: Math.max(0, Math.floor(Number(result?.[0]) || 0)),
    today: Math.max(0, Math.floor(Number(result?.[1]) || 0)),
    week: Math.max(0, Math.floor(Number(result?.[2]) || 0)),
  };
}

export { SYNC_LEADERBOARD_VISIBILITY_SCRIPT, syncUserLeaderboardVisibility };
