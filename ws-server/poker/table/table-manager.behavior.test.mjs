import test from "node:test";
import assert from "node:assert/strict";
import { createTableManager } from "./table-manager.mjs";

function fakeWs(id) {
  return { id };
}

function memberPairs(members) {
  return members.map((member) => [member.userId, member.seat]);
}

test("table manager exposes connected members as sorted {userId, seat} and reuses freed seats", () => {
  const tableManager = createTableManager({ maxSeats: 3, presenceTtlMs: 0 });
  const ws1 = fakeWs("ws-1");
  const ws2 = fakeWs("ws-2");
  const ws3 = fakeWs("ws-3");

  const join1 = tableManager.join({ ws: ws1, userId: "user_1", tableId: "table_A", requestId: "join-1", nowTs: 100 });
  const join2 = tableManager.join({ ws: ws2, userId: "user_2", tableId: "table_A", requestId: "join-2", nowTs: 100 });
  assert.equal(join1.ok, true);
  assert.equal(join2.ok, true);

  const leave2 = tableManager.leave({ ws: ws2, userId: "user_2", tableId: "table_A", requestId: "leave-2" });
  assert.equal(leave2.ok, true);

  const join3 = tableManager.join({ ws: ws3, userId: "user_3", tableId: "table_A", requestId: "join-3", nowTs: 100 });
  assert.equal(join3.ok, true);

  const snapshot = tableManager.tableState("table_A");
  assert.deepEqual(memberPairs(snapshot.members), [
    ["user_1", 1],
    ["user_3", 2]
  ]);

  const join2Again = tableManager.join({ ws: ws2, userId: "user_2", tableId: "table_A", requestId: "join-2-again", nowTs: 100 });
  assert.equal(join2Again.ok, true);
  assert.deepEqual(memberPairs(tableManager.tableState("table_A").members), [
    ["user_1", 1],
    ["user_3", 2],
    ["user_2", 3]
  ]);
});

test("table manager does not expose __debugCore by default even when nodeEnv is test", () => {
  const tableManager = createTableManager({ maxSeats: 3, presenceTtlMs: 5, nodeEnv: "test" });
  assert.equal(tableManager.__debugCore, undefined);
});

test("table manager does not expose __debugCore when nodeEnv is production even if enableDebugCore is true", () => {
  const tableManager = createTableManager({ maxSeats: 3, presenceTtlMs: 5, enableDebugCore: true, nodeEnv: "production" });
  assert.equal(tableManager.__debugCore, undefined);
});

test("__debugCore is exposed only when enableDebugCore is true and nodeEnv is non-production", () => {
  const tableManager = createTableManager({ maxSeats: 3, presenceTtlMs: 5, enableDebugCore: true, nodeEnv: "test" });
  assert.equal(typeof tableManager.__debugCore, "function");

  const ws = fakeWs("ws-debug-core");
  const joined = tableManager.join({ ws, userId: "user_debug", tableId: "table_debug", requestId: "join-debug", nowTs: 50 });
  assert.equal(joined.ok, true);
  assert.deepEqual(tableManager.__debugCore("table_debug"), {
    version: 1,
    appliedRequestIdsLength: 1,
    actionResultsCacheSize: 0
  });
});

test("repeated maintenance with identical nowTs does not bump core version or appliedRequestIds", () => {
  const tableManager = createTableManager({ maxSeats: 3, presenceTtlMs: 5, enableDebugCore: true, nodeEnv: "test" });
  const wsMember = fakeWs("ws-member");
  const wsObserver = fakeWs("ws-observer");

  assert.equal(typeof tableManager.__debugCore, "function");

  const joined = tableManager.join({ ws: wsMember, userId: "user_1", tableId: "table_B", requestId: "join-1", nowTs: 10 });
  assert.equal(joined.ok, true);

  const subscribed = tableManager.subscribe({ ws: wsObserver, tableId: "table_B" });
  assert.equal(subscribed.ok, true);

  const disconnected = tableManager.cleanupConnection({ ws: wsMember, userId: "user_1", nowTs: 20, activeSockets: [] });
  assert.equal(disconnected.length, 1);

  const firstSweep = tableManager.sweepExpiredPresence({ nowTs: 25 });
  assert.equal(firstSweep.length, 1);
  const afterFirstSweep = tableManager.__debugCore("table_B");
  assert.ok(afterFirstSweep);

  const secondSweep = tableManager.sweepExpiredPresence({ nowTs: 25 });
  assert.deepEqual(secondSweep, []);
  const afterSecondSweep = tableManager.__debugCore("table_B");

  assert.deepEqual(afterFirstSweep, afterSecondSweep);
  assert.deepEqual(tableManager.tableState("table_B").members, []);
});

