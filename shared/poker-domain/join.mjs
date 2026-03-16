const BUY_IN_IDEMPOTENCY_CONSTRAINT = "chips_transactions_idempotency_key_unique";

async function resolvePostTransactionFn(postTransactionFn) {
  if (typeof postTransactionFn === "function") return postTransactionFn;
  const ledgerModule = await import("../../netlify/functions/_shared/chips-ledger.mjs");
  if (typeof ledgerModule?.postTransaction !== "function") {
    throw makeError("temporarily_unavailable");
  }
  return ledgerModule.postTransaction;
}

function parseStateValue(value) {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw makeError("state_invalid");
      }
      return parsed;
    } catch {
      throw makeError("state_invalid");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw makeError("state_invalid");
  }
  return value;
}

function makeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isSeatConflictError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "seat_taken") return true;
  if (code === "23505") {
    const constraint = String(error?.constraint || "").toLowerCase();
    const detail = String(error?.detail || "").toLowerCase();
    if (constraint.includes("seat_no") || constraint.includes("user_id")) return true;
    if (detail.includes("seat_no") || detail.includes("user_id")) return true;
  }
  return false;
}

function normalizePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function isBuyInIdempotencyDuplicate(error) {
  if (String(error?.code || "") !== "23505") return false;
  const constraint = String(error?.constraint || "");
  const message = String(error?.message || "");
  return constraint === BUY_IN_IDEMPOTENCY_CONSTRAINT || message.includes(BUY_IN_IDEMPOTENCY_CONSTRAINT);
}

async function syncStateSeatAndStack({ tx, tableId, userId, seatNo, stack }) {
  const stateRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", [tableId]);
  const stateRow = stateRows?.[0] || null;
  if (!stateRow) throw makeError("state_missing");
  const state = parseStateValue(stateRow.state);
  const seats = Array.isArray(state.seats) ? state.seats.filter((seat) => seat?.userId !== userId) : [];
  seats.push({ userId, seatNo });
  const stacks = state.stacks && typeof state.stacks === "object" && !Array.isArray(state.stacks) ? { ...state.stacks } : {};
  stacks[userId] = stack;
  const nextState = { ...state, tableId, seats, stacks };
  await tx.unsafe("update public.poker_state set state = $2::jsonb where table_id = $1;", [tableId, JSON.stringify(nextState)]);
}

async function readPersistedSeatStack({ tx, tableId, userId }) {
  const rows = await tx.unsafe(
    "select seat_no, stack from public.poker_seats where table_id = $1 and user_id = $2 and status = 'ACTIVE' limit 1;",
    [tableId, userId]
  );
  const seatNo = Number(rows?.[0]?.seat_no);
  const stack = Number(rows?.[0]?.stack);
  if (!Number.isInteger(seatNo) || seatNo < 1 || !Number.isInteger(stack) || stack <= 0) {
    throw makeError("state_invalid");
  }
  return { seatNo, stack };
}

