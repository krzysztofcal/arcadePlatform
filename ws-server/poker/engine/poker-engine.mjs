import { createHash } from "node:crypto";
import {
  dealHoleCards,
  deriveDeck,
  computeSharedLegalActions,
  toHoleCardCodeMap,
  toCardCodes
} from "../shared/poker-primitives.mjs";
import { applyAction as applyPokerAction } from "../shared/poker-action-reducer.mjs";
import { decideTurnTimeout, stampTurnDeadline } from "../shared/poker-turn-timeout.mjs";

const MIN_PLAYERS_TO_BOOTSTRAP = 2;
const ENGINE_ACTIONS = new Set(["FOLD", "CHECK", "CALL", "BET", "RAISE"]);
const MIN_STACK_TO_JOIN_HAND = 2;
const BOT_REPLACEMENT_STACK = 100;

export function calculateReplacementFundingDelta({ oldStack, targetStack = BOT_REPLACEMENT_STACK } = {}) {
  if (!Number.isInteger(targetStack) || targetStack <= 0) {
    return { ok: false, reason: "invalid_target_stack" };
  }
  if (!Number.isInteger(oldStack) || oldStack < 0 || oldStack >= targetStack) {
    return { ok: false, reason: "invalid_old_stack" };
  }
  return {
    ok: true,
    oldStack,
    targetStack,
    fundingDelta: targetStack - oldStack
  };
}

function toHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function toUuidLike(input) {
  const bytes = Buffer.from(createHash("sha256").update(input).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return `${toHex(bytes.subarray(0, 4))}-${toHex(bytes.subarray(4, 6))}-${toHex(bytes.subarray(6, 8))}-${toHex(bytes.subarray(8, 10))}-${toHex(bytes.subarray(10, 16))}`;
}

function toInt(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.trunc(value);
}

function normalizeEngineAction(action) {
  if (typeof action !== "string") {
    return null;
  }
  const normalized = action.trim().toUpperCase();
  return ENGINE_ACTIONS.has(normalized) ? normalized : null;
}

function nextHandId(tableId, version, seatCount) {
  return `ws_hand_${tableId}_${version}_${seatCount}`;
}

function nextHandSeed(tableId, version, seatCount) {
  return `ws_seed_${tableId}_${version}_${seatCount}`;
}

export function asLiveHandState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (typeof value.handId !== "string" || value.handId.trim() === "") {
    return null;
  }
  if (typeof value.phase !== "string" || !["PREFLOP", "FLOP", "TURN", "RIVER"].includes(value.phase)) {
    return null;
  }
  return value;
}

function orderedSeatMembers(coreState) {
  const members = Array.isArray(coreState?.members) ? coreState.members : [];
  return members
    .filter((member) => typeof member?.userId === "string" && Number.isInteger(member?.seat))
    .slice()
    .sort((a, b) => a.seat - b.seat || a.userId.localeCompare(b.userId));
}

export function isContinuationEligibleByStack(userId, stacksByUserId, { isBot = false } = {}) {
  const stack = Number(stacksByUserId?.[userId] ?? 0);
  const minimumStack = isBot ? MIN_STACK_TO_JOIN_HAND : 1;
  return Number.isFinite(stack) && stack >= minimumStack;
}

export function orderedEligibleSeatMembers(coreState, stacksByUserId = null) {
  const members = orderedSeatMembers(coreState);
  if (!stacksByUserId || typeof stacksByUserId !== "object" || Array.isArray(stacksByUserId)) {
    return members;
  }
  return members.filter((member) => isContinuationEligibleByStack(member.userId, stacksByUserId, {
    isBot: coreState?.seatDetailsByUserId?.[member.userId]?.isBot === true
  }));
}

