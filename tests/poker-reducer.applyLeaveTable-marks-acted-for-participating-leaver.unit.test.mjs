import assert from "node:assert/strict";
import { applyLeaveTable } from "../netlify/functions/_shared/poker-reducer.mjs";

const leaverUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const state = {
  phase: "PREFLOP",
  seats: [
    { userId: leaverUserId, seatNo: 1 },
    { userId: otherUserId, seatNo: 2 },
  ],
  stacks: { [leaverUserId]: 100, [otherUserId]: 100 },
  turnUserId: otherUserId,
  dealerSeatNo: 1,
  handId: "hand-acted-leave",
  handSeed: "seed-acted-leave",
  communityDealt: 0,
  community: [],
  pot: 0,
  toCallByUserId: { [leaverUserId]: 1, [otherUserId]: 0 },
  betThisRoundByUserId: { [leaverUserId]: 0, [otherUserId]: 1 },
  actedThisRoundByUserId: { [leaverUserId]: false, [otherUserId]: false },
  foldedByUserId: { [leaverUserId]: false, [otherUserId]: false },
  leftTableByUserId: { [leaverUserId]: false, [otherUserId]: false },
  sitOutByUserId: { [leaverUserId]: false, [otherUserId]: false },
  pendingAutoSitOutByUserId: {},
  allInByUserId: { [leaverUserId]: false, [otherUserId]: false },
  contributionsByUserId: { [leaverUserId]: 0, [otherUserId]: 0 },
};

const run = () => {
  const { state: nextState, events } = applyLeaveTable(state, { userId: leaverUserId, requestId: "leave-unit-1" });

  assert.equal(nextState.leftTableByUserId?.[leaverUserId], true);
  assert.equal(nextState.foldedByUserId?.[leaverUserId], true);
  assert.equal(nextState.actedThisRoundByUserId?.[leaverUserId], true);

  const leftEvent = Array.isArray(events) ? events.find((entry) => entry?.type === "PLAYER_LEFT_TABLE" && entry?.userId === leaverUserId) : null;
  assert.ok(leftEvent, "expected PLAYER_LEFT_TABLE event for leaver");
};

try {
  run();
  console.log("poker-reducer applyLeaveTable marks acted for participating leaver unit test passed");
} catch (error) {
  console.error(error);
  process.exit(1);
}
