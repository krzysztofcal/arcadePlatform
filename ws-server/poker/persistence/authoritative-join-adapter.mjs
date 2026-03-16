
async function beginSqlDefault(fn, { env = process.env } = {}) {
  const bootstrapDb = await import("../bootstrap/persisted-bootstrap-db.mjs");
  return bootstrapDb.beginSqlWs(fn, { env });
}

async function loadHttpAuthoritativeJoinModule() {
  return import("../../../shared/poker-domain/join.mjs");
}

async function loadLedgerPostTransaction() {
  const ledgerModule = await import("../../../netlify/functions/_shared/chips-ledger.mjs");
  if (typeof ledgerModule?.postTransaction !== "function") {
    throw new Error("missing_post_transaction");
  }
  return ledgerModule.postTransaction;
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
  return { ok: true, tableId, userId, seatNo, stack, rejoin: result?.rejoin === true, requestId: requestId || null };
}

export function createAuthoritativeJoinExecutor({
  env = process.env,
  klog = () => {},
  beginSql = beginSqlDefault,
  loadJoinModule = loadHttpAuthoritativeJoinModule,
  loadPostTransactionFn = loadLedgerPostTransaction,
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

    try {
      const sharedArgs = {
        beginSql: (fn) => beginSql(fn, { env }),
        tableId,
        userId,
        requestId,
        klog,
        postTransactionFn,
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
