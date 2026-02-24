import assert from "node:assert/strict";
import { advanceIfNeeded } from "../netlify/functions/_shared/poker-reducer.mjs";

const state = {
  tableId: "t-handseats-undefined",
  phase: "PREFLOP",
  seats: undefined,
  handSeats: undefined,
  stacks: {},
  foldedByUserId: {},
  leftTableByUserId: {},
  sitOutByUserId: {},
  actedThisRoundByUserId: {},
  toCallByUserId: {},
  turnUserId: null,
};

assert.doesNotThrow(() => advanceIfNeeded(state));