test("maintenance requestIds are collision-safe under identical nowTs", () => {
  const tableManager = createTableManager({ maxSeats: 3, presenceTtlMs: 5 });
  const wsCycle1 = fakeWs("ws-cycle-1");
  const wsCycle2 = fakeWs("ws-cycle-2");

  const firstJoin = tableManager.join({ ws: wsCycle1, userId: "user_1", tableId: "table_C", requestId: "join-1", nowTs: 100 });
  assert.equal(firstJoin.ok, true);

  const firstDisconnect = tableManager.cleanupConnection({ ws: wsCycle1, userId: "user_1", nowTs: 100, activeSockets: [] });
  assert.equal(firstDisconnect.length, 1);

  const firstSweep = tableManager.sweepExpiredPresence({ nowTs: 105 });
  assert.equal(firstSweep.length, 1);
  assert.deepEqual(tableManager.tableState("table_C").members, []);

  const secondJoin = tableManager.join({ ws: wsCycle2, userId: "user_1", tableId: "table_C", requestId: "join-2", nowTs: 100 });
  assert.equal(secondJoin.ok, true);

  const secondDisconnect = tableManager.cleanupConnection({ ws: wsCycle2, userId: "user_1", nowTs: 100, activeSockets: [] });
  assert.equal(secondDisconnect.length, 1);

  const secondSweep = tableManager.sweepExpiredPresence({ nowTs: 105 });
  assert.equal(secondSweep.length, 1);
  assert.deepEqual(tableManager.tableState("table_C").members, []);

  const thirdSweep = tableManager.sweepExpiredPresence({ nowTs: 105 });
  assert.deepEqual(thirdSweep, []);
  assert.deepEqual(tableManager.tableState("table_C").members, []);
});

test("join on full table is side-effect free and repeatable", () => {
  const tableManager = createTableManager({ maxSeats: 2, presenceTtlMs: 5, enableDebugCore: true, nodeEnv: "test" });
  const ws1 = fakeWs("ws-1");
  const ws2 = fakeWs("ws-2");
  const ws3 = fakeWs("ws-3");
  const tableId = "table_full";

  assert.equal(tableManager.join({ ws: ws1, userId: "user_1", tableId, requestId: "join-1", nowTs: 100 }).ok, true);
  assert.equal(tableManager.join({ ws: ws2, userId: "user_2", tableId, requestId: "join-2", nowTs: 100 }).ok, true);

  const beforeReject = tableManager.__debugCore(tableId);
  assert.ok(beforeReject);

  const join3 = tableManager.join({ ws: ws3, userId: "user_3", tableId, requestId: "join-3", nowTs: 100 });
  assert.equal(join3.ok, false);
  assert.equal(join3.code, "bounds_exceeded");

  const afterReject = tableManager.__debugCore(tableId);
  assert.equal(afterReject?.version, beforeReject?.version);
  assert.equal(afterReject?.appliedRequestIdsLength, beforeReject?.appliedRequestIdsLength);
  assert.deepEqual(memberPairs(tableManager.tableState(tableId).members), [
    ["user_1", 1],
    ["user_2", 2]
  ]);

  const join3Again = tableManager.join({ ws: ws3, userId: "user_3", tableId, requestId: "join-3", nowTs: 100 });
  assert.equal(join3Again.ok, false);
  assert.equal(join3Again.code, "bounds_exceeded");
  const afterSameRequestReject = tableManager.__debugCore(tableId);
  assert.equal(afterSameRequestReject?.version, beforeReject?.version);
  assert.equal(afterSameRequestReject?.appliedRequestIdsLength, beforeReject?.appliedRequestIdsLength);
  assert.deepEqual(memberPairs(tableManager.tableState(tableId).members), [
    ["user_1", 1],
    ["user_2", 2]
  ]);

  const join3DifferentRequestId = tableManager.join({ ws: ws3, userId: "user_3", tableId, requestId: "join-3b", nowTs: 100 });
  assert.equal(join3DifferentRequestId.ok, false);
  assert.equal(join3DifferentRequestId.code, "bounds_exceeded");
  const afterDifferentRequestReject = tableManager.__debugCore(tableId);
  assert.equal(afterDifferentRequestReject?.version, beforeReject?.version);
  assert.equal(afterDifferentRequestReject?.appliedRequestIdsLength, beforeReject?.appliedRequestIdsLength);
  assert.deepEqual(memberPairs(tableManager.tableState(tableId).members), [
    ["user_1", 1],
    ["user_2", 2]
  ]);
});

