import { nextWarsawResetMs, warsawDayKey, warsawLocalEpochMs } from "./time-utils.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_RETENTION_MS = 14 * DAY_MS;
const WEEK_RETENTION_MS = 8 * 7 * DAY_MS;

function parseDayKey(dayKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) throw new TypeError("invalid_leaderboard_day_key");
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function isoWeekForDay(dayKey) {
  const { year, month, day } = parseDayKey(dayKey);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isoDay = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - isoDay);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((date - yearStart) / DAY_MS) + 1) / 7);
  return { isoYear, week, isoDay };
}

function addUtcDays(dayKey, days) {
  const { year, month, day } = parseDayKey(dayKey);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function formatUtcDay({ year, month, day }) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getXpLeaderboardPeriods(nowMs = Date.now()) {
  const dayKey = warsawDayKey(nowMs);
  const { isoYear, week, isoDay } = isoWeekForDay(dayKey);
  const nextWeekDay = addUtcDays(dayKey, 8 - isoDay);
  const nextDayResetAt = nextWarsawResetMs(nowMs);
  const nextWeekResetAt = warsawLocalEpochMs(nextWeekDay.year, nextWeekDay.month, nextWeekDay.day, 3);
  return Object.freeze({
    dayKey,
    weekKey: `${isoYear}-W${String(week).padStart(2, "0")}`,
    nextDayResetAt,
    nextWeekResetAt,
    dayExpiresAtSec: Math.floor((nextDayResetAt + DAY_RETENTION_MS) / 1000),
    weekExpiresAtSec: Math.floor((nextWeekResetAt + WEEK_RETENTION_MS) / 1000),
  });
}

export function getXpLeaderboardWeekDayKeys(nowMs = Date.now()) {
  const currentDayKey = warsawDayKey(nowMs);
  const { isoDay } = isoWeekForDay(currentDayKey);
  const keys = [];
  for (let offset = isoDay - 1; offset >= 0; offset -= 1) {
    keys.push(formatUtcDay(addUtcDays(currentDayKey, -offset)));
  }
  return Object.freeze(keys);
}

export function createXpLeaderboardKeys({ namespace = "kcswh:xp:v2" } = {}) {
  const prefix = `${namespace}:leaderboard:v1`;
  return Object.freeze({
    allTime: () => `${prefix}:all_time`,
    day: (dayKey) => `${prefix}:day:${dayKey}`,
    week: (weekKey) => `${prefix}:week:${weekKey}`,
    hidden: (userId) => `${prefix}:hidden:${userId}`,
  });
}
