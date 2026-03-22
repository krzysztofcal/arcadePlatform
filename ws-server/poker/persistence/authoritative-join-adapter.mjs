
async function beginSqlDefault(fn, { env = process.env } = {}) {
  const bootstrapDb = await import("../bootstrap/persisted-bootstrap-db.mjs");
  return bootstrapDb.beginSqlWs(fn, { env });
}

async function loadHttpAuthoritativeJoinModule() {
  return import("../../../shared/poker-domain/join.mjs");
}

async function loadLedgerPostTransaction() {
  const ledgerModule = await import("./chips-ledger.mjs");
  if (typeof ledgerModule?.postTransaction !== "function") {
    throw new Error("missing_post_transaction");
  }
  return ledgerModule.postTransaction;
}

const DEFAULT_STORAGE_STATE_OPTIONS = Object.freeze({
  requireNoDeck: true,
  requireHandSeed: false,
  requireCommunityDealt: false
});

async function loadLockedStateHelpers() {
  const [lockedModule, stateUtilsModule] = await Promise.all([
    import("./poker-state-write-locked.mjs"),
    import("../snapshot-runtime/poker-state-utils.mjs")
  ]);
  if (typeof lockedModule?.loadPokerStateForUpdate !== "function" || typeof lockedModule?.updatePokerStateLocked !== "function" || typeof stateUtilsModule?.isStateStorageValid !== "function") {
    throw new Error("missing_locked_state_helpers");
  }
  return {
    loadStateForUpdate: lockedModule.loadPokerStateForUpdate,
    updateStateLocked: lockedModule.updatePokerStateLocked,
    validateStateForStorage: (state) => stateUtilsModule.isStateStorageValid(state, DEFAULT_STORAGE_STATE_OPTIONS)
  };
}