test("join reject does not record requestId as applied and does not block future successful join", () => {
  const tableManager = createTableManager({ maxSeats: 2, presenceTtlMs: 5, enableDebugCore: true, nodeEnv: "test" });
  const ws1 = fakeWs("ws-a");
  const ws2 = fakeWs("ws-b");
  const ws3 = fakeWs("ws-c");
  const tableId = "table_reject_recover";

  assert.equal(tableManager.join({ ws: ws1, userId: "user_1", tableId, requestId: "join-a", nowTs: 100 }).ok, true);
  assert.equal(tableManager.join({ ws: ws2, userId: "user_2", tableId, requestId: "join-b", nowTs: 100 }).ok, true);

  const beforeReject = tableManager.__debugCore(tableId);
  assert.ok(beforeReject);

  const rejected = tableManager.join({ ws: ws3, userId: "user_3", tableId, requestId: "join-reject", nowTs: 100 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "bounds_exceeded");
  assert.deepEqual(tableManager.__debugCore(tableId), beforeReject);

  const left = tableManager.leave({ ws: ws2, userId: "user_2", tableId, requestId: "leave-b" });
  assert.equal(left.ok, true);

  const accepted = tableManager.join({ ws: ws3, userId: "user_3", tableId, requestId: "join-reject", nowTs: 101 });
  assert.equal(accepted.ok, true);
  assert.deepEqual(memberPairs(tableManager.tableState(tableId).members), [
    ["user_1", 1],
    ["user_3", 2]
  ]);
});

test("tableSnapshot is read-only and deterministic", () => {
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const wsA = fakeWs("snap-a");
  const wsB = fakeWs("snap-b");

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId: "table_snap", requestId: "join-a", nowTs: 10 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId: "table_snap", requestId: "join-b", nowTs: 11 }).ok, true);

  const before = tableManager.__debugCore("table_snap");
  const snapshot1 = tableManager.tableSnapshot("table_snap", "user_a");
  const snapshot2 = tableManager.tableSnapshot("table_snap", "user_a");
  const after = tableManager.__debugCore("table_snap");

  assert.deepEqual(snapshot1, snapshot2);
  assert.deepEqual(before, after);
  assert.deepEqual(snapshot1.hand, { handId: null, status: "LOBBY", round: null });
  assert.deepEqual(snapshot1.board, { cards: [] });
  assert.deepEqual(snapshot1.turn, { userId: "user_a", seat: 1 });
  assert.deepEqual(snapshot1.legalActions, { seat: null, actions: [] });
  assert.deepEqual(snapshot1.private, { userId: "user_a", seat: 1, holeCards: [] });
});

