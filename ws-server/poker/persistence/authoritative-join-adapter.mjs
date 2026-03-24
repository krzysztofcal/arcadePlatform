
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
  if (["table_not_found", "table_closed", "table_not_open", "seat_taken", "table_full", "table_full_bot_leaving", "state_missing", "poker_state_missing", "state_invalid", "duplicate_seat", "invalid_seat_no", "invalid_buy_in", "request_pending", "insufficient_funds", "system_account_missing", "chips_apply_failed", "chips_apply_mismatch", "missing_idempotency_key", "invalid_escrow_only_entries", "authoritative_state_invalid"].includes(code)) {
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
  const rejoin = result?.rejoin === true;
  if (!Number.isInteger(stack) || stack <= 0) {
    klog("ws_join_authoritative_failed", { tableId, userId, requestId: requestId || null, code: "authoritative_state_invalid", message: "invalid_stack" });
    return { ok: false, code: "authoritative_state_invalid" };
  }
  const seededBots = Array.isArray(result?.seededBots) ? result.seededBots : [];
  const snapshot = result?.snapshot && typeof result.snapshot === "object" ? result.snapshot : null;
  const snapshotVersion = Number(snapshot?.stateVersion);
  const snapshotSeats = Array.isArray(snapshot?.seats) ? snapshot.seats : [];
  const snapshotStacks = snapshot?.stacks && typeof snapshot.stacks === "object" && !Array.isArray(snapshot.stacks) ? snapshot.stacks : {};
  const snapshotSeatKeys = new Set(
    snapshotSeats
      .map((seat) => {
        const seatUserId = typeof seat?.userId === "string" ? seat.userId.trim() : "";
        const snapshotSeatNo = Number(seat?.seatNo);
        return seatUserId && Number.isInteger(snapshotSeatNo) && snapshotSeatNo >= 1 ? `${seatUserId}:${snapshotSeatNo}` : null;
      })
      .filter(Boolean)
  );
  if (!snapshot || !Number.isInteger(snapshotVersion) || snapshotVersion <= 0) {
    klog("ws_join_authoritative_failed", { tableId, userId, requestId: requestId || null, code: "authoritative_state_invalid", message: "invalid_snapshot_version" });
    return { ok: false, code: "authoritative_state_invalid" };
  }
  if (!snapshotSeatKeys.has(`${userId}:${seatNo}`) || Number(snapshotStacks[userId]) <= 0 || (!rejoin && Number(snapshotStacks[userId]) !== stack)) {
    klog("ws_join_authoritative_failed", { tableId, userId, requestId: requestId || null, code: "authoritative_state_invalid", message: "missing_human_snapshot_state" });
    return { ok: false, code: "authoritative_state_invalid" };
  }
  for (const bot of seededBots) {
    const botUserId = typeof bot?.userId === "string" ? bot.userId : "";
    const botSeatNo = Number(bot?.seatNo);
    const botStack = Number(bot?.stack);
    if (!botUserId || !Number.isInteger(botSeatNo) || botSeatNo < 1 || !snapshotSeatKeys.has(`${botUserId}:${botSeatNo}`) || Number(snapshotStacks[botUserId]) !== botStack) {
      klog("ws_join_authoritative_failed", { tableId, userId, requestId: requestId || null, code: "authoritative_state_invalid", message: "missing_seeded_bot_snapshot_state" });
      return { ok: false, code: "authoritative_state_invalid" };
    }
  }
  return {
    ok: true,
    tableId,
    userId,
    seatNo,
    stack,
    rejoin,
    requestId: requestId || null,
    seededBots,
    snapshot
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
    klog("ws_authoritative_adapter_start", {
      tableId,
      userId,
      requestId: requestId || null
    });
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
        beginSql: (fn) => beginSql((tx) => {
          const txWithKlog = Object.create(tx || null);
          txWithKlog.klog = klog;
          return fn(txWithKlog);
        }, { env }),
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
      const normalized = normalizeSuccess(result, { tableId, userId, requestId, klog });
      if (!normalized?.ok) {
        if (normalized?.code === "authoritative_state_invalid") {
          klog("ws_authoritative_adapter_invalid_snapshot", {
            snapshotVersion: Number(result?.snapshot?.stateVersion) || null,
            reason: "authoritative_state_invalid"
          });
        }
        return normalized;
      }
      klog("ws_authoritative_adapter_success", {
        seatNo: normalized.seatNo,
        stack: normalized.stack,
        rejoin: normalized.rejoin === true,
        snapshotVersion: Number(normalized?.snapshot?.stateVersion) || null,
        seatsCount: Array.isArray(normalized?.snapshot?.seats) ? normalized.snapshot.seats.length : 0,
        stacksCount: normalized?.snapshot?.stacks && typeof normalized.snapshot.stacks === "object" && !Array.isArray(normalized.snapshot.stacks)
          ? Object.keys(normalized.snapshot.stacks).length
          : 0,
        seededBotsCount: Array.isArray(normalized?.seededBots) ? normalized.seededBots.length : 0
      });
      return normalized;
    } catch (error) {
      klog("ws_authoritative_adapter_error", {
        code: typeof error?.code === "string" ? error.code : "authoritative_join_failed",
        message: error?.message || "unknown"
      });
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
