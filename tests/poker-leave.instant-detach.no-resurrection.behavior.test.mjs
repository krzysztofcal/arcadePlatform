import assert from "node:assert/strict";
import { applyLeaveTable, getLegalActions } from "../netlify/functions/_shared/poker-reducer.mjs";

const u1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const u2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const state = {
  phase: "FLOP",
  handId: "hand-no-resurrection-1",
  seats: [{ userId: u2, seatNo: 2 }],
  handSeats: [
    { userId: u1, seatNo: 1 },
    { userId: u2, seatNo: 2 },
  ],
  stacks: { [u2]: 150 },
  turnUserId: u2,
  dealerSeatNo: 1,
  toCallByUserId: { junk: 99, [u2]: 0 },
  betThisRoundByUserId: { [u2]: 0 },
  actedThisRoundByUserId: { [u2]: false },
  foldedByUserId: { [u1]: true, [u2]: false, junk: false },
  leftTableByUserId: { [u1]: true, [u2]: false, junk: false },
  sitOutByUserId: { junk: true },
  pendingAutoSitOutByUserId: { [u1]: true, junk: true },
  allInByUserId: { [u2]: false },
  contributionsByUserId: { [u1]: 20, [u2]: 20 },
  pot: 40,
  community: [{ r: "A", s: "S" }, { r: "K", s: "H" }, { r: "Q", s: "D" }],
  deck: [{ r: "2", s: "C" }],
};

const { state: result } = applyLeaveTable(state, { userId: u2, requestId: "other-action" });

assert.equal(result.leftTableByUserId?.[u1], true);
assert.notEqual(result.sitOutByUserId?.[u1], true);
assert.equal(result.handSeats.some((seat) => seat?.userId === u1), true);
assert.equal(result.seats.some((seat) => seat?.userId === u1), false);
assert.throws(() => getLegalActions(result, u1), /invalid_player/);

console.log("poker-leave instant detach no resurrection behavior test passed");
