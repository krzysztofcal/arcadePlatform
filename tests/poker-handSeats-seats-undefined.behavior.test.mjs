import assert from "node:assert/strict";
import { advanceIfNeeded } from "../netlify/functions/_shared/poker-reducer.mjs";

const state = {
  tableId: "t-handseats-undefined",
  phase: "PREFLOP",
  seats: undefined,
  handSeats: undefined,
  community: [],
  communityDealt: 0,
  dealerSeatNo: 1,
  turnNo: 1,
  stacks: {},
  pot: 0,
  foldedByUserId: {},
  allInByUserId: {},
  leftTableByUserId: {},
  sitOutByUserId: {},
  actedThisRoundByUserId: {},
  betThisRoundByUserId: {},
  toCallByUserId: {},
  contributionsByUserId: {},
  deck: [],
  turnUserId: null,
};

assert.doesNotThrow(() => advanceIfNeeded(state));
