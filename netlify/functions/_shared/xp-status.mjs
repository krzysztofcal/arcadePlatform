import { klog } from "./supabase-admin.mjs";
import { saveUserProfile } from "./store-upstash.mjs";
import { sanitizeXpCounter } from "./xp-ledger.mjs";

function buildXpStatusSnapshot({ totals, dailyCap, deltaCap, sessionId, status = "statusOnly" }) {
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
  return snapshot;
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

export { buildXpStatusSnapshot, persistXpProfileSnapshot };
