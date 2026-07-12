import { klog } from "./supabase-admin.mjs";
import { saveUserProfile } from "./store-upstash.mjs";
import { sanitizeXpCounter } from "./xp-ledger.mjs";

function buildXpStatusSnapshot({ totals, dailyCap, deltaCap, sessionId, dayKey, nextReset, status = "statusOnly" }) {
  const source = totals && typeof totals === "object" ? totals : {};
  const snapshot = {
    ok: true,
    awarded: 0,
    granted: 0,
    cap: sanitizeXpCounter(dailyCap),
    capDelta: sanitizeXpCounter(deltaCap),
    totalLifetime: sanitizeXpCounter(source.lifetime),
    sessionTotal: sanitizeXpCounter(source.sessionTotal),
    lastSync: sanitizeXpCounter(source.lastSync),
    status,
  };
  if (typeof sessionId === "string" && sessionId) snapshot.sessionId = sessionId;
  snapshot.totalToday = Math.min(snapshot.cap, sanitizeXpCounter(source.current));
  snapshot.remaining = Math.max(0, snapshot.cap - snapshot.totalToday);
  if (typeof dayKey === "string" && dayKey) snapshot.dayKey = dayKey;
  if (Number.isFinite(nextReset)) snapshot.nextReset = Math.floor(nextReset);
  return snapshot;
}

async function readCanonicalXpStatus({ readTotals, dailyCap, deltaCap, sessionId, dayKey, nextReset, supabaseUserId, persistProfile }) {
  if (typeof readTotals !== "function") throw new TypeError("invalid_xp_status_reader");
  const totals = await readTotals();
  if (supabaseUserId && typeof persistProfile === "function") {
    await persistProfile({ userId: supabaseUserId, totalXp: totals.lifetime });
  }
  return {
    totals,
    payload: buildXpStatusSnapshot({ totals, dailyCap, deltaCap, sessionId, dayKey, nextReset }),
  };
}

async function persistXpProfileSnapshot({ userId, totalXp, now = Date.now(), save = saveUserProfile, logKind = "xp_save_user_profile_failed" }) {
  if (!userId) return false;
  try {
    await save({ userId, totalXp: sanitizeXpCounter(totalXp), now });
    return true;
  } catch (error) {
    klog(logKind, { error: error?.message });
    return false;
  }
}

export { buildXpStatusSnapshot, persistXpProfileSnapshot, readCanonicalXpStatus };
