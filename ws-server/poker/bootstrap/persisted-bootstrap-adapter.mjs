import { parseStakes } from "../../../netlify/functions/_shared/poker-stakes.mjs";
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

function normalizeTableMeta(tableRow, maxSeats) {
  const maxPlayers = normalizeMaxSeats(tableRow?.max_players ?? tableRow?.maxPlayers) ?? maxSeats;
  const stakesParsed = parseStakes(tableRow?.stakes);
  return {
    maxPlayers,
    stakes: stakesParsed.ok ? stakesParsed.value : null
  };
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

function mergeStateSeatsWithSeatRows(stateSeats, normalizedSeatRows) {
  const seatRows = Array.isArray(normalizedSeatRows) ? normalizedSeatRows : [];
  const metadataByUserId = new Map(seatRows.map((seat) => [seat.userId, seat]));
  const mergedStateSeats = Array.isArray(stateSeats)
    ? stateSeats
        .filter((seat) => seat && typeof seat.userId === "string" && metadataByUserId.has(seat.userId))
        .map((seat) => {
          const metadata = metadataByUserId.get(seat.userId) || null;
          const mergedSeat = { ...seat };
          if (metadata?.isBot) mergedSeat.isBot = true;
          if (metadata?.botProfile) mergedSeat.botProfile = metadata.botProfile;
          if (metadata?.leaveAfterHand) mergedSeat.leaveAfterHand = true;
          return mergedSeat;
        })
    : [];

  if (mergedStateSeats.length > 0) {
    return mergedStateSeats;
  }

  return seatRows.map((seat) => {
    const snapshot = {
      userId: seat.userId,
      seatNo: seat.seat,
      status: "ACTIVE"
    };
    if (seat.isBot) snapshot.isBot = true;
    if (seat.botProfile) snapshot.botProfile = seat.botProfile;
    if (seat.leaveAfterHand) snapshot.leaveAfterHand = true;
    return snapshot;
  });
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
  const stateSeats = mergeStateSeatsWithSeatRows(pokerState.seats, seats);
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
      tableMeta: normalizeTableMeta(tableRow, maxSeats),
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
