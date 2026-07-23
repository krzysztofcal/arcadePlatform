import { parseStakes } from "../../shared/poker-domain/bots.mjs";
import { deriveDeterministicRuntimeHandState } from "../shared/runtime-hand-state.mjs";

const LIVE_HAND_PHASES = new Set(["PREFLOP", "FLOP", "TURN", "RIVER"]);

function hasCompleteRuntimePrivateHandState(state) {
  const handSeats = Array.isArray(state?.handSeats) && state.handSeats.length > 0
    ? state.handSeats
    : state?.seats;
  const seatUserIds = Array.isArray(handSeats)
    ? handSeats
        .map((seat) => typeof seat?.userId === "string" ? seat.userId.trim() : "")
        .filter(Boolean)
    : [];
  const communityDealt = Number.isInteger(state?.communityDealt)
    ? state.communityDealt
    : (Array.isArray(state?.community) ? state.community.length : -1);
  if (
    seatUserIds.length < 2
    || communityDealt < 0
    || communityDealt > 5
    || !Array.isArray(state?.community)
    || state.community.length !== communityDealt
    || !Array.isArray(state?.deck)
    || state.deck.length < 5 - communityDealt
    || !state?.holeCardsByUserId
    || typeof state.holeCardsByUserId !== "object"
    || Array.isArray(state.holeCardsByUserId)
  ) {
    return false;
  }
  return seatUserIds.every((userId) => Array.isArray(state.holeCardsByUserId[userId])
    && state.holeCardsByUserId[userId].length === 2);
}

function isTerminalAllInCallPending(state) {
  const turnUserId = typeof state?.turnUserId === "string" ? state.turnUserId.trim() : "";
  const turnStack = Number(state?.stacks?.[turnUserId]);
  const turnToCall = Number(state?.toCallByUserId?.[turnUserId]);
  if (!turnUserId || !Number.isFinite(turnStack) || !Number.isFinite(turnToCall)) return false;
  if (turnStack <= 0 || turnToCall <= 0 || turnStack > turnToCall) return false;

  const handSeats = Array.isArray(state?.handSeats) && state.handSeats.length > 0
    ? state.handSeats
    : state?.seats;
  const eligibleUserIds = Array.isArray(handSeats)
    ? handSeats
        .map((seat) => typeof seat?.userId === "string" ? seat.userId.trim() : "")
        .filter((userId) => userId
          && !state?.foldedByUserId?.[userId]
          && !state?.leftTableByUserId?.[userId]
          && !state?.sitOutByUserId?.[userId])
    : [];
  return eligibleUserIds.length > 1 && eligibleUserIds.every((userId) => (
    userId === turnUserId || Number(state?.stacks?.[userId] ?? 0) <= 0
  ));
}

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

