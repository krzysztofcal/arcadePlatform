import assert from "node:assert/strict";
import { applyAction, getLegalActions } from "../netlify/functions/_shared/poker-reducer.mjs";

const state = {
  tableId: "t-left-excluded",
  phase: "PREFLOP",
  seats: [
    { userId: "u1", seatNo: 1 },
    { userId: "u2", seatNo: 2 },
    { userId: "u3", seatNo: 3 },
  ],
  handSeats: [
    { userId: "u1", seatNo: 1 },
    { userId: "u2", seatNo: 2 },
    { userId: "u3", seatNo: 3 },
  ],
  stacks: { u1: 100, u2: 100, u3: 100 },
  pot: 0,
  community: [],
  communityDealt: 0,
  dealerSeatNo: 1,
  turnUserId: "u1",
  turnNo: 1,
  toCallByUserId: { u1: 0, u2: 0, u3: 0 },
  betThisRoundByUserId: { u1: 0, u2: 0, u3: 0 },
  actedThisRoundByUserId: { u1: false, u2: false, u3: false },
  foldedByUserId: { u1: false, u2: false, u3: false },
  allInByUserId: { u1: false, u2: false, u3: false },
  contributionsByUserId: { u1: 0, u2: 0, u3: 0 },
  sitOutByUserId: { u1: false, u2: false, u3: false },
  pendingAutoSitOutByUserId: {},
  leftTableByUserId: { u1: false, u2: true, u3: false },
  missedTurnsByUserId: {},
  currentBet: 0,
  lastRaiseSize: null,
  lastAggressorUserId: null,
};

const afterU1 = applyAction(state, { type: "CHECK", userId: "u1" }).state;
assert.equal(afterU1.turnUserId, "u3", "turn should skip left player u2");
assert.throws(() => getLegalActions(afterU1, "u2"), /invalid_player/);

console.log("poker handSeats excludes left player behavior test passed");