test("tableSnapshot for missing table returns canonical placeholders", () => {
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });

  const snapshot = tableManager.tableSnapshot("missing_table", "observer");

  assert.equal(snapshot.tableId, "missing_table");
  assert.equal(snapshot.roomId, "missing_table");
  assert.equal(snapshot.stateVersion, 0);
  assert.equal(snapshot.memberCount, 0);
  assert.deepEqual(snapshot.members, []);
  assert.equal(snapshot.youSeat, null);
  assert.deepEqual(snapshot.hand, { handId: null, status: "EMPTY", round: null });
  assert.deepEqual(snapshot.board, { cards: [] });
  assert.deepEqual(snapshot.pot, { total: 0, sidePots: [] });
  assert.deepEqual(snapshot.turn, { userId: null, seat: null });
  assert.equal(snapshot.private, null);
  assert.deepEqual(snapshot.legalActions, { seat: null, actions: [] });
  assert.equal(tableManager.__debugCore("missing_table"), null);
});

test("tableSnapshot memberCount matches connected-only members after disconnect cleanup", () => {
  const tableManager = createTableManager({ maxSeats: 4, presenceTtlMs: 10, enableDebugCore: true, nodeEnv: "test" });
  const wsA = fakeWs("disc-a");
  const wsB = fakeWs("disc-b");
  const tableId = "table_disconnect_snapshot";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 100 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 100 }).ok, true);

  const before = tableManager.__debugCore(tableId);
  const updates = tableManager.cleanupConnection({ ws: wsB, userId: "user_b", nowTs: 101, activeSockets: [] });
  assert.equal(updates.length, 1);

  const snapshot = tableManager.tableSnapshot(tableId, "observer_user");
  const after = tableManager.__debugCore(tableId);

  assert.deepEqual(snapshot.members, [{ userId: "user_a", seat: 1 }]);
  assert.equal(snapshot.memberCount, snapshot.members.length);
  assert.deepEqual(after, before);
});


test("bootstrapHand starts PREFLOP once and remains idempotent for live hand", () => {
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const wsA = fakeWs("boot-a");
  const wsB = fakeWs("boot-b");

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId: "table_boot", requestId: "join-a", nowTs: 10 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId: "table_boot", requestId: "join-b", nowTs: 10 }).ok, true);

  const first = tableManager.bootstrapHand("table_boot");
  const firstSnapshot = tableManager.tableSnapshot("table_boot", "user_a");
  const second = tableManager.bootstrapHand("table_boot");
  const secondSnapshot = tableManager.tableSnapshot("table_boot", "user_a");

  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.equal(first.bootstrap, "started");
  assert.equal(firstSnapshot.hand.status, "PREFLOP");
  assert.equal(typeof firstSnapshot.hand.handId, "string");
  assert.ok(firstSnapshot.hand.handId.length > 0);
  assert.equal(firstSnapshot.turn.userId, "user_a");
  assert.deepEqual(firstSnapshot.pot, { total: 3, sidePots: [] });
  assert.deepEqual(firstSnapshot.legalActions, { seat: 1, actions: ["FOLD", "CALL", "RAISE"] });
  assert.equal(Array.isArray(firstSnapshot.private?.holeCards), true);
  assert.equal(firstSnapshot.private.holeCards.length, 2);

  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  assert.equal(second.bootstrap, "already_live");
  assert.equal(second.handId, first.handId);
  assert.equal(second.stateVersion, first.stateVersion);
  assert.deepEqual(secondSnapshot, firstSnapshot);
});