export function buildBootstrappedPokerState({ tableId, coreState, dealerSeatNo = null, startingStacks = null, handVersion = null }) {
  const members = orderedEligibleSeatMembers(coreState, startingStacks);
  if (members.length < MIN_PLAYERS_TO_BOOTSTRAP) {
    return null;
  }

  const userIds = members.map((member) => member.userId);
  const dealerIndex = Number.isInteger(dealerSeatNo)
    ? Math.max(0, members.findIndex((member) => member.seat === dealerSeatNo))
    : 0;
  const isHeadsUp = members.length === 2;
  const sbIndex = isHeadsUp ? dealerIndex : (dealerIndex + 1) % members.length;
  const bbIndex = (sbIndex + 1) % members.length;
  const utgIndex = isHeadsUp ? dealerIndex : (bbIndex + 1) % members.length;
  const sbUserId = members[sbIndex]?.userId ?? null;
  const bbUserId = members[bbIndex]?.userId ?? null;
  const turnUserId = members[utgIndex]?.userId ?? members[dealerIndex]?.userId ?? null;
  const versionForHand = Number.isInteger(handVersion) ? handVersion : coreState.version;
  const handSeed = nextHandSeed(tableId, versionForHand, members.length);
  const initialDeck = deriveDeck(handSeed);
  const dealt = dealHoleCards(initialDeck, userIds);
  const stacks = Object.fromEntries(userIds.map((userId) => {
    const stack = Number(startingStacks?.[userId]);
    return [userId, Number.isFinite(stack) && stack >= 0 ? Math.trunc(stack) : 100];
  }));
  const betThisRoundByUserId = Object.fromEntries(userIds.map((userId) => [userId, 0]));
  const toCallByUserId = Object.fromEntries(userIds.map((userId) => [userId, 0]));
  const actedThisRoundByUserId = Object.fromEntries(userIds.map((userId) => [userId, false]));
  const lastBettingRoundActionByUserId = Object.fromEntries(userIds.map((userId) => [userId, null]));
  const foldedByUserId = Object.fromEntries(userIds.map((userId) => [userId, false]));
  const contributionsByUserId = Object.fromEntries(userIds.map((userId) => [userId, 0]));

  const postBlind = (userId, amount) => {
    if (!userId || !Number.isFinite(amount) || amount <= 0) {
      return 0;
    }
    const currentStack = Number(stacks[userId] ?? 0);
    const posted = Math.max(0, Math.min(currentStack, Math.trunc(amount)));
    stacks[userId] = currentStack - posted;
    betThisRoundByUserId[userId] = posted;
    contributionsByUserId[userId] = posted;
    return posted;
  };

  const sbPosted = postBlind(sbUserId, 1);
  const bbPosted = postBlind(bbUserId, 2);
  const currentBet = Math.max(sbPosted, bbPosted);
  for (const userId of userIds) {
    toCallByUserId[userId] = Math.max(0, currentBet - Number(betThisRoundByUserId[userId] ?? 0));
  }

  const handSeats = members.map((member) => ({ userId: member.userId, seatNo: member.seat }));

  return {
    roomId: coreState.roomId || tableId,
    handId: nextHandId(tableId, versionForHand, members.length),
    handSeed,
    phase: "PREFLOP",
    dealerSeatNo: members[dealerIndex]?.seat ?? null,
    turnUserId,
    seats: handSeats.map((seat) => ({ ...seat })),
    handSeats,
    community: [],
    communityDealt: 0,
    potTotal: sbPosted + bbPosted,
    sidePots: [],
    currentBet,
    lastRaiseSize: bbPosted,
    stacks,
    toCallByUserId,
    betThisRoundByUserId,
    actedThisRoundByUserId,
    lastBettingRoundActionByUserId,
    foldedByUserId,
    contributionsByUserId,
    holeCardsByUserId: toHoleCardCodeMap(dealt.holeCardsByUserId),
    deck: toCardCodes(dealt.deck),
    turnStartedAt: null,
    turnDeadlineAt: null
  };
}

export function resolveNextDealerSeatNo({ members, settledState, coreState = null }) {
  if (!Array.isArray(members) || members.length === 0) {
    return null;
  }

  const eligibleMembers = members.filter((member) => isContinuationEligibleByStack(member.userId, settledState?.stacks, {
    isBot: coreState?.seatDetailsByUserId?.[member.userId]?.isBot === true
  }));
  if (eligibleMembers.length === 0) {
    return null;
  }

  const currentDealerSeatNo = Number(settledState?.dealerSeatNo);
  const currentDealerIndex = eligibleMembers.findIndex((member) => member.seat === currentDealerSeatNo);
  if (currentDealerIndex === -1) {
    return eligibleMembers[0].seat;
  }

  const nextIndex = (currentDealerIndex + 1) % eligibleMembers.length;
  return eligibleMembers[nextIndex]?.seat ?? eligibleMembers[0].seat;
}

