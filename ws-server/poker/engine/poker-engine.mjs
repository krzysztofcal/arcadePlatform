import {
  dealHoleCards,
  deriveDeck,
  toHoleCardCodeMap,
  toCardCodes
} from "../shared/poker-primitives.mjs";
import { applyAction as applyPokerAction } from "../shared/poker-action-reducer.mjs";
import { decideTurnTimeout, stampTurnDeadline } from "../shared/poker-turn-timeout.mjs";

const MIN_PLAYERS_TO_BOOTSTRAP = 2;

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

export function isContinuationEligibleByStack(userId, stacksByUserId) {
  const stack = Number(stacksByUserId?.[userId] ?? 0);
  return Number.isFinite(stack) && stack > 0;
}

export function orderedEligibleSeatMembers(coreState, stacksByUserId = null) {
  const members = orderedSeatMembers(coreState);
  if (!stacksByUserId || typeof stacksByUserId !== "object" || Array.isArray(stacksByUserId)) {
    return members;
  }
  return members.filter((member) => isContinuationEligibleByStack(member.userId, stacksByUserId));
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

  return {
    roomId: coreState.roomId || tableId,
    handId: nextHandId(tableId, versionForHand, members.length),
    handSeed,
    phase: "PREFLOP",
    dealerSeatNo: members[dealerIndex]?.seat ?? null,
    turnUserId,
    seats: members.map((member) => ({ userId: member.userId, seatNo: member.seat })),
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
    foldedByUserId,
    contributionsByUserId,
    holeCardsByUserId: toHoleCardCodeMap(dealt.holeCardsByUserId),
    deck: toCardCodes(dealt.deck),
    turnStartedAt: null,
    turnDeadlineAt: null
  };
}

export function resolveNextDealerSeatNo({ members, settledState }) {
  if (!Array.isArray(members) || members.length === 0) {
    return null;
  }

  const eligibleMembers = members.filter((member) => isContinuationEligibleByStack(member.userId, settledState?.stacks));
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
  const nextDealerSeatNo = resolveNextDealerSeatNo({ members, settledState });
  return buildBootstrappedPokerState({
    tableId,
    coreState,
    dealerSeatNo: nextDealerSeatNo,
    startingStacks: settledState?.stacks,
    handVersion: nextVersion
  });
}

export function bootstrapCoreStateHand({ tableId, coreState, nowMs = Date.now() }) {
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

  const bootstrappedState = buildBootstrappedPokerState({ tableId, coreState });
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

  const applied = applyPokerAction({ pokerState: liveState, userId, action, amount, nowIso });
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
  const rawNextPokerState = applied.state?.phase === "SETTLED"
    ? buildNextHandStateFromSettled({ tableId, coreState, settledState: applied.state, nextVersion }) || applied.state
    : applied.state;
  const nextPokerState = stampTurnDeadline(rawNextPokerState, nowMs);

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
