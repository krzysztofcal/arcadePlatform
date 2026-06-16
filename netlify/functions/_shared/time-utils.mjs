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

const DAY_MS = 24 * 60 * 60 * 1000;

function warsawParts(ms) {
  const parts = warsawDateFormatter.formatToParts(new Date(ms));
  const result = { year: 0, month: 0, day: 0, hour: 0 };
  for (const part of parts) {
    if (part.type === "year" || part.type === "month" || part.type === "day" || part.type === "hour") {
      result[part.type] = Number(part.value);
    }
  }
  return result;
}

function parseWarsawOffsetMinutes(ms) {
  const parts = warsawOffsetFormatter.formatToParts(new Date(ms));
  const offsetPart = parts.find((part) => part.type === "timeZoneName");
  if (!offsetPart) return 0;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offsetPart.value);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return sign * (hours * 60 + minutes);
}

function toWarsawEpoch(year, month, day, hour) {
  const baseUtc = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  let offset = parseWarsawOffsetMinutes(baseUtc);
  let adjusted = baseUtc - offset * 60_000;
  const adjustedOffset = parseWarsawOffsetMinutes(adjusted);
  if (adjustedOffset !== offset) {
    offset = adjustedOffset;
    adjusted = Date.UTC(year, month - 1, day, hour, 0, 0, 0) - offset * 60_000;
  }
  return adjusted;
}

function nextCandidateReset(nowMs) {
  const now = warsawParts(nowMs);
  const todayReset = toWarsawEpoch(now.year, now.month, now.day, 3);
  if (nowMs < todayReset) {
    return todayReset;
  }
  const tomorrowParts = warsawParts(nowMs + DAY_MS);
  return toWarsawEpoch(tomorrowParts.year, tomorrowParts.month, tomorrowParts.day, 3);
}

export function warsawDayKey(nowMs = Date.now()) {
  let effectiveMs = nowMs;
  const parts = warsawParts(effectiveMs);
  if (parts.hour < 3) {
    effectiveMs -= 3 * 60 * 60 * 1000;
  }
  const d = warsawParts(effectiveMs);
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

export function nextWarsawResetMs(nowMs = Date.now()) {
  let nextReset = nextCandidateReset(nowMs);

  if (nextReset <= nowMs) {
    nextReset = nextCandidateReset(nowMs + DAY_MS);
  }


  return nextReset;
}