export function buildNextHandStateFromSettled({ tableId, coreState, settledState, nextVersion }) {
  const members = orderedEligibleSeatMembers(coreState, settledState?.stacks);
  const nextDealerSeatNo = resolveNextDealerSeatNo({ members, settledState, coreState });
  const nextHandState = buildBootstrappedPokerState({
    tableId,
    coreState,
    dealerSeatNo: nextDealerSeatNo,
    startingStacks: settledState?.stacks,
    handVersion: nextVersion
  });
  if (!nextHandState) return null;
  const durableStacks = { ...nextHandState.stacks };
  const settledStacks = settledState?.stacks && typeof settledState.stacks === "object" && !Array.isArray(settledState.stacks)
    ? settledState.stacks
    : {};
  for (const [userId, rawStack] of Object.entries(settledStacks)) {
    if (Object.prototype.hasOwnProperty.call(durableStacks, userId)) continue;
    const stack = Number(rawStack);
    if (Number.isInteger(stack) && stack >= 0) durableStacks[userId] = stack;
  }
  const waitingForNextHandByUserId = settledState?.waitingForNextHandByUserId && typeof settledState.waitingForNextHandByUserId === "object" && !Array.isArray(settledState.waitingForNextHandByUserId)
    ? { ...settledState.waitingForNextHandByUserId }
    : {};
  for (const seat of nextHandState.handSeats) delete waitingForNextHandByUserId[seat.userId];
  return { ...nextHandState, stacks: durableStacks, waitingForNextHandByUserId };
}

function nextBotReplacementUserId({ tableId, seatNo, version, existingUserIds }) {
  const baseInput = `bot_replacement:${tableId ?? ""}:${Number(seatNo)}:${Number(version)}`;
  const base = toUuidLike(baseInput);
  let candidate = base;
  let suffix = 1;
  while (existingUserIds.has(candidate)) {
    candidate = toUuidLike(`${baseInput}:${suffix}`);
    suffix += 1;
  }
  existingUserIds.add(candidate);
  return candidate;
}

export function replaceBrokeBotsForNextHand({ coreState, settledState, nextVersion }) {
  if (!coreState || typeof coreState !== "object" || Array.isArray(coreState)) {
    return { ok: false, reason: "invalid_core_state", coreState, settledState, replacementFundings: [] };
  }
  if (!settledState || typeof settledState !== "object" || Array.isArray(settledState)) {
    return { ok: false, reason: "invalid_settled_state", coreState, settledState, replacementFundings: [] };
  }

  const fromStateVersion = Number(coreState.version);
  if (!Number.isInteger(fromStateVersion) || !Number.isInteger(nextVersion) || nextVersion !== fromStateVersion + 1) {
    return { ok: false, reason: "invalid_replacement_version", coreState, settledState, replacementFundings: [] };
  }

  const currentMembers = orderedSeatMembers(coreState);
  const currentSeatDetails = coreState.seatDetailsByUserId && typeof coreState.seatDetailsByUserId === "object" && !Array.isArray(coreState.seatDetailsByUserId)
    ? coreState.seatDetailsByUserId
    : {};
  const currentStacks = settledState.stacks && typeof settledState.stacks === "object" && !Array.isArray(settledState.stacks)
    ? settledState.stacks
    : {};

  let changed = false;
  let nextMembers = currentMembers.slice();
  const nextSeats = { ...(coreState.seats || {}) };
  const nextSeatDetails = { ...currentSeatDetails };
  const nextStacks = { ...currentStacks };
  const nextPublicStacks = coreState.publicStacks && typeof coreState.publicStacks === "object" && !Array.isArray(coreState.publicStacks)
    ? { ...coreState.publicStacks }
    : null;
  const existingUserIds = new Set(nextMembers.map((member) => member.userId));
  const replacementFundings = [];

  for (const member of currentMembers) {
    const userId = member.userId;
    if (nextSeatDetails?.[userId]?.isBot !== true) continue;
    const stack = Number(nextStacks[userId] ?? 0);
    if (!Number.isFinite(stack)) {
      return {
        ok: false,
        reason: "invalid_old_stack",
        coreState,
        settledState,
        replacementFundings: []
      };
    }
    if (stack >= MIN_STACK_TO_JOIN_HAND) continue;

    const funding = calculateReplacementFundingDelta({
      oldStack: stack,
      targetStack: BOT_REPLACEMENT_STACK
    });
    if (!funding.ok) {
      return {
        ok: false,
        reason: funding.reason,
        coreState,
        settledState,
        replacementFundings: []
      };
    }

    const replacementUserId = nextBotReplacementUserId({
      tableId: coreState.roomId,
      seatNo: member.seat,
      version: nextVersion,
      existingUserIds
    });

    changed = true;
    nextMembers = nextMembers.filter((entry) => entry.userId !== userId);
    nextMembers.push({ userId: replacementUserId, seat: member.seat });
    delete nextSeats[userId];
    nextSeats[replacementUserId] = member.seat;

    const oldDetails = nextSeatDetails[userId] && typeof nextSeatDetails[userId] === "object"
      ? nextSeatDetails[userId]
      : { isBot: true, botProfile: null, leaveAfterHand: false };
    delete nextSeatDetails[userId];
    nextSeatDetails[replacementUserId] = {
      ...oldDetails,
      isBot: true,
      leaveAfterHand: false
    };

    delete nextStacks[userId];
    nextStacks[replacementUserId] = BOT_REPLACEMENT_STACK;
    if (nextPublicStacks) {
      delete nextPublicStacks[userId];
      nextPublicStacks[replacementUserId] = BOT_REPLACEMENT_STACK;
    }

    replacementFundings.push({
      seatNo: member.seat,
      oldBotUserId: userId,
      replacementBotUserId: replacementUserId,
      oldStack: funding.oldStack,
      targetStack: funding.targetStack,
      fundingDelta: funding.fundingDelta,
      settledHandId: typeof settledState.handId === "string" ? settledState.handId : null,
      fromStateVersion,
      toStateVersion: nextVersion
    });
  }

  if (!changed) {
    return { ok: true, coreState, settledState, replacementFundings: [] };
  }

  nextMembers.sort((a, b) => a.seat - b.seat || a.userId.localeCompare(b.userId));
  return {
    ok: true,
    coreState: {
      ...coreState,
      members: nextMembers,
      seats: nextSeats,
      seatDetailsByUserId: nextSeatDetails,
      ...(nextPublicStacks ? { publicStacks: nextPublicStacks } : {})
    },
    settledState: {
      ...settledState,
      stacks: nextStacks
    },
    replacementFundings
  };
}

