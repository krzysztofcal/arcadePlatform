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
    appliedRequestIdsLength: 1
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
