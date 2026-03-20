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

async function setupTable() {
  const tableManager = createTableManager();
  const wsA = fakeWs("a");
  const wsB = fakeWs("b");
  const wsObserver = fakeWs("obs");
  const tableId = "table_act_handler_invalid";

  tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 1 });
  tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 2 });
  tableManager.subscribe({ ws: wsObserver, tableId });
  tableManager.bootstrapHand(tableId, { nowMs: 3000 });

  const snapshot = tableManager.tableSnapshot(tableId, "user_a");
  return { tableManager, wsA, wsB, wsObserver, tableId, handId: snapshot.hand?.handId };
}

test("handleAct rejects malformed, wrong table, wrong user, and illegal actions without mutation", async () => {
  const { tableManager, wsA, wsObserver, tableId, handId } = await setupTable();
  assert.ok(handId);

  const sendErrors = [];
  const commandResults = [];
  const broadcasts = [];

  const beforeVersion = tableManager.tableSnapshot(tableId, "user_a").stateVersion;

  const cases = [
    {
      name: "malformed payload",
      ws: wsA,
      connState: createConnState("user_a"),
      tableId,
      frame: { requestId: "bad-1", ts: "2026-03-01T00:00:00Z", payload: { tableId, action: "FOLD" } },
      expect: "error"
    },
    {
      name: "wrong table against active connection",
      ws: wsObserver,
      connState: createConnState("user_observer"),
      tableId: "table_other",
      frame: { requestId: "bad-2", ts: "2026-03-01T00:00:00Z", payload: { tableId: "table_other", handId, action: "FOLD" } },
      expect: "result"
    },
    {
      name: "not seated user",
      ws: wsA,
      connState: createConnState("intruder"),
      tableId,
      frame: { requestId: "bad-3", ts: "2026-03-01T00:00:00Z", payload: { tableId, handId, action: "CALL" } },
      expect: "result"
    },
    {
      name: "not your turn",
      ws: wsA,
      connState: createConnState("user_b"),
      tableId,
      frame: { requestId: "bad-4", ts: "2026-03-01T00:00:00Z", payload: { tableId, handId, action: "CHECK" } },
      expect: "result"
    },
    {
      name: "illegal action",
      ws: wsA,
      connState: createConnState("user_a"),
      tableId,
      frame: { requestId: "bad-5", ts: "2026-03-01T00:00:00Z", payload: { tableId, handId, action: "RAISE", amount: 1 } },
      expect: "result"
    }
  ];

  for (const testCase of cases) {
    await handleAct({
      frame: testCase.frame,
      ws: testCase.ws,
      connState: testCase.connState,
      tableId: testCase.tableId,
      tableManager,
      sendError: (_ws, _conn, payload) => sendErrors.push({ name: testCase.name, payload }),
      sendCommandResult: (_ws, _conn, payload) => commandResults.push({ name: testCase.name, payload }),
      persistMutatedState: async () => assert.fail("invalid cases must not persist"),
      restoreTableFromPersisted: async () => assert.fail("invalid cases must not restore"),
      broadcastResyncRequired: () => assert.fail("invalid cases must not resync"),
      broadcastStateSnapshots: (broadcastTableId) => broadcasts.push(broadcastTableId)
    });
  }

  const afterVersion = tableManager.tableSnapshot(tableId, "user_a").stateVersion;
  assert.equal(afterVersion, beforeVersion, "invalid acts must not mutate authoritative state");
  assert.equal(broadcasts.length, 0, "invalid acts must not broadcast success snapshots");

  const malformed = sendErrors.find((entry) => entry.name === "malformed payload");
  assert.ok(malformed);
  assert.equal(malformed.payload.code, "INVALID_COMMAND");

  for (const name of ["wrong table against active connection", "not seated user", "not your turn", "illegal action"]) {
    const rejection = commandResults.find((entry) => entry.name === name);
    assert.ok(rejection, `expected commandResult for ${name}`);
    assert.equal(rejection.payload.status, "rejected");
  }
});
