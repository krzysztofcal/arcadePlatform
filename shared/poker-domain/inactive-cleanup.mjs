import { requireAuthoritativeHumanStack } from "./human-stack-accounting.mjs";
import { executeTerminalPokerCloseInTx } from "./terminal-close.mjs";

const normalizeState = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) return value;
  return {};
};

const normalizeNonNegativeInt = (n) => {
  const value = Number(n);
  if (!Number.isInteger(value) || value < 0 || Math.abs(value) > Number.MAX_SAFE_INTEGER) return null;
  return value;
};

const DEFAULT_TABLE_CLOSE_GRACE_MS = 60_000;
const DEFAULT_LIVE_HAND_STALE_MS = 15_000;
const ACTION_HAND_PHASES = new Set(["PREFLOP", "FLOP", "TURN", "RIVER"]);
const LIVE_HAND_PHASES = new Set([...ACTION_HAND_PHASES, "SHOWDOWN"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEDGER_IDEMPOTENCY_CONSTRAINT = "chips_transactions_idempotency_key_unique";

function normalizePositiveInt(n) {
  const value = Number(n);
  if (!Number.isInteger(value) || value <= 0 || Math.abs(value) > Number.MAX_SAFE_INTEGER) return null;
  return value;
}

function normalizeSeatNo(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || Math.abs(parsed) > Number.MAX_SAFE_INTEGER) return null;
  return parsed;
}

function isUuidLike(value) {
  return UUID_RE.test(String(value || "").trim());
}

function parseTimestampMs(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveCloseGraceMs(env) {
  return normalizePositiveInt(env?.POKER_TABLE_CLOSE_GRACE_MS) ?? DEFAULT_TABLE_CLOSE_GRACE_MS;
}

function resolveLiveHandStaleMs(env) {
  return normalizePositiveInt(env?.POKER_LIVE_HAND_STALE_MS) ?? DEFAULT_LIVE_HAND_STALE_MS;
}

function hasLiveHandSignal(state) {
  const phase = typeof state?.phase === "string" ? state.phase : "";
  return LIVE_HAND_PHASES.has(phase);
}

function resolveLiveHandLogicalStaleReason({ state, nowMs, staleAfterMs }) {
  const phase = typeof state?.phase === "string" ? state.phase : "";
  if (!ACTION_HAND_PHASES.has(phase)) return null;
  const turnUserId = typeof state?.turnUserId === "string" && state.turnUserId.trim() ? state.turnUserId.trim() : null;
  if (!turnUserId) return "missing_turn_user";
  const turnDeadlineAt = Number(state?.turnDeadlineAt);
  if (!Number.isFinite(turnDeadlineAt) || turnDeadlineAt <= 0) return null;
  if (nowMs >= turnDeadlineAt + staleAfterMs) return "turn_deadline_expired";
  return null;
}

function resolveStateStacks(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  if (!state.stacks || typeof state.stacks !== "object" || Array.isArray(state.stacks)) return {};
  return state.stacks;
}

function resolveSeatPresenceFreshness({ seat, nowMs, staleAfterMs }) {
  const lastSeenAtMs = parseTimestampMs(seat?.last_seen_at);
  if (!Number.isFinite(lastSeenAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    return null;
  }
  return nowMs - lastSeenAtMs < staleAfterMs;
}

function isTurnProtected({ state, userId, nowMs, seatPresenceFresh = null }) {
  if (seatPresenceFresh === false) return false;
  const turnUserId = typeof state?.turnUserId === "string" ? state.turnUserId : null;
  if (!turnUserId || turnUserId !== userId) return false;
  const turnDeadlineAt = Number(state?.turnDeadlineAt);
  if (!Number.isFinite(turnDeadlineAt) || turnDeadlineAt <= 0) return false;
  return turnDeadlineAt > nowMs;
}

function activeSeatUserIdSet(seats) {
  const ids = new Set();
  for (const row of seats || []) {
    if (row?.status !== "ACTIVE") continue;
    if (typeof row?.user_id === "string" && row.user_id.length > 0) {
      ids.add(row.user_id);
    }
  }
  return ids;
}

function hasReplacementBotSeatMatch({ state, seats, userId }) {
  if (typeof userId !== "string" || !userId) return false;
  const stateSeats = Array.isArray(state?.seats) ? state.seats : [];
  const turnSeat = stateSeats.find((seat) => seat?.userId === userId) || null;
  const seatNo = normalizeSeatNo(turnSeat?.seatNo ?? turnSeat?.seat_no ?? turnSeat?.seat);
  if (!seatNo) return false;
  return (seats || []).some((row) => (
    row?.status === "ACTIVE"
    && row?.is_bot === true
    && normalizeSeatNo(row?.seat_no) === seatNo
  ));
}

function isLedgerIdempotencyDuplicate(error) {
  if (String(error?.code || "") !== "23505") return false;
  const constraint = String(error?.constraint || "");
  const message = String(error?.message || "");
  return constraint === LEDGER_IDEMPOTENCY_CONSTRAINT || message.includes(LEDGER_IDEMPOTENCY_CONSTRAINT);
}

async function postCashout({ postTransaction, tx, tableId, userId, amount, idempotencyKey, createdBy, reason }) {
  if (!postTransaction || typeof postTransaction !== "function") {
    throw new Error("post_transaction_missing");
  }
  if (amount <= 0) return false;
  try {
    await postTransaction({
      userId,
      txType: "TABLE_CASH_OUT",
      idempotencyKey,
      reference: `table:${tableId}`,
      metadata: { tableId, reason },
      entries: [
        { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -amount },
        { accountType: "USER", amount }
      ],
      createdBy,
      tx
    });
  } catch (error) {
    if (!isLedgerIdempotencyDuplicate(error)) throw error;
  }
  return true;
}

export async function executeInactiveCleanup({
  beginSql,
  tableId,
  userId,
  requestId,
  env = process.env,
  klog = () => {},
  postTransaction,
  hasConnectedHumanPresence = () => false,
  executeTerminalClose = executeTerminalPokerCloseInTx
}) {
  const normalizedUserId = typeof userId === "string" && userId.trim() ? userId.trim() : null;
  const configuredSystemActorUserId = String(env?.POKER_SYSTEM_ACTOR_USER_ID || "").trim();
  const sweepActorUserId =
    (isUuidLike(configuredSystemActorUserId) ? configuredSystemActorUserId : null)
    ?? (isUuidLike(normalizedUserId) ? normalizedUserId : null);
  const closeGraceMs = resolveCloseGraceMs(env);
  const liveHandStaleMs = resolveLiveHandStaleMs(env);
  return beginSql(async (tx) => {
    let seat = null;
    if (normalizedUserId) {
      const seatRows = await tx.unsafe(
        "select table_id, user_id, seat_no, status, is_bot, stack, last_seen_at from public.poker_seats where table_id = $1 and user_id = $2 limit 1 for update;",
        [tableId, normalizedUserId]
      );
      seat = seatRows?.[0] || null;
      if (!seat) return { ok: true, changed: false, status: "seat_missing", retryable: false };
      if (seat.is_bot === true) return { ok: true, changed: false, status: "bot_skipped", retryable: false };
    }

    const stateRows = await tx.unsafe("select state from public.poker_state where table_id = $1 limit 1 for update;", [tableId]);
    const stateRow = stateRows?.[0] || null;
    const state = normalizeState(stateRow?.state);
    const nowMs = Date.now();
    const seatPresenceFresh = normalizedUserId
      ? resolveSeatPresenceFreshness({ seat, nowMs, staleAfterMs: liveHandStaleMs })
      : null;
    if (normalizedUserId && isTurnProtected({ state, userId: normalizedUserId, nowMs, seatPresenceFresh })) {
      return { ok: true, changed: false, protected: true, status: "turn_protected", retryable: true };
    }

    const tableRows = await tx.unsafe(
      "select status, created_at, last_activity_at, updated_at from public.poker_tables where id = $1 limit 1 for update;",
      [tableId]
    );
    const tableCreatedAtMs = parseTimestampMs(tableRows?.[0]?.created_at);
    const tableLastActivityAtMs =
      parseTimestampMs(tableRows?.[0]?.last_activity_at)
      ?? parseTimestampMs(tableRows?.[0]?.updated_at)
      ?? tableCreatedAtMs;
    const seatWasActive = seat?.status === "ACTIVE";
    if (hasLiveHandSignal(state)) {
      const logicalStaleReason =
        normalizedUserId == null
          ? resolveLiveHandLogicalStaleReason({ state, nowMs, staleAfterMs: liveHandStaleMs })
          : null;
      const liveHandIsFresh =
        (normalizedUserId == null || seatPresenceFresh !== false)
        &&
        !logicalStaleReason
        && (
          tableLastActivityAtMs == null
          || nowMs - tableLastActivityAtMs < liveHandStaleMs
        );
      if (liveHandIsFresh) {
        klog("poker_inactive_cleanup_live_hand_preserved", {
          tableId,
          userId: normalizedUserId,
          phase: typeof state?.phase === "string" ? state.phase : null,
          seatWasActive,
          seatPresenceFresh: normalizedUserId == null ? null : seatPresenceFresh
        });
        return {
          ok: true,
          changed: false,
          deferred: normalizedUserId !== null,
          status: seatWasActive ? "cleaned_live_hand_preserved" : "live_hand_preserved",
          closed: false,
          retryable: false
        };
      }
      klog("poker_inactive_cleanup_stale_live_hand_closing", {
        tableId,
        userId: normalizedUserId,
        phase: typeof state?.phase === "string" ? state.phase : null,
        staleReason: logicalStaleReason ?? "table_activity_stale",
        turnUserId: typeof state?.turnUserId === "string" ? state.turnUserId : null,
        turnDeadlineAt: Number.isFinite(Number(state?.turnDeadlineAt)) ? Number(state.turnDeadlineAt) : null,
        lastActivityAtMs: tableLastActivityAtMs,
        staleForMs: tableLastActivityAtMs == null ? null : Math.max(0, nowMs - tableLastActivityAtMs)
      });
    }

    const allSeatRows = await tx.unsafe(
      "select user_id, seat_no, status, is_bot, stack from public.poker_seats where table_id = $1 for update;",
      [tableId]
    );
    const anotherActiveHumanRemains = (allSeatRows || []).some((row) => (
      row?.is_bot !== true
      && row?.status === "ACTIVE"
      && !(seatWasActive && row?.user_id === normalizedUserId)
    ));
    if (anotherActiveHumanRemains) {
      if (!normalizedUserId) {
        return { ok: true, changed: false, status: "active_human_present", closed: false, retryable: false };
      }
      const stacks = { ...resolveStateStacks(state) };
      if (seatWasActive) {
        let targetCashout;
        try {
          targetCashout = requireAuthoritativeHumanStack({ state, userId: normalizedUserId });
        } catch (error) {
          klog("poker_inactive_cleanup_stack_ambiguous", { tableId, reason: error?.code || "stack_ambiguous", source: "ambiguous" });
          throw error;
        }
        await postCashout({
          postTransaction,
          tx,
          tableId,
          userId: normalizedUserId,
          amount: targetCashout.amount,
          idempotencyKey: `poker:inactive_cleanup:${tableId}:${normalizedUserId}`,
          createdBy: normalizedUserId,
          reason: "ws_disconnect_inactive_cleanup"
        });
        delete stacks[normalizedUserId];
        await tx.unsafe("update public.poker_seats set status = 'INACTIVE', stack = 0 where table_id = $1 and user_id = $2;", [tableId, normalizedUserId]);
      }
      if (stateRow) {
        const nextState = { ...state, stacks };
        const turnUserId = typeof nextState.turnUserId === "string" ? nextState.turnUserId : null;
        const projectedSeats = seatWasActive
          ? allSeatRows.map((row) => row?.user_id === normalizedUserId ? { ...row, status: "INACTIVE", stack: 0 } : row)
          : allSeatRows;
        if (
          turnUserId
          && !activeSeatUserIdSet(projectedSeats).has(turnUserId)
          && !hasReplacementBotSeatMatch({ state: nextState, seats: projectedSeats, userId: turnUserId })
        ) {
          nextState.turnUserId = null;
        }
        await tx.unsafe("update public.poker_state set state = $2 where table_id = $1;", [tableId, JSON.stringify(nextState)]);
      }
      return { ok: true, changed: seatWasActive, status: seatWasActive ? "cleaned" : "already_inactive", closed: false, retryable: false };
    }

    if (hasConnectedHumanPresence({ tableId }) === true) {
      klog("poker_inactive_cleanup_table_close_skipped_human_presence", {
        tableId,
        userId: normalizedUserId,
        phase: typeof state?.phase === "string" ? state.phase : null,
        seatWasActive
      });
      return {
        ok: true,
        changed: false,
        status: "human_presence_present",
        closed: false,
        retryable: false
      };
    }

    if (tableCreatedAtMs != null && nowMs - tableCreatedAtMs < closeGraceMs) {
      return { ok: false, code: "grace_period", retryable: true, status: "grace_period", closed: false };
    }
    return executeTerminalClose({
      tx,
      tableId,
      postTransaction,
      createdBy: sweepActorUserId,
      closeReason: normalizedUserId ? "WS_DISCONNECT_TABLE_CLOSE" : "WS_INACTIVE_TABLE_CLOSE",
      successStatus: "cleaned_closed",
      klog
    });
  });
}
