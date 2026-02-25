import assert from "node:assert/strict";
import { applyLeaveTable, getLegalActions } from "../netlify/functions/_shared/poker-reducer.mjs";

const u1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const u2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const u3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const inHand = {
  phase: "PREFLOP",
  handId: "hand-join-1",
  seats: [
    { userId: u1, seatNo: 1 },
    { userId: u2, seatNo: 2 },
  ],
  handSeats: [
    { userId: u1, seatNo: 1 },
    { userId: u2, seatNo: 2 },
  ],
  stacks: { [u1]: 100, [u2]: 100 },
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
  contributionsByUserId: { [u1]: 0, [u2]: 0 },
  pot: 0,
  community: [],
  deck: [{ r: "A", s: "S" }],
};

const { state: afterLeave } = applyLeaveTable(inHand, { userId: u1, requestId: "req-join-1" });
const afterJoin = {
  ...afterLeave,
  seats: [...afterLeave.seats, { userId: u3, seatNo: 1 }],
  stacks: { ...afterLeave.stacks, [u3]: 200 },
};

assert.equal(afterJoin.seats.some((seat) => seat?.userId === u3 && seat?.seatNo === 1), true);
assert.equal(afterJoin.handSeats.some((seat) => seat?.userId === u3), false);
assert.throws(() => getLegalActions(afterJoin, u3), /invalid_player/);
assert.doesNotThrow(() => getLegalActions(afterJoin, u2));

console.log("poker-join after midhand leave seat available behavior test passed");