test("bootstrapHand uses seed-derived shuffled deck and can vary by effective seed", () => {
  const managerA = createTableManager({ maxSeats: 4 });
  const managerB = createTableManager({ maxSeats: 4 });
  const wsA1 = fakeWs("seed-a1");
  const wsA2 = fakeWs("seed-a2");
  const wsB1 = fakeWs("seed-b1");
  const wsB2 = fakeWs("seed-b2");

  assert.equal(managerA.join({ ws: wsA1, userId: "user_a", tableId: "table_seed_a", requestId: "join-a1" }).ok, true);
  assert.equal(managerA.join({ ws: wsA2, userId: "user_b", tableId: "table_seed_a", requestId: "join-a2" }).ok, true);
  assert.equal(managerB.join({ ws: wsB1, userId: "user_a", tableId: "table_seed_b", requestId: "join-b1" }).ok, true);
  assert.equal(managerB.join({ ws: wsB2, userId: "user_b", tableId: "table_seed_b", requestId: "join-b2" }).ok, true);

  const bootA = managerA.bootstrapHand("table_seed_a");
  const bootB = managerB.bootstrapHand("table_seed_b");
  assert.equal(bootA.ok, true);
  assert.equal(bootB.ok, true);

  const snapA = managerA.tableSnapshot("table_seed_a", "user_a");
  const snapB = managerB.tableSnapshot("table_seed_b", "user_a");

  assert.equal(snapA.hand.status, "PREFLOP");
  assert.equal(snapB.hand.status, "PREFLOP");
  assert.equal(snapA.private.holeCards.length, 2);
  assert.equal(snapB.private.holeCards.length, 2);
  assert.deepEqual(snapA.pot, { total: 3, sidePots: [] });
  assert.deepEqual(snapB.pot, { total: 3, sidePots: [] });
  assert.equal(snapA.turn.userId, "user_a");
  assert.equal(snapB.turn.userId, "user_a");
  assert.notDeepEqual(snapA.private.holeCards, snapB.private.holeCards);
});

test("applyAction accepts legal turn CALL and increments state version once", () => {
  const tableManager = createTableManager({ maxSeats: 4, enableDebugCore: true, nodeEnv: "test" });
  const wsA = fakeWs("apply-a");
  const wsB = fakeWs("apply-b");
  const tableId = "table_apply_action";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  const boot = tableManager.bootstrapHand(tableId);
  assert.equal(boot.ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const action = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_a",
    requestId: "req-act-a",
    action: "CALL",
    amount: 0
  });
  const after = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(action.accepted, true);
  assert.equal(after.stateVersion, before.stateVersion + 1);
  assert.deepEqual(after.pot, { total: 4, sidePots: [] });
  assert.equal(after.hand.status, "FLOP");
  assert.equal(after.board.cards.length, 3);
  assert.equal(after.turn.userId, "user_b");
  assert.deepEqual(after.legalActions, { seat: 1, actions: [] });
  assert.equal(after.private.holeCards.length, 2);
});

test("applyAction CALL closes initial heads-up preflop loop coherently", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("close-a");
  const wsB = fakeWs("close-b");
  const tableId = "table_apply_close";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const action = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_a",
    requestId: "req-close-call",
    action: "CALL",
    amount: 0
  });
  const actorAfter = tableManager.tableSnapshot(tableId, "user_a");
  const otherAfter = tableManager.tableSnapshot(tableId, "user_b");

  assert.equal(action.accepted, true);
  assert.equal(actorAfter.hand.status, "FLOP");
  assert.equal(actorAfter.board.cards.length, 3);
  assert.equal(actorAfter.turn.userId, "user_b");
  assert.deepEqual(actorAfter.legalActions, { seat: 1, actions: [] });
  assert.deepEqual(otherAfter.legalActions.actions.includes("CHECK"), true);
});

test("applyAction rejects mismatched hand and keeps snapshot unchanged", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("reject-a");
  const wsB = fakeWs("reject-b");
  const tableId = "table_apply_reject";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const rejected = tableManager.applyAction({
    tableId,
    handId: "bad_hand",
    userId: "user_a",
    requestId: "req-act-bad",
    action: "CALL",
    amount: 0
  });
  const after = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, "hand_mismatch");
  assert.deepEqual(after, before);
});

