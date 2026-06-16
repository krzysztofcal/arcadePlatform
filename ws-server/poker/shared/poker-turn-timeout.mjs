import { computeSharedLegalActions } from "./poker-primitives.mjs";

const DEFAULT_TURN_MS = 20_000;
const ACTION_PHASES = new Set(["PREFLOP", "FLOP", "TURN", "RIVER"]);

function resolveTurnMs(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TURN_MS;
  }
  return Math.trunc(parsed);
}

const TURN_MS = resolveTurnMs(process.env.WS_POKER_TURN_MS);

function isLiveHand(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return false;
  }
  if (typeof state.turnUserId !== "string" || !state.turnUserId.trim()) {
    return false;
  }
  return ACTION_PHASES.has(state.phase);
}

function defaultTimeoutActionFor(state, userId) {
  const legalInfo = computeSharedLegalActions({ statePublic: state, userId });
  const actions = Array.isArray(legalInfo.actions) ? legalInfo.actions : [];
  if (actions.includes("CHECK")) {
    return { type: "CHECK", userId };
  }
  if (actions.includes("FOLD")) {
    return { type: "FOLD", userId };
  }
  return null;
}

function decideTurnTimeout({ pokerState, nowMs, turnMs = TURN_MS }) {
  if (!isLiveHand(pokerState)) {
    return { due: false, reason: "hand_not_live" };
  }

  const deadline = Number(pokerState.turnDeadlineAt);
  const now = Number.isFinite(nowMs) ? Math.trunc(nowMs) : Date.now();
  if (!Number.isFinite(deadline)) {
    return { due: false, reason: "deadline_missing" };
  }
  if (now < deadline) {
    return { due: false, reason: "deadline_unexpired" };
  }

  const userId = pokerState.turnUserId.trim();
  const action = defaultTimeoutActionFor(pokerState, userId);
  if (!action) {
    return { due: false, reason: "no_default_action" };
  }

  return {
    due: true,
    actorUserId: userId,
    action,
    nowMs: now,
    deadline,
    turnMs
  };
}

function stampTurnDeadline(state, nowMs, turnMs = TURN_MS) {
  if (!isLiveHand(state)) {
    return {
      ...state,
      turnStartedAt: null,
      turnDeadlineAt: null
    };
  }

  const startedAt = Number.isFinite(nowMs) ? Math.trunc(nowMs) : Date.now();
  const ttl = Number.isFinite(turnMs) && turnMs > 0 ? Math.trunc(turnMs) : TURN_MS;
  return {
    ...state,
    turnStartedAt: startedAt,
    turnDeadlineAt: startedAt + ttl
  };
}

export { TURN_MS, decideTurnTimeout, stampTurnDeadline };
