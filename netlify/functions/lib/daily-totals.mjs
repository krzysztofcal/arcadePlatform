import crypto from "node:crypto";
import { store } from "../_shared/store-upstash.mjs";

const warsawDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
});

const warsawOffsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Warsaw",
  hour12: false,
  timeZoneName: "longOffset",
});

const warsawParts = (ms) => {
  const parts = warsawDateFormatter.formatToParts(new Date(ms));
  const result = {};
  for (const part of parts) {
    if (part.type === "year" || part.type === "month" || part.type === "day" || part.type === "hour") {
      result[part.type] = Number(part.value);
    }
  }
  return result;
};

const parseWarsawOffsetMinutes = (ms) => {
  const parts = warsawOffsetFormatter.formatToParts(new Date(ms));
  const offsetPart = parts.find((part) => part.type === "timeZoneName");
  if (!offsetPart) return 0;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offsetPart.value);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return sign * (hours * 60 + minutes);
};

const warsawNow = (ms = Date.now()) => ({
  ...warsawParts(ms),
  ms,
});

const toWarsawEpoch = (year, month, day, hour) => {
  let guessUtc = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  let offset = parseWarsawOffsetMinutes(guessUtc);
  let adjusted = guessUtc - offset * 60_000;
  const adjustedOffset = parseWarsawOffsetMinutes(adjusted);
  if (adjustedOffset !== offset) {
    offset = adjustedOffset;
    adjusted = Date.UTC(year, month - 1, day, hour, 0, 0, 0) - offset * 60_000;
  }
  return adjusted;
};

export const asNumber = (raw, fallback) => {
  if (raw == null) return fallback;
  const sanitized = typeof raw === "string" ? raw.replace(/_/g, "") : raw;
  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const getDailyCap = () => Math.max(0, asNumber(process.env.XP_DAILY_CAP, 3000));
const KEY_NS_FALLBACK = "kcswh:xp:v2";
export const getKeyNamespace = () => process.env.XP_KEY_NS ?? KEY_NS_FALLBACK;

export const getDailyKey = (ms = Date.now()) => {
  let effectiveMs = ms;
  let { year, month, day, hour } = warsawParts(effectiveMs);
  if (hour < 3) {
    effectiveMs -= 3 * 60 * 60 * 1000;
    ({ year, month, day } = warsawParts(effectiveMs));
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export const getNextResetEpoch = (ms = Date.now()) => {
  const current = warsawNow(ms);
  let targetYear = current.year;
  let targetMonth = current.month;
  let targetDay = current.day;
  if (current.hour >= 3) {
    const tomorrow = warsawParts(ms + 24 * 60 * 60 * 1000);
    targetYear = tomorrow.year;
    targetMonth = tomorrow.month;
    targetDay = tomorrow.day;
  }
  return toWarsawEpoch(targetYear, targetMonth, targetDay, 3);
};

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

export const keyDaily = (u, day = getDailyKey(), ns = getKeyNamespace()) => `${ns}:daily:${u}:${day}`;
export const keyTotal = (u, ns = getKeyNamespace()) => `${ns}:total:${u}`;
export const keySession = (u, s, ns = getKeyNamespace()) => `${ns}:session:${hash(`${u}|${s}`)}`;
export const keySessionSync = (u, s, ns = getKeyNamespace()) => `${ns}:session:last:${hash(`${u}|${s}`)}`;
export const keyLock = (u, s, ns = getKeyNamespace()) => `${ns}:lock:${hash(`${u}|${s}`)}`;

const clampDaily = (value) => {
  const numeric = Number(value) || 0;
  return Math.max(0, Math.floor(numeric));
};

export async function getTotals({ userId, sessionId, now = Date.now(), keyNamespace } = {}) {
  const dayKeyNow = getDailyKey(now);
  const cap = getDailyCap();
  const namespace = keyNamespace ?? getKeyNamespace();
  if (!userId) {
    return {
      current: 0,
      totalToday: 0,
      lifetime: 0,
      sessionTotal: 0,
      lastSync: 0,
      cap,
      remaining: cap,
      dayKey: dayKeyNow,
      nextReset: getNextResetEpoch(now),
    };
  }
  const todayKey = keyDaily(userId, dayKeyNow, namespace);
  const totalKeyK = keyTotal(userId, namespace);
  const sessionKeyK = sessionId ? keySession(userId, sessionId, namespace) : null;
  const sessionSyncKeyK = sessionId ? keySessionSync(userId, sessionId, namespace) : null;
  try {
    const reads = [store.get(todayKey), store.get(totalKeyK)];
    if (sessionKeyK) reads.push(store.get(sessionKeyK));
    if (sessionSyncKeyK) reads.push(store.get(sessionSyncKeyK));
    const values = await Promise.all(reads);
    const currentRaw = Number(values[0] ?? "0") || 0;
    const current = clampDaily(currentRaw);
    const lifetime = Number(values[1] ?? "0") || 0;
    const sessionTotal = sessionKeyK ? (Number(values[2] ?? "0") || 0) : 0;
    const lastSync = sessionSyncKeyK ? (Number(values[sessionKeyK ? 3 : 2] ?? "0") || 0) : 0;
    const totalToday = Math.min(cap, current);
    const remaining = Math.max(0, cap - totalToday);
    return {
      current,
      totalToday,
      lifetime,
      sessionTotal,
      lastSync,
      cap,
      remaining,
      dayKey: dayKeyNow,
      nextReset: getNextResetEpoch(now),
    };
  } catch {
    return {
      current: 0,
      totalToday: 0,
      lifetime: 0,
      sessionTotal: 0,
      lastSync: 0,
      cap,
      remaining: cap,
      dayKey: dayKeyNow,
      nextReset: getNextResetEpoch(now),
    };
  }
}

export async function getDailyTotals(options) {
  const totals = await getTotals(options ?? {});
  return {
    current: totals.current,
    totalToday: totals.totalToday,
    cap: totals.cap,
    remaining: totals.remaining,
    dayKey: totals.dayKey,
    nextReset: totals.nextReset,
  };
}