export function bootstrapCoreStateHand({ tableId, coreState, nowMs = Date.now() }) {
  const currentPokerState = coreState?.pokerState;
  if (currentPokerState?.phase === "SETTLED") {
    return {
      ok: true,
      changed: false,
      bootstrap: "settlement_pending",
      handId: currentPokerState.handId ?? null,
      stateVersion: coreState.version,
      coreState
    };
  }

  const existingLiveState = asLiveHandState(coreState?.pokerState);
  if (existingLiveState) {
    return {
      ok: true,
      changed: false,
      bootstrap: "already_live",
      handId: existingLiveState.handId,
      stateVersion: coreState.version,
      coreState
    };
  }

  const bootstrappedState = buildBootstrappedPokerState({
    tableId,
    coreState,
    startingStacks: coreState?.publicStacks
  });
  if (!bootstrappedState) {
    return { ok: true, changed: false, bootstrap: "not_eligible", stateVersion: coreState.version, coreState };
  }

  const nextPokerState = stampTurnDeadline(bootstrappedState, nowMs);
  const nextCoreState = {
    ...coreState,
    version: coreState.version + 1,
    pokerState: nextPokerState
  };

  return {
    ok: true,
    changed: true,
    bootstrap: "started",
    handId: nextPokerState.handId,
    stateVersion: nextCoreState.version,
    coreState: nextCoreState
  };
}

