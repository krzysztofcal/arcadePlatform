import assert from "node:assert/strict";
import { maybeApplyTurnTimeout } from "../netlify/functions/_shared/poker-turn-timeout.mjs";

const run = async () => {
  const publicState = {
    tableId: "t-timeout-private",
    phase: "PREFLOP",
    seats: [
      { userId: "user-1", seatNo: 1 },
      { userId: "user-2", seatNo: 2 },
    ],
    stacks: { "user-1": 90, "user-2": 80 },
    pot: 10,
    community: [],
    communityDealt: 0,
    dealerSeatNo: 1,
    turnUserId: "user-2",
    handId: "hand-private",
    handSeed: "seed-private",
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
    turnNo: 1,
    turnStartedAt: 0,
    turnDeadlineAt: 1,
  };
  const privateState = {
    ...publicState,
    holeCardsByUserId: {
      "user-1": [
        { r: "A", s: "S" },
        { r: "K", s: "H" },
      ],
      "user-2": [
        { r: "Q", s: "D" },
        { r: "J", s: "C" },
      ],
    },
    deck: [],
  };
  const result = maybeApplyTurnTimeout({
    tableId: publicState.tableId,
    state: publicState,
    privateState,
    nowMs: 2000,
  });

  assert.equal(result.applied, true);
  assert.equal(result.state.holeCardsByUserId, undefined);
  assert.equal(result.state.deck, undefined);
};

await run();