function normalizeTimestampMs(value) {
  if (Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSeatNo(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    return null;
  }
  return parsed;
}

function normalizeTableMeta(tableRow, maxSeats) {
  const maxPlayers = normalizeMaxSeats(tableRow?.max_players ?? tableRow?.maxPlayers) ?? maxSeats;
  const stakesParsed = parseStakes(tableRow?.stakes);
  const createdAtMs = normalizeTimestampMs(tableRow?.created_at ?? tableRow?.createdAt);
  const lastActivityAtMs = normalizeTimestampMs(tableRow?.last_activity_at ?? tableRow?.lastActivityAt) ?? createdAtMs;
  return {
    maxPlayers,
    stakes: stakesParsed.ok ? stakesParsed.value : null,
    createdAtMs,
    lastActivityAtMs
  };
}

function normalizePublicStacks(runtimeSeats, pokerState) {
  if (!Array.isArray(runtimeSeats)) {
    return { ok: false, stacks: {} };
  }
  const stateStacks = asPlainObject(pokerState?.stacks) || {};
  const entries = [];
  for (const seat of runtimeSeats) {
    const userId = typeof seat?.userId === "string" ? seat.userId.trim() : "";
    const stateStack = Number(stateStacks[userId]);
    const seatStack = Number(seat?.stack);
    const hasAuthoritativeStateStack = Object.prototype.hasOwnProperty.call(stateStacks, userId)
      && Number.isSafeInteger(stateStack)
      && stateStack >= 0;
    if (!userId) continue;
    if (seat?.isBot !== true && !hasAuthoritativeStateStack) {
      return { ok: false, stacks: {} };
    }
    const stack = seat?.isBot !== true || seat?.preferStatePublicStack === true || !Number.isFinite(seatStack)
      ? stateStack
      : seatStack;
    if (!Number.isFinite(stack) || stack < 0) continue;
    entries.push([userId, stack]);
  }
  return { ok: true, stacks: Object.fromEntries(entries) };
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
    const stack = Number(seatRow?.stack);
    if (Number.isFinite(stack) && stack >= 0) {
      normalizedSeat.stack = stack;
    }
    activeSeats.push(normalizedSeat);
  }

  activeSeats.sort((left, right) => left.seat - right.seat || left.userId.localeCompare(right.userId));
  return activeSeats;
}

function mergeSeatMetadata(seat, metadata) {
  const mergedSeat = { ...seat };
  if (metadata?.isBot === true) mergedSeat.isBot = true;
  if (!mergedSeat.botProfile && metadata?.botProfile) mergedSeat.botProfile = metadata.botProfile;
  if (metadata?.leaveAfterHand === true || mergedSeat.leaveAfterHand === true) mergedSeat.leaveAfterHand = true;
  return mergedSeat;
}

