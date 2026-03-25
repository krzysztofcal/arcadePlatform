async function beginSqlDefault(fn, { env = process.env } = {}) {
  const bootstrapDb = await import("../bootstrap/persisted-bootstrap-db.mjs");
  return bootstrapDb.beginSqlWs(fn, { env });
}

export function createInactiveCleanupExecutor({
  env = process.env,
  klog = () => {},
  loadInactiveCleanupModule = () => import("../../shared/poker-domain/inactive-cleanup.mjs"),
  loadDepsModule = () => import("../../shared/poker-domain/inactive-cleanup-deps.mjs"),
  beginSql = beginSqlDefault
} = {}) {
  return async function executeInactiveCleanup({ tableId, userId, requestId }) {
    let module;
    let deps;
    try {
      [module, deps] = await Promise.all([loadInactiveCleanupModule(), loadDepsModule()]);
    } catch (error) {
      klog("ws_inactive_cleanup_unavailable", { tableId, userId, requestId: requestId || null, message: error?.message || "unknown" });
      return { ok: false, code: "temporarily_unavailable" };
    }

    try {
      return await module.executeInactiveCleanup({
        beginSql: (fn) => beginSql(fn, { env }),
        tableId,
        userId,
        requestId,
        env,
        klog,
        postTransaction: deps?.postTransaction,
        isHoleCardsTableMissing: deps?.isHoleCardsTableMissing
      });
    } catch (error) {
      klog("ws_inactive_cleanup_failed", {
        tableId,
        userId,
        requestId: requestId || null,
        message: error?.message || "unknown",
        code: typeof error?.code === "string" ? error.code : null
      });
      return { ok: false, code: typeof error?.code === "string" ? error.code : "inactive_cleanup_failed" };
    }
  };
}
