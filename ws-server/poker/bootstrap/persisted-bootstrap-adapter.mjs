import { parseStakes } from "../../shared/poker-domain/bots.mjs";
import { areCardsUnique, isValidTwoCards } from "../snapshot-runtime/poker-cards-utils.mjs";
import { deriveDeterministicRuntimeHandState } from "../shared/runtime-hand-state.mjs";

const LIVE_HAND_PHASES = new Set(["PREFLOP", "FLOP", "TURN", "RIVER"]);

function hasCompleteRuntimePrivateHandState(state) {
  const handSeats = Array.isArray(state?.handSeats) && state.handSeats.length > 0
    ? state.handSeats
    : state?.seats;
  const showdownUserIds = Array.isArray(handSeats)
    ? handSeats
        .map((seat) => typeof seat?.userId === "string" ? seat.userId.trim() : "")
        .filter((userId) => userId
          && !state?.foldedByUserId?.[userId]
          && !state?.leftTableByUserId?.[userId]
          && !state?.sitOutByUserId?.[userId])
    : [];
  const communityDealt = Number.isInteger(state?.communityDealt)
    ? state.communityDealt
    : (Array.isArray(state?.community) ? state.community.length : -1);
  if (
    showdownUserIds.length < 2
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
  const showdownHoleCards = showdownUserIds.map((userId) => state.holeCardsByUserId[userId]);
  if (!showdownHoleCards.every(isValidTwoCards)) {
    return false;
  }
  return areCardsUnique([
    ...state.community,
    ...state.deck,
    ...showdownHoleCards.flat()
  ]);
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
  const lifecycleKind = typeof tableRow?.lifecycle_kind === "string"
    ? tableRow.lifecycle_kind.trim().toUpperCase()
    : "STANDARD";
  const managedProfileKey = typeof tableRow?.managed_profile_key === "string"
    ? tableRow.managed_profile_key.trim().toUpperCase()
    : null;
  const trustedLifecycleKind = lifecycleKind === "CONTINUOUS_BOT" && managedProfileKey === "CONTINUOUS_BOT_DEFAULT"
    ? lifecycleKind
    : "STANDARD";
  return {
    maxPlayers,
    stakes: stakesParsed.ok ? stakesParsed.value : null,
    createdAtMs,
    lastActivityAtMs,
    lifecycleKind: trustedLifecycleKind,
    managedProfileKey: trustedLifecycleKind === "CONTINUOUS_BOT" ? managedProfileKey : null,
    rotationDueAtMs: trustedLifecycleKind === "CONTINUOUS_BOT"
      ? normalizeTimestampMs(tableRow?.rotation_due_at ?? tableRow?.rotationDueAt)
      : null
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

function remapUserId(value, aliases) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && aliases?.[normalized] ? aliases[normalized] : value;
}

function remapUserKeyedObject(value, aliases, { preferSeatStacks = false, seatRowsByUserId = null } = {}) {
  if (!asPlainObject(value) || !aliases || Object.keys(aliases).length === 0) {
    return value;
  }
  const remapped = {};
  for (const [userId, entry] of Object.entries(value)) {
    if (!aliases[userId]) {
      remapped[userId] = entry;
    }
  }
  for (const [userId, entry] of Object.entries(value)) {
    const currentUserId = aliases[userId];
    if (!currentUserId) {
      continue;
    }
    if (preferSeatStacks) {
      const seatRow = seatRowsByUserId?.get(currentUserId);
      const seatStack = Number(seatRow?.stack);
      if (Number.isSafeInteger(seatStack) && seatStack >= 0) {
        remapped[currentUserId] = seatStack;
        continue;
      }
    }
    if (!Object.prototype.hasOwnProperty.call(remapped, currentUserId)) {
      remapped[currentUserId] = entry;
    }
  }
  return remapped;
}

function remapUserIdArray(value, aliases) {
  if (!Array.isArray(value) || !aliases || Object.keys(aliases).length === 0) {
    return value;
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const userId = typeof entry.userId === "string" ? entry.userId.trim() : "";
    return userId && aliases[userId] ? { ...entry, userId: aliases[userId] } : entry;
  });
}

function reconcilePersistedStateIdentity(pokerState, normalizedSeatRows) {
  if (!asPlainObject(pokerState)) return pokerState;
  const seatRows = Array.isArray(normalizedSeatRows) ? normalizedSeatRows : [];
  const seatRowsBySeatNo = new Map(seatRows.map((seat) => [seat.seat, seat]));
  const seatRowsByUserId = new Map(seatRows.map((seat) => [seat.userId, seat]));
  const aliases = {};
  for (const stateSeat of Array.isArray(pokerState.seats) ? pokerState.seats : []) {
    const stateUserId = typeof stateSeat?.userId === "string" ? stateSeat.userId.trim() : "";
    const seatNo = normalizeSeatNo(stateSeat?.seatNo ?? stateSeat?.seat_no ?? stateSeat?.seat);
    const currentSeat = seatRowsBySeatNo.get(seatNo);
    if (stateUserId && currentSeat?.userId && currentSeat.userId !== stateUserId) {
      aliases[stateUserId] = currentSeat.userId;
    }
  }

  const reconciled = { ...pokerState };
  const userKeyedFields = [
    "contributionsByUserId",
    "betThisRoundByUserId",
    "actedThisRoundByUserId",
    "toCallByUserId",
    "foldedByUserId",
    "allInByUserId",
    "sitOutByUserId",
    "waitingForNextHandByUserId",
    "holeCardsByUserId",
    "privateCardsByUserId"
  ];
  for (const field of userKeyedFields) {
    if (asPlainObject(pokerState[field])) {
      reconciled[field] = remapUserKeyedObject(pokerState[field], aliases);
    }
  }
  if (asPlainObject(pokerState.stacks)) {
    reconciled.stacks = remapUserKeyedObject(pokerState.stacks, aliases, {
      preferSeatStacks: true,
      seatRowsByUserId
    });
  }
  if (Array.isArray(pokerState.handSeats)) {
    reconciled.handSeats = remapUserIdArray(pokerState.handSeats, aliases);
  }
  for (const field of ["turnUserId", "dealerUserId", "lastAggressorUserId", "winnerUserId"]) {
    if (typeof pokerState[field] === "string" && aliases[pokerState[field]]) {
      reconciled[field] = remapUserId(pokerState[field], aliases);
    }
  }

  for (const seat of seatRows) {
    if (seat.isBot !== true || !Number.isSafeInteger(Number(seat.stack)) || Number(seat.stack) < 0) continue;
    const currentUserId = seat.userId;
    if (!Object.prototype.hasOwnProperty.call(reconciled.stacks || {}, currentUserId)) {
      reconciled.stacks = { ...(reconciled.stacks || {}), [currentUserId]: Number(seat.stack) };
    }
  }
  return reconciled;
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
  const representedSeatNos = new Set();
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
          const currentMetadata = directMetadata || replacementBotMetadata;
          const currentUserId = currentMetadata?.userId || userId;
          representedSeatNos.add(seatNo);
          return mergeSeatMetadata({ ...seat, userId: currentUserId, seatNo }, currentMetadata);
        })
        .filter(Boolean)
    : [];

  for (const seat of seatRows) {
    if (representedSeatNos.has(seat.seat)) continue;
    representedSeatNos.add(seat.seat);
    mergedStateSeats.push(toSeatSnapshot(seat));
  }

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

  const reconciledPokerState = reconcilePersistedStateIdentity(pokerState, seats);
  const { stateSeats, replacementSeatNos, leftTableByUserId } = mergeStateSeatsWithSeatRows(reconciledPokerState, seats);
  const runtimeSeats = buildRuntimeSeats({ seatRows: seats, stateSeats, replacementSeatNos, leftTableByUserId });
  const members = runtimeSeats.map((seat) => ({ userId: seat.userId, seat: seat.seat }));
  const publicStackResult = normalizePublicStacks(runtimeSeats, reconciledPokerState);
  if (!publicStackResult.ok) {
    return { ok: false, code: "invalid_persisted_state", message: "human_stack_ambiguous" };
  }
  const publicStacks = publicStackResult.stacks;
  const normalizedPokerState = { ...reconciledPokerState, seats: stateSeats };
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