test("applyAction is idempotent for requestId and does not double-apply", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("idem-a");
  const wsB = fakeWs("idem-b");
  const tableId = "table_apply_idem";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const first = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_a",
    requestId: "req-idem",
    action: "CALL",
    amount: 0
  });
  const mid = tableManager.tableSnapshot(tableId, "user_a");
  const second = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_a",
    requestId: "req-idem",
    action: "CALL",
    amount: 0
  });
  const after = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(first.accepted, true);
  assert.equal(first.changed, true);
  assert.equal(first.replayed, false);
  assert.equal(second.accepted, true);
  assert.equal(second.changed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.stateVersion, first.stateVersion);
  assert.deepEqual(after, mid);
});

test("applyAction same requestId from different users does not collide", () => {
  const tableManager = createTableManager({ maxSeats: 4, actionResultCacheMax: 8 });
  const wsA = fakeWs("scope-a");
  const wsB = fakeWs("scope-b");
  const tableId = "table_apply_scope";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const actorResult = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_a",
    requestId: "req-shared",
    action: "CALL",
    amount: 0
  });

  const otherResult = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_b",
    requestId: "req-shared",
    action: "CALL",
    amount: 0
  });

  assert.equal(actorResult.accepted, true);
  assert.equal(actorResult.replayed, false);
  assert.equal(otherResult.accepted, false);
  assert.equal(otherResult.replayed, false);
  assert.equal(otherResult.reason, "illegal_action");
});

test("applyAction cache is bounded and evicts oldest requestIds deterministically", () => {
  const tableManager = createTableManager({ maxSeats: 4, actionResultCacheMax: 2, enableDebugCore: true, nodeEnv: "test" });
  const wsA = fakeWs("bounded-a");
  const wsB = fakeWs("bounded-b");
  const tableId = "table_apply_bounded";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const req1 = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_a",
    requestId: "req-bounded-1",
    action: "CALL",
    amount: 0
  });
  assert.equal(req1.accepted, true);

  const req2 = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_b",
    requestId: "req-bounded-2",
    action: "CALL",
    amount: 0
  });
  const req3 = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_b",
    requestId: "req-bounded-3",
    action: "FOLD",
    amount: 0
  });

  assert.equal(req2.accepted, false);
  assert.equal(req3.accepted, false);
  assert.equal(tableManager.__debugCore(tableId).actionResultsCacheSize, 2);

  const replayEvicted = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_a",
    requestId: "req-bounded-1",
    action: "CALL",
    amount: 0
  });
  assert.equal(replayEvicted.accepted, false);
  assert.equal(replayEvicted.reason, "illegal_action");

  const replayKept = tableManager.applyAction({
    tableId,
    handId: before.hand.handId,
    userId: "user_b",
    requestId: "req-bounded-3",
    action: "FOLD",
    amount: 0
  });
  assert.equal(replayKept.accepted, req3.accepted);
  assert.equal(replayKept.reason, req3.reason);
  assert.equal(replayKept.replayed, true);
  assert.equal(tableManager.__debugCore(tableId).actionResultsCacheSize, 2);
});

test("applyAction remains actionable after preflop street progression", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("street-a");
  const wsB = fakeWs("street-b");
  const tableId = "table_apply_street";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const pre = tableManager.tableSnapshot(tableId, "user_a");
  const closePreflop = tableManager.applyAction({ tableId, handId: pre.hand.handId, userId: "user_a", requestId: "req-pre-close", action: "CALL", amount: 0 });
  assert.equal(closePreflop.accepted, true);

  const flop = tableManager.tableSnapshot(tableId, "user_b");
  assert.equal(flop.hand.status, "FLOP");
  const flopAct = tableManager.applyAction({ tableId, handId: flop.hand.handId, userId: "user_b", requestId: "req-flop-check", action: "CHECK", amount: 0 });
  assert.equal(flopAct.accepted, true);
});

