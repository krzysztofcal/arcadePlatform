import assert from "node:assert/strict";
import { advanceIfNeeded, applyAction, getLegalActions } from "../netlify/functions/_shared/poker-reducer.mjs";

const handSeats = [
  { userId: "u1", seatNo: 1 },
  { userId: "u2", seatNo: 2 },
];

const makeState = () => ({
  tableId: "t-handseats-routing",
  phase: "PREFLOP",
  seats: [{ userId: "u1", seatNo: 1 }],
  handSeats,
  stacks: { u1: 100, u2: 100 },
  pot: 0,
  community: [],
  communityDealt: 0,
  dealerSeatNo: 1,
  turnUserId: "u1",
  turnNo: 1,
  holeCardsByUserId: { u1: [{ r: "A", s: "S" }, { r: "K", s: "S" }], u2: [{ r: "Q", s: "H" }, { r: "J", s: "H" }] },
  deck: [
    { r: "2", s: "C" },
    { r: "3", s: "C" },
    { r: "4", s: "C" },
    { r: "5", s: "C" },
    { r: "6", s: "C" },
  ],
  toCallByUserId: { u1: 0, u2: 0 },
  betThisRoundByUserId: { u1: 0, u2: 0 },
  actedThisRoundByUserId: { u1: false, u2: false },
  foldedByUserId: { u1: false, u2: false },
  allInByUserId: { u1: false, u2: false },
  contributionsByUserId: { u1: 0, u2: 0 },
  sitOutByUserId: {},
  pendingAutoSitOutByUserId: {},
  leftTableByUserId: {},
  missedTurnsByUserId: {},
  currentBet: 0,
  lastRaiseSize: null,
  lastAggressorUserId: null,
});

const run = async () => {
  const state = makeState();

  const afterU1 = applyAction(state, { type: "CHECK", userId: "u1" }).state;
  assert.equal(afterU1.turnUserId, "u2");

  const u2Actions = getLegalActions(afterU1, "u2").map((action) => action.type);
  assert.deepEqual(u2Actions, ["CHECK", "BET"]);

  const afterU2 = applyAction(afterU1, { type: "CHECK", userId: "u2" }).state;
  assert.equal(afterU2.phase, "FLOP");

  const advanced = advanceIfNeeded(afterU2);
  assert.equal(advanced.state.phase, "FLOP");
  assert.ok((advanced.events || []).length === 0);
};

run();