function resolveJoinTestOverride(env = process.env) {
  const raw = env.WS_TEST_AUTHORITATIVE_JOIN_RESULT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeJoinError(error) {
  const code = typeof error?.code === "string" ? error.code : "authoritative_join_failed";
  if (["table_not_found", "table_closed", "table_not_open", "seat_taken", "table_full", "table_full_bot_leaving", "state_missing", "poker_state_missing", "state_invalid", "duplicate_seat", "invalid_seat_no", "invalid_buy_in", "request_pending", "insufficient_funds", "system_account_missing", "chips_apply_failed", "chips_apply_mismatch", "missing_idempotency_key", "invalid_escrow_only_entries"].includes(code)) {
    return { ok: false, code };
  }
  return { ok: false, code: "authoritative_join_failed" };
}

function shouldUseLedgerFallback(env = process.env) {
  const hasFileStore = Boolean(typeof env?.WS_PERSISTED_STATE_FILE === "string" && env.WS_PERSISTED_STATE_FILE.trim());
  const hasSupabaseDb = Boolean(typeof env?.SUPABASE_DB_URL === "string" && env.SUPABASE_DB_URL.trim());
  return hasFileStore && !hasSupabaseDb;
}

function noopPostTransaction() {
  return { ok: true };
}

function normalizeSuccess(result, { tableId, userId, requestId, klog }) {

  if (!result?.ok) return result;
  const seatNo = Number(result?.seatNo);
  if (!Number.isInteger(seatNo) || seatNo < 1) {
    klog("ws_join_authoritative_failed", { tableId, userId, requestId: requestId || null, code: "authoritative_state_invalid", message: "invalid_seat" });
    return { ok: false, code: "authoritative_state_invalid" };
  }
  const stack = Number(result?.stack);
  if (!Number.isInteger(stack) || stack <= 0) {
    klog("ws_join_authoritative_failed", { tableId, userId, requestId: requestId || null, code: "authoritative_state_invalid", message: "invalid_stack" });
    return { ok: false, code: "authoritative_state_invalid" };
  }
  return {
    ok: true,
    tableId,
    userId,
    seatNo,
    stack,
    rejoin: result?.rejoin === true,
    requestId: requestId || null,
    seededBots: Array.isArray(result?.seededBots) ? result.seededBots : [],
    snapshot: result?.snapshot && typeof result.snapshot === "object" ? result.snapshot : null
  };
}

export function createAuthoritativeJoinExecutor({
  env = process.env,
  klog = () => {},
  beginSql = beginSqlDefault,
  loadJoinModule = loadHttpAuthoritativeJoinModule,
  loadPostTransactionFn = loadLedgerPostTransaction,
  loadLockedStateHelpersFn = loadLockedStateHelpers,
} = {}) {
  return async function executeAuthoritativeJoin({ tableId, userId, requestId, seatNo = null, autoSeat = false, preferredSeatNo = null, buyIn = null }) {
    const override = resolveJoinTestOverride(env);
    if (override) {
      return override;
    }

    let joinModule;
    try {
      joinModule = await loadJoinModule();
    } catch (error) {
      klog("ws_join_authoritative_unavailable", {
        tableId,
        userId,
        requestId: requestId || null,
        message: error?.message || "unknown",
      });
      return { ok: false, code: "temporarily_unavailable" };
    }

    if (typeof joinModule?.executePokerJoinAuthoritative !== "function") {
      klog("ws_join_authoritative_unavailable", {
        tableId,
        userId,
        requestId: requestId || null,
        message: "missing_executePokerJoinAuthoritative",
      });
      return { ok: false, code: "temporarily_unavailable" };
    }

    let postTransactionFn;
    if (shouldUseLedgerFallback(env)) {
      klog("ws_join_authoritative_ledger_fallback", {
        tableId,
        userId,
        requestId: requestId || null,
        message: "file_store_no_ledger"
      });
      postTransactionFn = noopPostTransaction;
    } else {
      try {
        postTransactionFn = await loadPostTransactionFn();
      } catch (error) {
        klog("ws_join_authoritative_unavailable", {
          tableId,
          userId,
          requestId: requestId || null,
          message: error?.message || "post_transaction_unavailable",
        });
        return { ok: false, code: "temporarily_unavailable" };
      }
    }

    let lockedStateHelpers;
    try {
      lockedStateHelpers = await loadLockedStateHelpersFn();
      if (typeof lockedStateHelpers?.loadStateForUpdate !== "function" || typeof lockedStateHelpers?.updateStateLocked !== "function" || typeof lockedStateHelpers?.validateStateForStorage !== "function") {
        throw new Error("missing_locked_state_helpers");
      }
    } catch (error) {
      klog("ws_join_authoritative_unavailable", {
        tableId,
        userId,
        requestId: requestId || null,
        message: error?.message || "locked_state_helpers_unavailable"
      });
      return { ok: false, code: "temporarily_unavailable" };
    }

    try {
      const sharedArgs = {
        beginSql: (fn) => beginSql(fn, { env }),
        tableId,
        userId,
        requestId,
        klog,
        postTransactionFn,
        loadStateForUpdate: lockedStateHelpers.loadStateForUpdate,
        updateStateLocked: lockedStateHelpers.updateStateLocked,
        validateStateForStorage: lockedStateHelpers.validateStateForStorage
      };
      if (seatNo !== null && seatNo !== undefined) sharedArgs.seatNo = seatNo;
      if (autoSeat === true) sharedArgs.autoSeat = true;
      if (preferredSeatNo !== null && preferredSeatNo !== undefined) sharedArgs.preferredSeatNo = preferredSeatNo;
      if (buyIn !== null && buyIn !== undefined) sharedArgs.buyIn = buyIn;

      const result = await joinModule.executePokerJoinAuthoritative(sharedArgs);
      return normalizeSuccess(result, { tableId, userId, requestId, klog });
    } catch (error) {
      klog("ws_join_authoritative_failed", {
        tableId,
        userId,
        requestId: requestId || null,
        code: typeof error?.code === "string" ? error.code : null,
        message: error?.message || "unknown",
      });
      return normalizeJoinError(error);
    }
  };
}
