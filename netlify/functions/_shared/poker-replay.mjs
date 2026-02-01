import { deriveCommunityCards, deriveRemainingDeck } from "./poker-deal-deterministic.mjs";
import { materializeShowdownAndPayout } from "./poker-materialize-showdown.mjs";
import { awardPotsAtShowdown } from "./poker-payout.mjs";
import { advanceIfNeeded, applyAction } from "./poker-reducer.mjs";
import { computeShowdown } from "./poker-showdown.mjs";
import { normalizeSeatOrderFromState } from "./poker-turn-timeout.mjs";

const noop = () => {};

const ensureHandSeed = (state) => (typeof state?.handSeed === "string" && state.handSeed.trim() ? state.handSeed.trim() : null);

const ensureHoleCards = (state) =>
  state && typeof state.holeCardsByUserId === "object" && !Array.isArray(state.holeCardsByUserId)
    ? state.holeCardsByUserId
    : null;

const ensureCommunityDealt = (state) => {
  if (Number.isInteger(state?.communityDealt)) return state.communityDealt;
  if (Array.isArray(state?.community)) return state.community.length;
  return null;
};

const materializeShowdownState = ({ state, seatUserIdsInOrder, holeCardsByUserId }) => {
  const materialized = materializeShowdownAndPayout({
    state,
    seatUserIdsInOrder,
    holeCardsByUserId,
    computeShowdown,
    awardPotsAtShowdown,
    klog: noop,
  });
  return materialized.nextState;
};

const runAdvanceLoop = (stateToAdvance, eventsList) => {
  let next = stateToAdvance;
  let loopCount = 0;
  while (loopCount < 4) {
    if (next.phase === "HAND_DONE") break;
    const prevPhase = next.phase;
    const advanced = advanceIfNeeded(next);
    next = advanced.state;
    if (Array.isArray(advanced.events) && advanced.events.length > 0) {
      eventsList.push(...advanced.events);
    }
    if (!Array.isArray(advanced.events) || advanced.events.length === 0) break;
    if (next.phase === prevPhase) break;
    loopCount += 1;
  }
  return next;
};

const applyLoggedAction = ({ state, action }) => {
  const applied = applyAction(state, action);
  const events = Array.isArray(applied.events) ? applied.events.slice() : [];
  const nextState = runAdvanceLoop(applied.state, events);
  return { nextState, events };
};

const shouldMaterializeShowdown = ({ state, seatUserIdsInOrder }) => {
  const handId = typeof state.handId === "string" ? state.handId.trim() : "";
  const showdownHandId = typeof state.showdown?.handId === "string" ? state.showdown.handId.trim() : "";
  const showdownAlreadyMaterialized = !!handId && !!showdownHandId && showdownHandId === handId;
  const eligibleUserIds = seatUserIdsInOrder.filter((userId) => typeof userId === "string" && !state.foldedByUserId?.[userId]);
  return !showdownAlreadyMaterialized && (eligibleUserIds.length <= 1 || state.phase === "SHOWDOWN");
};

const normalizeActionType = (value) => (typeof value === "string" ? value.trim().toUpperCase() : "");

const normalizeLogAction = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const type = normalizeActionType(entry.type || entry.actionType);
  if (!type || type === "START_HAND") return null;
  const userId = typeof entry.userId === "string" && entry.userId.trim() ? entry.userId.trim() : null;
  if (!userId) throw new Error("replay_not_supported");
  const amount = entry.amount == null ? null : Number(entry.amount);
  const action = { type, userId };
  if (type === "BET" || type === "RAISE") {
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
      throw new Error("replay_not_supported");
    }
    action.amount = amount;
  }
  return action;
};

const replayFromLogs = ({ startStatePrivate, actions }) => {
  if (!startStatePrivate || typeof startStatePrivate !== "object") {
    throw new Error("replay_not_supported");
  }
  const handSeed = ensureHandSeed(startStatePrivate);
  const holeCardsByUserId = ensureHoleCards(startStatePrivate);
  const seatUserIdsInOrder = normalizeSeatOrderFromState(startStatePrivate.seats);
  if (!handSeed || !holeCardsByUserId || seatUserIdsInOrder.length === 0) {
    throw new Error("replay_not_supported");
  }
  const communityDealt = ensureCommunityDealt(startStatePrivate);
  if (!Number.isInteger(communityDealt) || communityDealt < 0 || communityDealt > 5) {
    throw new Error("replay_not_supported");
  }

  const community = deriveCommunityCards({ handSeed, seatUserIdsInOrder, communityDealt });
  const deck = deriveRemainingDeck({ handSeed, seatUserIdsInOrder, communityDealt });
  let state = {
    ...startStatePrivate,
    community,
    communityDealt,
    deck,
    holeCardsByUserId,
  };

  const list = Array.isArray(actions) ? actions : [];
  for (const entry of list) {
    const action = normalizeLogAction(entry);
    if (!action) continue;
    const applied = applyLoggedAction({ state, action });
    state = applied.nextState;
    if (shouldMaterializeShowdown({ state, seatUserIdsInOrder })) {
      state = materializeShowdownState({ state, seatUserIdsInOrder, holeCardsByUserId });
    }
  }
  return state;
};

export { replayFromLogs };