function toSeatSnapshot(seat) {
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

function mergeStateSeatsWithSeatRows(pokerState, normalizedSeatRows) {
  const stateSeats = Array.isArray(pokerState?.seats) ? pokerState.seats : [];
  const seatRows = Array.isArray(normalizedSeatRows) ? normalizedSeatRows : [];
  const metadataByUserId = new Map(seatRows.map((seat) => [seat.userId, seat]));
  const metadataBySeatNo = new Map(seatRows.map((seat) => [seat.seat, seat]));
  const leftTableByUserId = asPlainObject(pokerState?.leftTableByUserId) || {};
  const replacementSeatNos = new Set();
  const mergedStateSeats = Array.isArray(stateSeats)
    ? stateSeats
        .map((seat) => {
          const userId = typeof seat?.userId === "string" ? seat.userId : "";
          const seatNo = normalizeSeatNo(seat?.seatNo ?? seat?.seat_no ?? seat?.seat);
          if (!userId || !seatNo) {
            return null;
          }
          const directMetadata = metadataByUserId.get(userId) || null;
          const sameSeatMetadata = metadataBySeatNo.get(seatNo) || null;
          const replacementBotMetadata = !directMetadata && sameSeatMetadata?.isBot === true ? sameSeatMetadata : null;
          if (!directMetadata && !replacementBotMetadata && leftTableByUserId[userId] !== true) {
            return null;
          }
          if (replacementBotMetadata) replacementSeatNos.add(seatNo);
          return mergeSeatMetadata({ ...seat, seatNo }, directMetadata || replacementBotMetadata);
        })
        .filter(Boolean)
    : [];

  return {
    stateSeats: mergedStateSeats.length > 0 ? mergedStateSeats : seatRows.map(toSeatSnapshot),
    replacementSeatNos,
    leftTableByUserId
  };
}

function buildRuntimeSeats({ seatRows, stateSeats, replacementSeatNos, leftTableByUserId }) {
  const runtimeSeats = [];
  const seenUserIds = new Set();
  const seenSeatNos = new Set();
  const metadataByUserId = new Map((seatRows || []).map((seat) => [seat.userId, seat]));
  const metadataBySeatNo = new Map((seatRows || []).map((seat) => [seat.seat, seat]));

  for (const stateSeat of stateSeats || []) {
    const userId = typeof stateSeat?.userId === "string" ? stateSeat.userId : "";
    const seatNo = normalizeSeatNo(stateSeat?.seatNo ?? stateSeat?.seat_no ?? stateSeat?.seat);
    if (!userId || !seatNo || leftTableByUserId?.[userId] === true) {
      continue;
    }
    const seatMetadata = metadataByUserId.get(userId) || metadataBySeatNo.get(seatNo) || null;
    const isReplacementSeat = replacementSeatNos?.has(seatNo) === true && !metadataByUserId.has(userId);
    runtimeSeats.push({
      seat: seatNo,
      userId,
      isBot: stateSeat?.isBot === true || seatMetadata?.isBot === true,
      ...(stateSeat?.botProfile ? { botProfile: stateSeat.botProfile } : seatMetadata?.botProfile ? { botProfile: seatMetadata.botProfile } : {}),
      ...(stateSeat?.leaveAfterHand === true || seatMetadata?.leaveAfterHand === true ? { leaveAfterHand: true } : {}),
      ...(isReplacementSeat ? { preferStatePublicStack: true } : {}),
      ...(Number.isFinite(Number(stateSeat?.stack))
        ? { stack: Number(stateSeat.stack) }
        : Number.isFinite(Number(seatMetadata?.stack))
          ? { stack: Number(seatMetadata.stack) }
          : {})
    });
    seenUserIds.add(userId);
    seenSeatNos.add(seatNo);
  }

  for (const seat of seatRows || []) {
    if (replacementSeatNos?.has(seat.seat)) continue;
    if (seenUserIds.has(seat.userId) || seenSeatNos.has(seat.seat)) continue;
    runtimeSeats.push({ ...seat });
  }

  runtimeSeats.sort((left, right) => left.seat - right.seat || left.userId.localeCompare(right.userId));
  return runtimeSeats;
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

  const { stateSeats, replacementSeatNos, leftTableByUserId } = mergeStateSeatsWithSeatRows(pokerState, seats);
  const runtimeSeats = buildRuntimeSeats({ seatRows: seats, stateSeats, replacementSeatNos, leftTableByUserId });
  const members = runtimeSeats.map((seat) => ({ userId: seat.userId, seat: seat.seat }));
  const publicStackResult = normalizePublicStacks(runtimeSeats, pokerState);
  if (!publicStackResult.ok) {
    return { ok: false, code: "invalid_persisted_state", message: "human_stack_ambiguous" };
  }
  const publicStacks = publicStackResult.stacks;
  const normalizedPokerState = { ...pokerState, seats: stateSeats };
  const derivedRuntimeHandState = deriveDeterministicRuntimeHandState(normalizedPokerState);
  if (
    LIVE_HAND_PHASES.has(normalizedPokerState.phase)
    && !derivedRuntimeHandState
    && !hasCompleteRuntimePrivateHandState(normalizedPokerState)
    && isTerminalAllInCallPending(normalizedPokerState)
  ) {
    return {
      ok: false,
      code: "invalid_persisted_state",
      message: "invalid_persisted_state",
      reason: "live_hand_runtime_unrecoverable"
    };
  }
  const seatDetailsByUserId = {};
  for (const seat of runtimeSeats) {
    seatDetailsByUserId[seat.userId] = {
      isBot: seat.isBot === true,
      botProfile: seat.botProfile || null,
      leaveAfterHand: seat.leaveAfterHand === true
    };
  }
  const seatByUserId = {};
  const presenceByUserId = new Map();
  for (const seat of runtimeSeats) {
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
        pokerState: derivedRuntimeHandState
          ? { ...normalizedPokerState, ...derivedRuntimeHandState }
          : normalizedPokerState
      },
      presenceByUserId,
      subscribers: new Set(),
      actionResultsByRequestId: new Map()
    }
  };
}