test("applyAction replay does not advance street or board twice", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("replay-a");
  const wsB = fakeWs("replay-b");
  const tableId = "table_apply_replay_street";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const before = tableManager.tableSnapshot(tableId, "user_a");
  const first = tableManager.applyAction({ tableId, handId: before.hand.handId, userId: "user_a", requestId: "req-close-replay", action: "CALL", amount: 0 });
  const mid = tableManager.tableSnapshot(tableId, "user_a");
  const second = tableManager.applyAction({ tableId, handId: before.hand.handId, userId: "user_a", requestId: "req-close-replay", action: "CALL", amount: 0 });
  const after = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(first.accepted, true);
  assert.equal(mid.hand.status, "FLOP");
  assert.equal(mid.board.cards.length, 3);
  assert.equal(second.replayed, true);
  assert.equal(second.changed, false);
  assert.equal(second.stateVersion, first.stateVersion);
  assert.deepEqual(after.board.cards, mid.board.cards);
  assert.equal(after.stateVersion, mid.stateVersion);
});

test("first FLOP CHECK keeps FLOP and passes turn", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("flop-a");
  const wsB = fakeWs("flop-b");
  const tableId = "table_apply_flop_first_check";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);
  const pre = tableManager.tableSnapshot(tableId, "user_a");
  assert.equal(tableManager.applyAction({ tableId, handId: pre.hand.handId, userId: "user_a", requestId: "req-pre-call", action: "CALL", amount: 0 }).accepted, true);

  const flopBefore = tableManager.tableSnapshot(tableId, "user_b");
  assert.equal(flopBefore.hand.status, "FLOP");
  assert.equal(flopBefore.turn.userId, "user_b");
  const firstCheck = tableManager.applyAction({ tableId, handId: flopBefore.hand.handId, userId: "user_b", requestId: "req-flop-check-1", action: "CHECK", amount: 0 });
  const flopAfter = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(firstCheck.accepted, true);
  assert.equal(flopAfter.hand.status, "FLOP");
  assert.equal(flopAfter.board.cards.length, 3);
  assert.equal(flopAfter.turn.userId, "user_a");
});

test("closing RIVER action keeps turn null and does not reopen action", () => {
  const tableManager = createTableManager({ maxSeats: 4 });
  const wsA = fakeWs("river-a");
  const wsB = fakeWs("river-b");
  const tableId = "table_apply_river_close";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1 }).ok, true);
  assert.equal(tableManager.bootstrapHand(tableId).ok, true);

  const pre = tableManager.tableSnapshot(tableId, "user_a");
  assert.equal(tableManager.applyAction({ tableId, handId: pre.hand.handId, userId: "user_a", requestId: "req-pre-call", action: "CALL", amount: 0 }).accepted, true);
  const flop = tableManager.tableSnapshot(tableId, "user_b");
  assert.equal(tableManager.applyAction({ tableId, handId: flop.hand.handId, userId: "user_b", requestId: "req-flop-check-1", action: "CHECK", amount: 0 }).accepted, true);
  assert.equal(tableManager.applyAction({ tableId, handId: flop.hand.handId, userId: "user_a", requestId: "req-flop-check-2", action: "CHECK", amount: 0 }).accepted, true);

  const turn = tableManager.tableSnapshot(tableId, "user_b");
  assert.equal(tableManager.applyAction({ tableId, handId: turn.hand.handId, userId: "user_b", requestId: "req-turn-check-1", action: "CHECK", amount: 0 }).accepted, true);
  assert.equal(tableManager.applyAction({ tableId, handId: turn.hand.handId, userId: "user_a", requestId: "req-turn-check-2", action: "CHECK", amount: 0 }).accepted, true);

  const river = tableManager.tableSnapshot(tableId, "user_b");
  assert.equal(river.hand.status, "RIVER");
  assert.equal(tableManager.applyAction({ tableId, handId: river.hand.handId, userId: "user_b", requestId: "req-river-check-1", action: "CHECK", amount: 0 }).accepted, true);
  const close = tableManager.applyAction({ tableId, handId: river.hand.handId, userId: "user_a", requestId: "req-river-check-2", action: "CHECK", amount: 0 });
  const after = tableManager.tableSnapshot(tableId, "user_a");

  assert.equal(close.accepted, true);
  assert.equal(after.hand.status, "RIVER");
  assert.equal(after.turn.userId, null);
  assert.deepEqual(after.legalActions.actions, []);
});