export function applyCoreStateAction({ tableId, coreState, handId, userId, action, amount, nowIso, nowMs = Date.now() }) {
  const liveState = asLiveHandState(coreState?.pokerState);
  if (!liveState) {
    return { ok: true, accepted: false, changed: false, reason: "hand_not_live", stateVersion: coreState.version, coreState };
  }
  if (typeof handId !== "string" || handId !== liveState.handId) {
    return { ok: true, accepted: false, changed: false, reason: "hand_mismatch", stateVersion: coreState.version, coreState };
  }

  const seat = Number.isInteger(coreState.seats?.[userId]) ? coreState.seats[userId] : null;
  if (!Number.isInteger(seat)) {
    return { ok: true, accepted: false, changed: false, reason: "not_seated", stateVersion: coreState.version, coreState };
  }

  const normalizedAction = normalizeEngineAction(action);
  if (!normalizedAction) {
    return { ok: true, accepted: false, changed: false, reason: "illegal_action", stateVersion: coreState.version, coreState };
  }

  const legalInfo = computeSharedLegalActions({ statePublic: liveState, userId });
  if (!Array.isArray(legalInfo.actions) || !legalInfo.actions.includes(normalizedAction)) {
    return { ok: true, accepted: false, changed: false, reason: "illegal_action", stateVersion: coreState.version, coreState };
  }

  const stack = Number(liveState.stacks?.[userId] ?? 0);
  const toCall = Math.max(0, Number(legalInfo.toCall ?? 0));
  if (normalizedAction === "CALL" && toCall === 0) {
    return { ok: true, accepted: false, changed: false, reason: "illegal_action", stateVersion: coreState.version, coreState };
  }

  if (normalizedAction === "RAISE") {
    const raiseTo = toInt(amount);
    const minRaiseTo = Number(legalInfo.minRaiseTo ?? 0);
    const maxRaiseTo = Number(legalInfo.maxRaiseTo ?? 0);
    if (!Number.isInteger(raiseTo) || raiseTo < minRaiseTo || raiseTo > maxRaiseTo) {
      return { ok: true, accepted: false, changed: false, reason: "invalid_amount", stateVersion: coreState.version, coreState };
    }
    if (!Number.isFinite(stack) || raiseTo > stack + Number(liveState.betThisRoundByUserId?.[userId] ?? 0)) {
      return { ok: true, accepted: false, changed: false, reason: "invalid_amount", stateVersion: coreState.version, coreState };
    }
  }

  if (normalizedAction === "BET") {
    const betAmount = toInt(amount);
    const maxBetAmount = Number(legalInfo.maxBetAmount ?? 0);
    if (!Number.isInteger(betAmount) || betAmount < 1 || betAmount > maxBetAmount) {
      return { ok: true, accepted: false, changed: false, reason: "invalid_amount", stateVersion: coreState.version, coreState };
    }
    if (!Number.isFinite(stack) || betAmount > stack) {
      return { ok: true, accepted: false, changed: false, reason: "invalid_amount", stateVersion: coreState.version, coreState };
    }
  }

  let applied;
  try {
    applied = applyPokerAction({ pokerState: liveState, userId, action: normalizedAction, amount, nowIso });
  } catch (error) {
    return {
      ok: false,
      accepted: false,
      changed: false,
      reason: error?.message || "state_invalid",
      stateVersion: coreState.version,
      coreState
    };
  }
  if (!applied.ok) {
    return {
      ok: true,
      accepted: false,
      changed: false,
      reason: applied.reason || "action_rejected",
      stateVersion: coreState.version,
      coreState
    };
  }

  const nextVersion = coreState.version + 1;
  const nextPokerState = stampTurnDeadline(applied.state, nowMs);

  const nextCoreState = {
    ...coreState,
    version: nextVersion,
    pokerState: nextPokerState
  };

  return {
    ok: true,
    accepted: true,
    changed: true,
    reason: null,
    action: applied.action,
    stateVersion: nextCoreState.version,
    handId: nextPokerState.handId,
    coreState: nextCoreState
  };
}

export function decideCoreStateTurnTimeout({ coreState, nowMs = Date.now() }) {
  const liveState = asLiveHandState(coreState?.pokerState);
  if (!liveState) {
    return { due: false, reason: "hand_not_live", stateVersion: coreState.version };
  }

  const decision = decideTurnTimeout({ pokerState: liveState, nowMs });
  if (!decision.due) {
    return { due: false, reason: decision.reason, stateVersion: coreState.version, liveState };
  }

  return { due: true, liveState, decision, stateVersion: coreState.version };
}

export function applyCoreStateTurnTimeout({ tableId, coreState, nowMs = Date.now() }) {
  const liveState = asLiveHandState(coreState?.pokerState);
  if (!liveState) {
    return { ok: true, changed: false, reason: "hand_not_live", stateVersion: coreState.version, coreState };
  }

  const decision = decideTurnTimeout({ pokerState: liveState, nowMs });
  if (!decision.due) {
    return { ok: true, changed: false, reason: decision.reason, stateVersion: coreState.version, coreState };
  }

  const applied = applyCoreStateAction({
    tableId,
    coreState,
    handId: liveState.handId,
    userId: decision.actorUserId,
    action: decision.action.type,
    amount: null,
    nowIso: new Date(nowMs).toISOString(),
    nowMs
  });

  if (!applied.accepted) {
    return {
      ok: true,
      changed: false,
      reason: applied.reason || "timeout_rejected",
      stateVersion: coreState.version,
      actorUserId: decision.actorUserId,
      action: decision.action.type,
      coreState
    };
  }

  return {
    ok: true,
    changed: true,
    reason: null,
    actorUserId: decision.actorUserId,
    action: decision.action.type,
    stateVersion: applied.stateVersion,
    coreState: applied.coreState
  };
}
