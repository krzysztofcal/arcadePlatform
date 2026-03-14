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

export async function executePokerJoinAuthoritative({ beginSql, tableId, userId, requestId, klog = () => {} }) {
  return beginSql(async (tx) => {
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
      await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);
      return { ok: true, tableId, userId, seatNo: existingSeatNo, rejoin: true, requestId: requestId || null, me: { seated: true } };
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
    let seatNo = null;
    for (let candidate = 1; candidate <= maxPlayers; candidate += 1) {
      if (!occupied.has(candidate)) {
        seatNo = candidate;
        break;
      }
    }
    if (!Number.isInteger(seatNo)) throw makeError("table_full");

    try {
      await tx.unsafe(
        "insert into public.poker_seats (table_id, user_id, seat_no, status, last_seen_at, joined_at) values ($1, $2, $3, 'ACTIVE', now(), now());",
        [tableId, userId, seatNo]
      );
    } catch (error) {
      if (isSeatConflictError(error)) throw makeError("seat_taken");
      throw error;
    }

    const stateRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", [tableId]);
    const stateRow = stateRows?.[0] || null;
    if (!stateRow) throw makeError("state_missing");
    const state = parseStateValue(stateRow.state);
    const seats = Array.isArray(state.seats) ? state.seats.filter((seat) => seat?.userId !== userId) : [];
    seats.push({ userId, seatNo });
    const stacks = state.stacks && typeof state.stacks === "object" && !Array.isArray(state.stacks) ? { ...state.stacks } : {};
    if (!Object.prototype.hasOwnProperty.call(stacks, userId)) stacks[userId] = 0;
    const nextState = { ...state, tableId, seats, stacks };
    await tx.unsafe("update public.poker_state set state = $2::jsonb where table_id = $1;", [tableId, JSON.stringify(nextState)]);
    await tx.unsafe("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;", [tableId]);
    klog("ws_join_authoritative_persisted", { tableId, userId, seatNo });
    return { ok: true, tableId, userId, seatNo, rejoin: false, requestId: requestId || null, me: { seated: true } };
  });
}
