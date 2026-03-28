import test from "node:test";
import assert from "node:assert/strict";
import { handleAct } from "./act.mjs";
import { createTableManager } from "../table/table-manager.mjs";

function fakeWs(id) {
  return { id };
}

function createConnState(userId) {
  return {
    sessionId: `session_${userId}`,
    session: { userId }
  };
}

test("handleAct accepts legal action, broadcasts once, and is idempotent by requestId", async () => {
  const tableManager = createTableManager();
  const wsA = fakeWs("a");
  const wsB = fakeWs("b");
  const tableId = "table_act_handler_ok";

  tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1000 });
  tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 1001 });
  const boot = tableManager.bootstrapHand(tableId, { nowMs: 2000 });
  assert.equal(boot.ok, true);
  assert.equal(boot.changed, true);

  const preSnapshot = tableManager.tableSnapshot(tableId, "user_a");
  const handId = preSnapshot.hand?.handId;
  assert.ok(handId, "expected handId in snapshot");

  const connA = createConnState("user_a");
  const sentCommandResults = [];
  const broadcastCalls = [];
  const persistedCalls = [];

  const frame = {
    requestId: "req-act-1",
    ts: "2026-03-01T00:00:00Z",
    payload: { tableId, handId, action: "FOLD" }
  };

  await handleAct({
    frame,
    ws: wsA,
    connState: connA,
    tableId,
    tableManager,
    sendError: () => assert.fail("did not expect sendError"),
    sendCommandResult: (_ws, _connState, payload) => sentCommandResults.push(payload),
    persistMutatedState: async (payload) => { persistedCalls.push(payload); return { ok: true }; },
    restoreTableFromPersisted: async () => assert.fail("did not expect restore"),
    broadcastResyncRequired: () => assert.fail("did not expect resync"),
    broadcastStateSnapshots: (broadcastTableId) => broadcastCalls.push(broadcastTableId)
  });

  const postSnapshot = tableManager.tableSnapshot(tableId, "user_a");
  assert.equal(sentCommandResults.length, 1);
  assert.equal(sentCommandResults[0].status, "accepted");
  assert.equal(persistedCalls.length, 1);
  assert.equal(broadcastCalls.length, 1);
  assert.equal(postSnapshot.stateVersion, preSnapshot.stateVersion + 1);

  await handleAct({
    frame,
    ws: wsA,
    connState: connA,
    tableId,
    tableManager,
    sendError: () => assert.fail("did not expect sendError"),
    sendCommandResult: (_ws, _connState, payload) => sentCommandResults.push(payload),
    persistMutatedState: async () => { persistedCalls.push({ duplicate: true }); return { ok: true }; },
    restoreTableFromPersisted: async () => assert.fail("did not expect restore"),
    broadcastResyncRequired: () => assert.fail("did not expect resync"),
    broadcastStateSnapshots: (broadcastTableId) => broadcastCalls.push(broadcastTableId)
  });

  const replaySnapshot = tableManager.tableSnapshot(tableId, "user_a");
  assert.equal(sentCommandResults.length, 2);
  assert.equal(sentCommandResults[1].status, "accepted");
  assert.equal(persistedCalls.length, 1, "duplicate requestId must not persist again");
  assert.equal(broadcastCalls.length, 1, "duplicate requestId must not broadcast again");
  assert.equal(replaySnapshot.stateVersion, postSnapshot.stateVersion, "duplicate requestId must not mutate state");
});