export async function executePokerJoinAuthoritative({ beginSql, tableId, userId, requestId, seatNo = null, autoSeat = false, preferredSeatNo = null, buyIn = null, klog = () => {}, postTransactionFn = null }) {
  const runPostTransaction = await resolvePostTransactionFn(postTransactionFn);
  return beginSql(async (tx) => {
    const resolvedBuyIn = normalizePositiveInt(buyIn);
    if (!resolvedBuyIn) throw makeError("invalid_buy_in");

    const tableRows = await tx.unsafe(
      "select id, status, max_players from public.poker_tables where id = $1 limit 1;",
      [tableId]
    );
    const table = tableRows?.[0] || null;
    if (!table) throw makeError("table_not_found");

    const existingRows = await tx.unsafe(
      "select seat_no from public.poker_seats where table_id = $1 and user_id = $2 and status = 'ACTIVE' limit 1;",
      [tableId, userId]
    );
    const existingSeatNo = Number(existingRows?.[0]?.seat_no);
    if (Number.isInteger(existingSeatNo) && existingSeatNo >= 1) {
      if (String(table.status || "").toUpperCase() === "CLOSED") throw makeError("table_closed");
      await tx.unsafe(
        "update public.poker_seats set status = 'ACTIVE', last_seen_at = now() where table_id = $1 and user_id = $2;",
        [tableId, userId]
      );
      const persisted = await readPersistedSeatStack({ tx, tableId, userId });
      await syncStateSeatAndStack({ tx, tableId, userId, seatNo: persisted.seatNo, stack: persisted.stack });
      await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);
      return { ok: true, tableId, userId, seatNo: persisted.seatNo, stack: persisted.stack, rejoin: true, requestId: requestId || null, me: { seated: true } };
    }

    const status = String(table.status || "").toUpperCase();
    if (status === "CLOSED") throw makeError("table_closed");
    if (status && status !== "OPEN") throw makeError("table_not_open");

    const maxPlayers = Number(table.max_players);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 1) throw makeError("table_not_open");

    const occupiedRows = await tx.unsafe(
      "select seat_no from public.poker_seats where table_id = $1 and status = 'ACTIVE' order by seat_no asc;",
      [tableId]
    );
    const occupied = new Set((occupiedRows || []).map((row) => Number(row?.seat_no)).filter((n) => Number.isInteger(n) && n >= 1));
    const requestedSeatNo = seatNo === null || seatNo === undefined ? null : (Number.isInteger(Number(seatNo)) ? Number(seatNo) : null);
    const preferredSeatNoRequested = preferredSeatNo === null || preferredSeatNo === undefined ? null : (Number.isInteger(Number(preferredSeatNo)) ? Number(preferredSeatNo) : null);

    let resolvedSeatNo = null;
    if (requestedSeatNo !== null && !autoSeat) {
      if (requestedSeatNo < 1 || requestedSeatNo > maxPlayers) throw makeError("invalid_seat_no");
      if (occupied.has(requestedSeatNo)) throw makeError("seat_taken");
      resolvedSeatNo = requestedSeatNo;
    }

    if (!Number.isInteger(resolvedSeatNo)) {
      const startSeat = Number.isInteger(preferredSeatNoRequested) && preferredSeatNoRequested >= 1 && preferredSeatNoRequested <= maxPlayers ? preferredSeatNoRequested : 1;
      for (let offset = 0; offset < maxPlayers; offset += 1) {
        const candidate = ((startSeat - 1 + offset) % maxPlayers) + 1;
        if (!occupied.has(candidate)) {
          resolvedSeatNo = candidate;
          break;
        }
      }
    }

    if (!Number.isInteger(resolvedSeatNo)) throw makeError("table_full");

    try {
      await tx.unsafe(
        "insert into public.poker_seats (table_id, user_id, seat_no, status, last_seen_at, joined_at, stack) values ($1, $2, $3, 'ACTIVE', now(), now(), 0);",
        [tableId, userId, resolvedSeatNo]
      );
    } catch (error) {
      if (isSeatConflictError(error)) throw makeError("seat_taken");
      throw error;
    }

    const escrowSystemKey = `POKER_TABLE:${tableId}`;
    const idempotencyKey = requestId
      ? `join-buyin:${tableId}:${userId}:${requestId}`
      : `join-buyin:${tableId}:${userId}:${resolvedSeatNo}:${resolvedBuyIn}`;

    let buyInDuplicated = false;
    try {
      await runPostTransaction({
        userId,
        txType: "TABLE_BUY_IN",
        idempotencyKey,
        entries: [
          { accountType: "USER", amount: -resolvedBuyIn },
          { accountType: "ESCROW", systemKey: escrowSystemKey, amount: resolvedBuyIn }
        ],
        createdBy: userId,
        tx
      });
    } catch (error) {
      if (!isBuyInIdempotencyDuplicate(error)) throw error;
      buyInDuplicated = true;
      klog("ws_join_authoritative_buyin_duplicate_idempotency", { tableId, userId, idempotencyKey });
    }

    let fundedStack = resolvedBuyIn;
    if (buyInDuplicated) {
      const persisted = await readPersistedSeatStack({ tx, tableId, userId });
      if (persisted.seatNo !== resolvedSeatNo) {
        throw makeError("state_invalid");
      }
      fundedStack = persisted.stack;
    } else {
      await tx.unsafe(
        "update public.poker_seats set stack = $4 where table_id = $1 and user_id = $2 and seat_no = $3;",
        [tableId, userId, resolvedSeatNo, resolvedBuyIn]
      );
    }

    await syncStateSeatAndStack({ tx, tableId, userId, seatNo: resolvedSeatNo, stack: fundedStack });
    await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);
    klog("ws_join_authoritative_persisted", { tableId, userId, seatNo: resolvedSeatNo, autoSeat: autoSeat === true, preferredSeatNo: preferredSeatNoRequested, buyIn: resolvedBuyIn, fundedStack });
    return { ok: true, tableId, userId, seatNo: resolvedSeatNo, stack: fundedStack, rejoin: false, requestId: requestId || null, me: { seated: true } };
  });
}
