import assert from "node:assert/strict";
import { applyLeaveTable, getLegalActions } from "../netlify/functions/_shared/poker-reducer.mjs";

const u1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const u2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const state = {
  phase: "TURN",
  handId: "hand-replay-1",
  seats: [{ userId: u2, seatNo: 2 }],
  handSeats: [
    { userId: u1, seatNo: 1 },
    { userId: u2, seatNo: 2 },
  ],
  stacks: { [u2]: 100 },
  turnUserId: u2,
  dealerSeatNo: 1,
  toCallByUserId: { [u1]: 0, [u2]: 0 },
  betThisRoundByUserId: { [u1]: 0, [u2]: 0 },
  actedThisRoundByUserId: { [u1]: true, [u2]: false },
  foldedByUserId: { [u1]: true, [u2]: false },
  leftTableByUserId: { [u1]: true, [u2]: false },
  sitOutByUserId: { [u1]: false, [u2]: false },
  pendingAutoSitOutByUserId: { [u1]: true },
  allInByUserId: { [u1]: false, [u2]: false },
  contributionsByUserId: { [u1]: 30, [u2]: 30 },
  pot: 60,
  community: [{ r: "A", s: "S" }, { r: "K", s: "H" }, { r: "Q", s: "D" }, { r: "2", s: "C" }],
  deck: [{ r: "3", s: "S" }],
};

assert.doesNotThrow(() => applyLeaveTable(state, { userId: u1, requestId: "replay-1" }));
const { state: next } = applyLeaveTable(state, { userId: u1, requestId: "replay-1" });

assert.equal(next.leftTableByUserId?.[u1], true);
assert.equal(next.sitOutByUserId?.[u1], false);
assert.equal(next.pendingAutoSitOutByUserId?.[u1], undefined);
assert.equal(next.handSeats.some((seat) => seat?.userId === u1), true);
assert.equal(next.seats.some((seat) => seat?.userId === u1), false);
assert.throws(() => getLegalActions(next, u1), /invalid_player/);
assert.doesNotThrow(() => getLegalActions(next, u2));

console.log("poker-leave instant detach replay preserves left flag behavior test passed");
