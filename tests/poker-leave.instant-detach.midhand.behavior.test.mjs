import assert from "node:assert/strict";
import { applyLeaveTable } from "../netlify/functions/_shared/poker-reducer.mjs";

const u1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const u2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const state = {
  phase: "FLOP",
  handId: "hand-mid-1",
  seats: [
    { userId: u1, seatNo: 1 },
    { userId: u2, seatNo: 2 },
  ],
  handSeats: [
    { userId: u1, seatNo: 1 },
    { userId: u2, seatNo: 2 },
  ],
  stacks: { [u1]: 100, [u2]: 150 },
  contributionsByUserId: { [u1]: 30, [u2]: 30 },
  pot: 60,
  turnUserId: u2,
  dealerSeatNo: 1,
  toCallByUserId: { [u1]: 0, [u2]: 0 },
  betThisRoundByUserId: { [u1]: 0, [u2]: 0 },
  actedThisRoundByUserId: { [u1]: false, [u2]: false },
  foldedByUserId: { [u1]: false, [u2]: false },
  leftTableByUserId: { [u1]: false, [u2]: false },
  sitOutByUserId: { [u1]: false, [u2]: false },
  pendingAutoSitOutByUserId: {},
  allInByUserId: { [u1]: false, [u2]: false },
  community: [{ r: "A", s: "S" }, { r: "K", s: "H" }, { r: "2", s: "D" }],
  deck: [{ r: "Q", s: "C" }],
};

const { state: next } = applyLeaveTable(state, { userId: u1, requestId: "req-mid-detach" });

assert.equal(next.seats.some((seat) => seat?.userId === u1), false);
assert.equal(next.leftTableByUserId?.[u1], true);
assert.equal(next.handSeats.some((seat) => seat?.userId === u1), true);
assert.equal(Object.prototype.hasOwnProperty.call(next.stacks || {}, u1), false);
assert.equal(next.pot, 60);
assert.equal(next.contributionsByUserId?.[u1], 30);

const replay = applyLeaveTable(next, { userId: u1, requestId: "req-mid-detach-2" });
assert.equal(replay.state.leftTableByUserId?.[u1], true);
assert.equal(replay.state.handSeats.some((seat) => seat?.userId === u1), true);
assert.equal(replay.state.seats.some((seat) => seat?.userId === u1), false);

console.log("poker-leave instant detach midhand behavior test passed");
