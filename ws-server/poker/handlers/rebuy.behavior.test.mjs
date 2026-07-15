import assert from "node:assert/strict";
import test from "node:test";
import { handleRebuyCommand } from "./rebuy.mjs";

function baseArgs(overrides = {}) {
  const events = [];
  return {
    events,
    args: {
      frame: { requestId: "request", ts: "2026-07-14T00:00:00.000Z", payload: { amount: 100 } },
      ws: {},
      connState: { session: { userId: "user" } },
      tableId: "table",
      loadAuthoritativeRebuyExecutor: async () => async () => ({ ok: true, stateVersion: 9 }),
      restoreTableFromPersisted: async () => ({ ok: true }),
      broadcastStateSnapshots: () => events.push("snapshot"),
      broadcastTableState: () => events.push("table"),
      broadcastResyncRequired: () => events.push("resync"),
      sendCommandResult: (_ws, _state, payload) => events.push(payload),
      scheduleBotStep: () => events.push("bot"),
      klog: () => {},
      ...overrides
    }
  };
}

test("rebuy handler restores committed state before broadcasting authoritative snapshot", async () => {
  const harness = baseArgs();
  await handleRebuyCommand(harness.args);
  assert.equal(harness.events[0].status, "accepted");
  assert.deepEqual(harness.events.slice(1), ["snapshot", "table", "bot"]);
});

test("rebuy handler rejects domain failure without runtime mutation", async () => {
  const harness = baseArgs({ loadAuthoritativeRebuyExecutor: async () => async () => ({ ok: false, code: "insufficient_chips" }) });
  await handleRebuyCommand(harness.args);
  assert.deepEqual(harness.events, [{ requestId: "request", tableId: "table", status: "rejected", reason: "insufficient_chips" }]);
});

test("rebuy handler requests resync when commit succeeded but runtime restore fails", async () => {
  const harness = baseArgs({ restoreTableFromPersisted: async () => ({ ok: false, reason: "restore_error" }) });
  await handleRebuyCommand(harness.args);
  assert.equal(harness.events[0].status, "accepted");
  assert.equal(harness.events[1], "resync");
  assert.equal(harness.events.includes("snapshot"), false);
});
