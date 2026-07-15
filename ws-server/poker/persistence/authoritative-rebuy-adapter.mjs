async function beginSqlDefault(fn, { env = process.env } = {}) {
  const bootstrapDb = await import("../bootstrap/persisted-bootstrap-db.mjs");
  return bootstrapDb.beginSqlWs(fn, { env });
}

async function loadRebuyModuleDefault() {
  return import("../../shared/poker-domain/rebuy.mjs");
}

async function loadPostTransactionDefault() {
  const ledger = await import("./chips-ledger.mjs");
  if (typeof ledger?.postTransaction !== "function") throw new Error("missing_post_transaction");
  return ledger.postTransaction;
}

const DEFAULT_STORAGE_STATE_OPTIONS = Object.freeze({
  requireNoDeck: true,
  requireHandSeed: false,
  requireCommunityDealt: false
});

async function loadLockedStateHelpersDefault() {
  const [locked, stateUtils] = await Promise.all([
    import("./poker-state-write-locked.mjs"),
    import("../snapshot-runtime/poker-state-utils.mjs")
  ]);
  if (typeof locked?.loadPokerStateForUpdate !== "function" || typeof locked?.updatePokerStateLocked !== "function" || typeof stateUtils?.isStateStorageValid !== "function") {
    throw new Error("missing_locked_state_helpers");
  }
  return {
    loadStateForUpdate: locked.loadPokerStateForUpdate,
    updateStateLocked: locked.updatePokerStateLocked,
    validateStateForStorage: (state) => stateUtils.isStateStorageValid(state, DEFAULT_STORAGE_STATE_OPTIONS)
  };
}

function normalizeError(error) {
  const sourceCode = typeof error?.code === "string" ? error.code : "authoritative_rebuy_failed";
  const sourceMessage = typeof error?.message === "string" ? error.message.trim() : "";
  const code = sourceCode === "insufficient_funds" || (sourceCode === "P0001" && sourceMessage === "insufficient_funds")
    ? "insufficient_chips"
    : sourceCode === "40P01" || sourceCode === "40001"
      ? "temporarily_unavailable"
      : sourceCode;
  const allowed = new Set([
    "invalid_request",
    "invalid_rebuy_amount",
    "request_pending",
    "request_result_invalid",
    "table_not_found",
    "table_not_open",
    "seat_not_active",
    "rebuy_not_allowed",
    "rebuy_not_available",
    "stack_ambiguous",
    "state_missing",
    "state_invalid",
    "state_conflict",
    "seat_projection_conflict",
    "temporarily_unavailable",
    "insufficient_chips",
    "system_account_missing",
    "system_account_inactive",
    "chips_apply_failed",
    "chips_apply_mismatch",
    "idempotency_mismatch"
  ]);
  return { ok: false, code: allowed.has(code) ? code : "authoritative_rebuy_failed" };
}

function fileStoreOnly(env) {
  return Boolean(String(env?.WS_PERSISTED_STATE_FILE || "").trim()) && !String(env?.SUPABASE_DB_URL || "").trim();
}

export function createAuthoritativeRebuyExecutor({
  env = process.env,
  klog = () => {},
  beginSql = beginSqlDefault,
  loadRebuyModule = loadRebuyModuleDefault,
  loadPostTransaction = loadPostTransactionDefault,
  loadLockedStateHelpers = loadLockedStateHelpersDefault
} = {}) {
  return async function executeAuthoritativeRebuy({ tableId, userId, requestId, amount = 100 }) {
    if (fileStoreOnly(env)) return { ok: false, code: "temporarily_unavailable" };

    let rebuyModule;
    let postTransactionFn;
    let locked;
    try {
      [rebuyModule, postTransactionFn, locked] = await Promise.all([
        loadRebuyModule(),
        loadPostTransaction(),
        loadLockedStateHelpers()
      ]);
    } catch (error) {
      klog("ws_rebuy_authoritative_unavailable", { tableId, requestId: requestId || null, message: error?.message || "unknown" });
      return { ok: false, code: "temporarily_unavailable" };
    }
    if (typeof rebuyModule?.executePokerRebuyAuthoritative !== "function") return { ok: false, code: "temporarily_unavailable" };

    try {
      return await rebuyModule.executePokerRebuyAuthoritative({
        beginSql: (fn) => beginSql((tx) => {
          const txWithKlog = Object.create(tx || null);
          txWithKlog.klog = klog;
          return fn(txWithKlog);
        }, { env }),
        tableId,
        userId,
        requestId,
        amount,
        postTransactionFn,
        loadStateForUpdate: locked.loadStateForUpdate,
        updateStateLocked: locked.updateStateLocked,
        validateStateForStorage: locked.validateStateForStorage,
        klog
      });
    } catch (error) {
      const normalized = normalizeError(error);
      const sourceCode = typeof error?.code === "string" && /^[A-Za-z0-9_]{2,64}$/.test(error.code) ? error.code : null;
      klog("ws_rebuy_authoritative_failed", { tableId, requestId: requestId || null, code: normalized.code, sourceCode });
      return normalized;
    }
  };
}
