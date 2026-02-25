import assert from "node:assert/strict";
import { getLegalActions } from "../netlify/functions/_shared/poker-reducer.mjs";

const u1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const u2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const state = {
  phase: "FLOP",
  handId: "hand-legal-1",
  seats: [
    { userId: u1, seatNo: 1 },
    { userId: u2, seatNo: 2 },
  ],
  handSeats: [
    { userId: u1, seatNo: 1 },
    { userId: u2, seatNo: 2 },
  ],
  turnUserId: u1,
  stacks: { [u1]: 100, [u2]: 100 },
  betThisRoundByUserId: { [u1]: 10, [u2]: 10 },
  toCallByUserId: { [u1]: 10, [u2]: 10 },
  leftTableByUserId: { [u1]: true, [u2]: false },
  foldedByUserId: { [u1]: false, [u2]: false },
  sitOutByUserId: { [u1]: false, [u2]: false },
};

assert.throws(() => getLegalActions(state, u1), /invalid_player/);
assert.throws(() => getLegalActions(state, u1), /invalid_player/);
assert.doesNotThrow(() => getLegalActions(state, u2));

console.log("poker-legal-actions left-player invalid-player behavior test passed");
