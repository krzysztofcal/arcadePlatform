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

function resolveStateStacks(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  if (!state.stacks || typeof state.stacks !== "object" || Array.isArray(state.stacks)) return {};
  return state.stacks;
}

function stateFirstStackAmount({ state, seat, userId }) {
  const stateStack = normalizeNonNegativeInt(resolveStateStacks(state)?.[userId]);
  if (stateStack != null) return { amount: stateStack, source: "state" };
  const seatStack = normalizeNonNegativeInt(seat?.stack);
  if (seatStack != null) return { amount: seatStack, source: "seat" };
  return { amount: 0, source: "none" };
}

function isTurnProtected({ state, userId, nowMs }) {
  const turnUserId = typeof state?.turnUserId === "string" ? state.turnUserId : null;
  if (!turnUserId || turnUserId !== userId) return false;
  const turnDeadlineAt = Number(state?.turnDeadlineAt);
  if (!Number.isFinite(turnDeadlineAt) || turnDeadlineAt <= 0) return false;
  return turnDeadlineAt > nowMs;
}

function hasAnyActiveHuman(seats) {
  return (seats || []).some((row) => row?.is_bot !== true && row?.status === "ACTIVE");
}

function toClosedInertState({ state, stacks }) {
  return {
    ...state,
    phase: "HAND_DONE",
    handId: "",
    handSeed: "",
    showdown: null,
    community: [],
    communityDealt: 0,
    pot: 0,
    potTotal: 0,
    sidePots: [],
    turnUserId: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
    lastAggressorUserId: null,
    currentBet: 0,
    toCallByUserId: {},
    betThisRoundByUserId: {},
    actedThisRoundByUserId: {},
    stacks
  };
}

async function postCashout({ postTransaction, tx, tableId, userId, amount, idempotencyKey, createdBy, reason }) {
  if (!postTransaction || typeof postTransaction !== "function") {
    throw new Error("post_transaction_missing");
  }
  if (amount <= 0) return false;
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
  isHoleCardsTableMissing = () => false
}) {
  const sweepActorUserId = String(env?.POKER_SYSTEM_ACTOR_USER_ID || "").trim() || userId;
  return beginSql(async (tx) => {
    const seatRows = await tx.unsafe(
      "select table_id, user_id, seat_no, status, is_bot, stack from public.poker_seats where table_id = $1 and user_id = $2 limit 1 for update;",
      [tableId, userId]
    );
    const seat = seatRows?.[0] || null;
    if (!seat) return { ok: true, changed: false, status: "seat_missing", retryable: false };
    if (seat.is_bot === true) return { ok: true, changed: false, status: "bot_skipped", retryable: false };

    const stateRows = await tx.unsafe("select state from public.poker_state where table_id = $1 limit 1 for update;", [tableId]);
    const stateRow = stateRows?.[0] || null;
    const state = normalizeState(stateRow?.state);
    if (isTurnProtected({ state, userId, nowMs: Date.now() })) {
      return { ok: true, changed: false, protected: true, status: "turn_protected", retryable: true };
    }

    const stacks = { ...resolveStateStacks(state) };
    const seatWasActive = seat.status === "ACTIVE";
    if (seatWasActive) {
      const targetCashout = stateFirstStackAmount({ state, seat, userId });
      await postCashout({
        postTransaction,
        tx,
        tableId,
        userId,
        amount: targetCashout.amount,
        idempotencyKey: `poker:inactive_cleanup:${tableId}:${userId}`,
        createdBy: userId,
        reason: "ws_disconnect_inactive_cleanup"
      });
      delete stacks[userId];
      await tx.unsafe("update public.poker_seats set status = 'INACTIVE', stack = 0 where table_id = $1 and user_id = $2;", [tableId, userId]);
    }

    if (stateRow) {
      const nextState = { ...state, stacks };
      await tx.unsafe("update public.poker_state set state = $2 where table_id = $1;", [tableId, JSON.stringify(nextState)]);
    }

    const allSeatRows = await tx.unsafe(
      "select user_id, status, is_bot, stack from public.poker_seats where table_id = $1 for update;",
      [tableId]
    );

    if (hasAnyActiveHuman(allSeatRows)) {
      return { ok: true, changed: seatWasActive, status: seatWasActive ? "cleaned" : "already_inactive", closed: false, retryable: false };
    }

    const tableRows = await tx.unsafe("select status from public.poker_tables where id = $1 limit 1 for update;", [tableId]);
    const tableStatus = tableRows?.[0]?.status || null;

    for (const row of allSeatRows || []) {
      if (row?.is_bot === true) continue;
      const closeCashout = stateFirstStackAmount({ state: { stacks }, seat: row, userId: row.user_id });
      await postCashout({
        postTransaction,
        tx,
        tableId,
        userId: row.user_id,
        amount: closeCashout.amount,
        idempotencyKey: `poker:inactive_cleanup_close:${tableId}:${row.user_id}`,
        createdBy: sweepActorUserId,
        reason: "ws_disconnect_table_close"
      });
      delete stacks[row.user_id];
    }

    if (stateRow) {
      const finalState = toClosedInertState({ state, stacks });
      await tx.unsafe("update public.poker_state set state = $2 where table_id = $1;", [tableId, JSON.stringify(finalState)]);
    }

    await tx.unsafe("update public.poker_seats set status = 'INACTIVE', stack = 0 where table_id = $1 and is_bot = false;", [tableId]);

    let closed = false;
    if (tableStatus !== "CLOSED") {
      await tx.unsafe("update public.poker_tables set status = 'CLOSED', updated_at = now() where id = $1;", [tableId]);
      try {
        await tx.unsafe("delete from public.poker_hole_cards where table_id = $1;", [tableId]);
      } catch (error) {
        if (!isHoleCardsTableMissing(error)) throw error;
        klog("poker_hole_cards_missing", { tableId, error: error?.message || "unknown_error" });
      }
      closed = true;
    }

    return { ok: true, changed: seatWasActive || closed, status: closed ? "cleaned_closed" : "already_closed", closed, retryable: false };
  });
}
