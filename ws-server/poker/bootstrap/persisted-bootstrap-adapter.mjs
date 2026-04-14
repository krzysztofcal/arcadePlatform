import { shouldRetainStateSeatUser } from "../../../shared/poker-domain/retained-live-hand-seat.mjs";

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function looksLikeJsonString(value) {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

function normalizeJsonDeep(value) {
  if (value == null) {
    return value;
  }

  if (typeof value === "string" && looksLikeJsonString(value)) {
    try {
      return normalizeJsonDeep(JSON.parse(value.trim()));
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map(normalizeJsonDeep);
  }

  if (typeof value === "object") {
    const out = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      out[key] = normalizeJsonDeep(nestedValue);
    }
    return out;
  }

  return value;
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") {
    return row;
  }
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = normalizeJsonDeep(value);
  }
  return out;
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

function normalizeTableStatus(rawStatus) {
  if (typeof rawStatus !== "string") {
    return "OPEN";
  }
  const normalized = rawStatus.trim().toUpperCase();
  return normalized || "OPEN";
}

function normalizePublicStacks(seatRows) {
  if (!Array.isArray(seatRows)) {
    return {};
  }
  const entries = [];
  for (const seatRow of seatRows) {
    const status = typeof seatRow?.status === "string" ? seatRow.status.trim().toUpperCase() : "ACTIVE";
    if (status !== "ACTIVE") {
      continue;
    }
    const userId = typeof seatRow?.user_id === "string" ? seatRow.user_id.trim() : "";
    const stack = Number(seatRow?.stack);
    if (!userId || !Number.isFinite(stack)) {
      continue;
    }
    entries.push([userId, stack]);
  }
  return Object.fromEntries(entries);
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
    const normalizedSeat = { seat: seatNo, userId, isBot: Boolean(seatRow?.is_bot) };
    const botProfile = typeof seatRow?.bot_profile === "string" ? seatRow.bot_profile.trim() : "";
    if (botProfile) {
      normalizedSeat.botProfile = botProfile;
    }
    if (seatRow?.leave_after_hand === true) {
      normalizedSeat.leaveAfterHand = true;
    }
    activeSeats.push(normalizedSeat);
  }

  activeSeats.sort((left, right) => left.seat - right.seat || left.userId.localeCompare(right.userId));
  return activeSeats;
}

function snapshotSeatFromMetadata(seat) {
  const snapshot = {
    userId: seat.userId,
    seatNo: seat.seat,
    status: "ACTIVE"
  };
  if (seat.isBot) snapshot.isBot = true;
  if (seat.botProfile) snapshot.botProfile = seat.botProfile;
  if (seat.leaveAfterHand) snapshot.leaveAfterHand = true;
  return snapshot;
}

function resolveRetainedStateSeatUserIds(pokerState) {
  const retainedUserIds = new Set();
  const stateSeats = Array.isArray(pokerState?.seats) ? pokerState.seats : [];
  for (const seat of stateSeats) {
    const userId = typeof seat?.userId === "string" ? seat.userId.trim() : "";
    if (!userId || !shouldRetainStateSeatUser(pokerState, userId)) continue;
    retainedUserIds.add(userId);
  }
  return retainedUserIds;
}

function mergeStateSeatsWithSeatRows(stateSeats, normalizedSeatRows, pokerState) {
  const seatRows = Array.isArray(normalizedSeatRows) ? normalizedSeatRows : [];
  const metadataByUserId = new Map(seatRows.map((seat) => [seat.userId, seat]));
  const retainedStateSeatUserIds = resolveRetainedStateSeatUserIds(pokerState);
  const mergedStateSeats = Array.isArray(stateSeats)
    ? stateSeats
        .filter((seat) => {
          const userId = typeof seat?.userId === "string" ? seat.userId.trim() : "";
          return !!userId && (metadataByUserId.has(userId) || retainedStateSeatUserIds.has(userId));
        })
        .map((seat) => {
          const userId = typeof seat?.userId === "string" ? seat.userId.trim() : "";
          const metadata = metadataByUserId.get(userId) || null;
          const mergedSeat = { ...seat };
          if (metadata?.isBot) mergedSeat.isBot = true;
          if (metadata?.botProfile) mergedSeat.botProfile = metadata.botProfile;
          if (metadata?.leaveAfterHand) mergedSeat.leaveAfterHand = true;
          return mergedSeat;
        })
    : [];
  const seenUserIds = new Set(
    mergedStateSeats
      .map((seat) => (typeof seat?.userId === "string" ? seat.userId.trim() : ""))
      .filter(Boolean)
  );
  for (const seat of seatRows) {
    if (seenUserIds.has(seat.userId)) continue;
    mergedStateSeats.push(snapshotSeatFromMetadata(seat));
  }
  mergedStateSeats.sort((left, right) => {
    const leftSeatNo = Number(left?.seatNo ?? left?.seat);
    const rightSeatNo = Number(right?.seatNo ?? right?.seat);
    return leftSeatNo - rightSeatNo || String(left?.userId || "").localeCompare(String(right?.userId || ""));
  });

  if (mergedStateSeats.length > 0) {
    return mergedStateSeats;
  }

  return seatRows.map(snapshotSeatFromMetadata);
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

  const normalizedStateRow = normalizeRow(stateRow);
  const stateVersion = normalizeStateVersion(normalizedStateRow.version);
  const pokerState = asPlainObject(normalizedStateRow.state);
  if (stateVersion === null || !pokerState) {
    return { ok: false, code: "invalid_persisted_state", message: "invalid_persisted_state" };
  }

  const seats = normalizeSeatRows(seatRows, maxSeats);
  if (!seats) {
    return { ok: false, code: "invalid_table_state", message: "invalid_table_state" };
  }

  const members = seats.map((seat) => ({ userId: seat.userId, seat: seat.seat }));
  const publicStacks = normalizePublicStacks(seatRows);
  const stateSeats = mergeStateSeatsWithSeatRows(pokerState.seats, seats, pokerState);
  const seatDetailsByUserId = {};
  for (const seat of seats) {
    seatDetailsByUserId[seat.userId] = {
      isBot: seat.isBot === true,
      botProfile: seat.botProfile || null,
      leaveAfterHand: seat.leaveAfterHand === true
    };
  }
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
      tableStatus: normalizeTableStatus(tableRow.status),
      coreState: {
        roomId: tableId,
        maxSeats,
        version: stateVersion,
        members,
        seats: seatByUserId,
        seatDetailsByUserId,
        publicStacks,
        appliedRequestIds: [],
        pokerState: { ...pokerState, seats: stateSeats }
      },
      presenceByUserId,
      subscribers: new Set(),
      actionResultsByRequestId: new Map()
    }
  };
}
