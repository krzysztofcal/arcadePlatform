async function beginSqlDefault(fn, { env = process.env } = {}) {
  const bootstrapDb = await import("../bootstrap/persisted-bootstrap-db.mjs");
  return bootstrapDb.beginSqlWs(fn, { env });
}

const DEFAULT_RECOVERY_MODULE_URL = new URL("../../shared/poker-domain/bot-claims-recovery.mjs", import.meta.url).href;

export async function loadBotClaimsRecoveryExecutorIfInactive({
  hasActivePresence,
  loadExecutor,
}) {
  if (typeof hasActivePresence !== "function" || hasActivePresence()) return null;
  const executor = await loadExecutor();
  return hasActivePresence() ? null : executor;
}

export function createBotClaimsRecoveryExecutor({
  env = process.env,
  klog = () => {},
  loadRecoveryModule = () => import(DEFAULT_RECOVERY_MODULE_URL),
  beginSql = beginSqlDefault,
} = {}) {
  return async function runBotClaimsRecovery(input) {
    const recovery = await loadRecoveryModule();
    const method = input?.mode === "execute"
      ? recovery.executeBotClaimsRecovery
      : recovery.preflightBotClaimsRecovery;
    if (typeof method !== "function") throw new Error("bot_claims_recovery_unavailable");
    return method({
      beginSql: (fn) => beginSql(fn, { env }),
      tableId: input.tableId,
      adminUserId: input.adminUserId,
      requestId: input.requestId,
      expectedStateVersion: input.expectedStateVersion,
      expectedInputHash: input.expectedInputHash,
      reason: input.reason,
      hasActivePresence: input.hasActivePresence,
      klog,
    });
  };
}
