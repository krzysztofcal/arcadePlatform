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

const makeHandDoneTimeoutState = () => {
  const handSeed = "seed-hand-done";
  const community = deriveCommunityCards({ handSeed, seatUserIdsInOrder: seatOrder, communityDealt: 5 });
  const deck = deriveRemainingDeck({ handSeed, seatUserIdsInOrder: seatOrder, communityDealt: 5 });
  return {
    tableId: "t-timeout-hand-done",
    phase: "RIVER",
    seats: [
      { userId: "user-1", seatNo: 1 },
      { userId: "user-2", seatNo: 2 },
    ],
    stacks: { "user-1": 90, "user-2": 80 },
    pot: 25,
    community,
    communityDealt: 5,
    dealerSeatNo: 1,
    turnUserId: "user-2",
    handId: "hand-done",
    handSeed,
    deck,
    holeCardsByUserId: baseHoleCards,
    toCallByUserId: { "user-1": 0, "user-2": 5 },
    betThisRoundByUserId: { "user-1": 5, "user-2": 0 },
    actedThisRoundByUserId: { "user-1": true, "user-2": false },
    foldedByUserId: { "user-1": false, "user-2": false },
    allInByUserId: { "user-1": false, "user-2": false },
    contributionsByUserId: { "user-1": 10, "user-2": 10 },
    lastAggressorUserId: null,
    currentBet: 5,
    lastRaiseSize: 5,
    missedTurnsByUserId: {},
    sitOutByUserId: {},
    pendingAutoSitOutByUserId: {},
    leftTableByUserId: {},
    turnNo: 3,
    turnStartedAt: 0,
    turnDeadlineAt: 1,
  };
};

const run = async () => {
  const state = makeHandDoneTimeoutState();
  const result = maybeApplyTurnTimeout({
    tableId: state.tableId,
    state,
    privateState: state,
    nowMs: 2000,
  });

  assert.equal(result.applied, true);
  assert.equal(result.state.pot, 0);
  assert.notEqual(result.state.phase, "HAND_DONE");
  assert.equal(result.state.stacks?.["user-1"], 115);
};

await run();
