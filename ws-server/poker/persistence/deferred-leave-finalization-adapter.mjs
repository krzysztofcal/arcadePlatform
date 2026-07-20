async function beginSqlDefault(fn, { env = process.env } = {}) {
  const bootstrapDb = await import("../bootstrap/persisted-bootstrap-db.mjs");
  return bootstrapDb.beginSqlWs(fn, { env });
}

function isRetryableFailure(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "terminal_accounting_invariant_failed") return false;
  return true;
}

export function createDeferredLeaveFinalizer({
  env = process.env,
  klog = () => {},
  loadLeaveModule = () => import("../../shared/poker-domain/leave.mjs"),
  beginSql = beginSqlDefault,
} = {}) {
  return async function finalizeDeferredLeaves({ tableId }) {
    try {
      const module = await loadLeaveModule();
      return await module.finalizeDeferredLeavesAfterSettlement({
        beginSql: (fn) => beginSql(fn, { env }),
        tableId,
        klog,
      });
    } catch (error) {
      const code = typeof error?.code === "string" ? error.code : "deferred_leave_finalization_failed";
      klog("ws_deferred_leave_finalization_failed", {
        tableId,
        code,
        message: error?.message || "unknown",
      });
      return { ok: false, changed: false, code, retryable: isRetryableFailure(error) };
    }
  };
}
