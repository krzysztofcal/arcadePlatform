async function beginSqlDefault(fn, { env = process.env } = {}) {
  const bootstrapDb = await import("../bootstrap/persisted-bootstrap-db.mjs");
  return bootstrapDb.beginSqlWs(fn, { env });
}

const DEFAULT_INACTIVE_CLEANUP_MODULE_URL = new URL("../../../shared/poker-domain/inactive-cleanup.mjs", import.meta.url).href;
const DEFAULT_INACTIVE_CLEANUP_DEPS_MODULE_URL = new URL("../../../shared/poker-domain/inactive-cleanup-deps.mjs", import.meta.url).href;

function isTerminalLoaderFailure(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message : "";
  return code === "ERR_MODULE_NOT_FOUND" || /Cannot find module/i.test(message) || /Failed to resolve module specifier/i.test(message);
}

export function createInactiveCleanupExecutor({
  env = process.env,
  klog = () => {},
  loadInactiveCleanupModule = () => import(DEFAULT_INACTIVE_CLEANUP_MODULE_URL),
  loadDepsModule = () => import(DEFAULT_INACTIVE_CLEANUP_DEPS_MODULE_URL),
  beginSql = beginSqlDefault
} = {}) {
  return async function executeInactiveCleanup({ tableId, userId, requestId }) {
    let module;
    let deps;
    try {
      [module, deps] = await Promise.all([loadInactiveCleanupModule(), loadDepsModule()]);
    } catch (error) {
      klog("ws_inactive_cleanup_unavailable", { tableId, userId, requestId: requestId || null, message: error?.message || "unknown" });
      return { ok: false, code: "temporarily_unavailable", retryable: !isTerminalLoaderFailure(error) };
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
