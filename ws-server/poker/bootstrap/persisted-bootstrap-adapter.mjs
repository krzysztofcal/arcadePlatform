function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeMaxSeats(rawMaxSeats) {
  const parsed = Number(rawMaxSeats);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    return null;
  }
  return parsed;
}

function normalizeStateVersion(rawVersion) {
  const parsed = Number(rawVersion);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function normalizeSeatRows(seatRows, maxSeats) {
  if (!Array.isArray(seatRows)) {
    return null;
  }

  const activeSeats = [];
  const seenSeatNos = new Set();
  const seenUserIds = new Set();

  for (const seatRow of seatRows) {
    const status = typeof seatRow?.status === "string" ? seatRow.status.trim().toUpperCase() : "ACTIVE";
    if (status !== "ACTIVE") {
      continue;
    }

    const seatNo = Number(seatRow?.seat_no);
    const userId = typeof seatRow?.user_id === "string" ? seatRow.user_id.trim() : "";

    if (!Number.isInteger(seatNo) || seatNo < 1 || seatNo > maxSeats || !userId) {
      return null;
    }

    if (seenSeatNos.has(seatNo) || seenUserIds.has(userId)) {
      return null;
    }

    seenSeatNos.add(seatNo);
    seenUserIds.add(userId);
    activeSeats.push({ seat: seatNo, userId, isBot: Boolean(seatRow?.is_bot) });
  }

  activeSeats.sort((left, right) => left.seat - right.seat || left.userId.localeCompare(right.userId));
  return activeSeats;
}

export function adaptPersistedBootstrap({ tableId, tableRow, seatRows, stateRow }) {
  if (!asPlainObject(tableRow)) {
    return { ok: false, code: "table_not_found", message: "table_not_found" };
  }

  const maxSeats = normalizeMaxSeats(tableRow.max_players ?? tableRow.maxSeats);
  if (!maxSeats) {
    return { ok: false, code: "invalid_table_state", message: "invalid_table_state" };
  }

  if (!asPlainObject(stateRow)) {
    return { ok: false, code: "invalid_persisted_state", message: "invalid_persisted_state" };
  }

  const stateVersion = normalizeStateVersion(stateRow.version);
  const pokerState = asPlainObject(stateRow.state);
  if (stateVersion === null || !pokerState) {
    return { ok: false, code: "invalid_persisted_state", message: "invalid_persisted_state" };
  }

  const seats = normalizeSeatRows(seatRows, maxSeats);
  if (!seats) {
    return { ok: false, code: "invalid_table_state", message: "invalid_table_state" };
  }

  const members = seats.map((seat) => ({ userId: seat.userId, seat: seat.seat }));
  const seatByUserId = {};
  const presenceByUserId = new Map();
  for (const seat of seats) {
    seatByUserId[seat.userId] = seat.seat;
    presenceByUserId.set(seat.userId, {
      userId: seat.userId,
      seat: seat.seat,
      connected: false,
      lastSeenAt: null,
      expiresAt: null
    });
  }

  return {
    ok: true,
    table: {
      tableId,
      coreState: {
        roomId: tableId,
        maxSeats,
        version: stateVersion,
        members,
        seats: seatByUserId,
        appliedRequestIds: [],
        pokerState: { ...pokerState }
      },
      presenceByUserId,
      subscribers: new Set(),
      actionResultsByRequestId: new Map()
    }
  };
}
