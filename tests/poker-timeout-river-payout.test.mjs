import assert from "node:assert/strict";
import { deriveCommunityCards, deriveRemainingDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { maybeApplyTurnTimeout } from "../netlify/functions/_shared/poker-turn-timeout.mjs";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-secret";

const seatOrder = ["user-1", "user-2"];

const baseHoleCards = {
  "user-1": [
    { r: "A", s: "S" },
    { r: "K", s: "H" },
  ],
  "user-2": [
    { r: "Q", s: "D" },
    { r: "J", s: "C" },
  ],
};

const makeRiverState = ({ tableId, handId, handSeed, pot, turnUserId, toCallByUserId, betThisRoundByUserId, actedThisRoundByUserId, currentBet, lastRaiseSize, missedTurnsByUserId }) => {
  const community = deriveCommunityCards({ handSeed, seatUserIdsInOrder: seatOrder, communityDealt: 5 });
  const deck = deriveRemainingDeck({ handSeed, seatUserIdsInOrder: seatOrder, communityDealt: 5 });
  return {
    tableId,
    phase: "RIVER",
    seats: [
      { userId: "user-1", seatNo: 1 },
      { userId: "user-2", seatNo: 2 },
    ],
    stacks: { "user-1": 90, "user-2": 80 },
    pot,
    community,
    communityDealt: 5,
    dealerSeatNo: 1,
    turnUserId,
    handId,
    handSeed,
    deck,
    holeCardsByUserId: baseHoleCards,
    toCallByUserId,
    betThisRoundByUserId,
    actedThisRoundByUserId,
    foldedByUserId: { "user-1": false, "user-2": false },
    allInByUserId: { "user-1": false, "user-2": false },
    contributionsByUserId: { "user-1": 10, "user-2": 10 },
    lastAggressorUserId: null,
    currentBet,
    lastRaiseSize,
    missedTurnsByUserId,
    sitOutByUserId: {},
    pendingAutoSitOutByUserId: {},
    leftTableByUserId: {},
    turnNo: 3,
    turnStartedAt: 0,
    turnDeadlineAt: 1,
  };
};

const applyTimeout = (state, nowMs) =>
  maybeApplyTurnTimeout({
    tableId: state.tableId,
    state,
    privateState: state,
    nowMs,
  });

const run = async () => {
  {
    const state = makeRiverState({
      tableId: "t-timeout-river-pending",
      handId: "hand-pending",
      handSeed: "seed-pending",
      pot: 20,
      turnUserId: "user-2",
      toCallByUserId: { "user-1": 0, "user-2": 5 },
      betThisRoundByUserId: { "user-1": 5, "user-2": 0 },
      actedThisRoundByUserId: { "user-1": true, "user-2": false },
      currentBet: 5,
      lastRaiseSize: 5,
      missedTurnsByUserId: { "user-2": 1 },
    });
    const result = applyTimeout(state, 2000);

    assert.equal(result.applied, true);
    assert.equal(result.action.type, "FOLD");
    assert.equal(result.state.phase, "SETTLED");
    assert.equal(result.state.pot, 0);
    assert.equal(result.state.sitOutByUserId?.["user-2"], true);
    assert.equal(result.state.pendingAutoSitOutByUserId?.["user-2"], undefined);
    assert.equal(result.state.holeCardsByUserId?.["user-2"], undefined);
    assert.equal(result.state.stacks?.["user-1"], 110);
    assert.ok(
      result.events.some((event) => event.type === "HAND_RESET_SKIPPED" && event.reason === "not_enough_players")
    );
  }

  {
    const state = makeRiverState({
      tableId: "t-timeout-river-fold",
      handId: "hand-fold",
      handSeed: "seed-fold",
      pot: 30,
      turnUserId: "user-2",
      toCallByUserId: { "user-1": 0, "user-2": 5 },
      betThisRoundByUserId: { "user-1": 5, "user-2": 0 },
      actedThisRoundByUserId: { "user-1": true, "user-2": false },
      currentBet: 5,
      lastRaiseSize: 5,
      missedTurnsByUserId: {},
    });
    const result = applyTimeout(state, 3000);

    assert.equal(result.applied, true);
    assert.equal(result.state.phase, "PREFLOP");
    assert.equal(result.state.pot, 0);
    assert.equal(result.state.stacks?.["user-1"], 120);
  }
};

await run();
