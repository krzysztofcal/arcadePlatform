import assert from "node:assert/strict";
import { applyLeaveTable as applySnapshotLeave, advanceIfNeeded as advanceSnapshot } from "../ws-server/poker/snapshot-runtime/poker-reducer.mjs";
import { applyLeaveTable, advanceIfNeeded } from "../netlify/functions/_shared/poker-reducer.mjs";

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
  for (const [leave, advance] of [[applyLeaveTable, advanceIfNeeded], [applySnapshotLeave, advanceSnapshot]]) {
    const allIn = { ...state, stacks: { ...state.stacks, [leaverUserId]: 0 },
      allInByUserId: { ...state.allInByUserId, [leaverUserId]: true },
      contributionsByUserId: { [leaverUserId]: 100, [otherUserId]: 200 },
      holeCardsByUserId: { [leaverUserId]: ["AS", "AH"] },
      sidePots: [{ amount: 200, eligibleUserIds: [leaverUserId, otherUserId] }] };
    const pending = leave(allIn, { userId: leaverUserId }).state;
    assert.equal(pending.pendingDetachByUserId?.[leaverUserId], true);
    assert.equal(pending.leftTableByUserId[leaverUserId], false);
    assert.equal(pending.foldedByUserId[leaverUserId], false);
    assert.equal(pending.stacks[leaverUserId], 0);
    assert.deepEqual(pending.seats, allIn.seats);
    assert.deepEqual(pending.contributionsByUserId, allIn.contributionsByUserId);
    assert.deepEqual(pending.holeCardsByUserId, allIn.holeCardsByUserId);
    assert.deepEqual(pending.sidePots, allIn.sidePots);
    assert.deepEqual(leave(pending, { userId: leaverUserId }).state, pending);
    assert.equal(allIn.pendingDetachByUserId, undefined);
    const showdown = advance({ ...pending, stacks: { [leaverUserId]: 0, [otherUserId]: 0 },
      allInByUserId: { [leaverUserId]: true, [otherUserId]: true } });
    assert.equal(showdown.state.phase, "SHOWDOWN", "both all-in participants reach showdown rather than awarding a fold win");
    assert.deepEqual(showdown.state.contributionsByUserId, allIn.contributionsByUserId);
  }
  console.log("poker-reducer applyLeaveTable marks acted for participating leaver unit test passed");
} catch (error) {
  console.error(error);
  process.exit(1);
}
