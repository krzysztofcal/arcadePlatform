import test from "node:test";
import assert from "node:assert/strict";
import { handleTurnTimeoutCommand } from "./turn-timeout.mjs";

test("handleTurnTimeoutCommand persists, autoplays, and broadcasts on changed timeout", async () => {
  const calls = { persist: 0, autoplay: 0, snapshots: 0 };
  const result = await handleTurnTimeoutCommand({
    tableId: "t1",
    nowMs: 123,
    tableManager: {
      maybeApplyTurnTimeout: ({ tableId, nowMs }) => ({ ok: true, changed: true, tableId, nowMs, stateVersion: 4, requestId: "timeout:t1" })
    },
    persistMutatedState: async () => {
      calls.persist += 1;
      return { ok: true };
    },
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => {
      calls.snapshots += 1;
    },
    scheduleBotStep: () => {
      calls.autoplay += 1;
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls.persist, 1);
  assert.equal(calls.autoplay, 1);
  assert.equal(calls.snapshots, 1);
});

test("handleTurnTimeoutCommand no-ops cleanly when timeout is not due", async () => {
  const calls = { persist: 0, autoplay: 0, snapshots: 0 };
  const result = await handleTurnTimeoutCommand({
    tableId: "t1",
    tableManager: {
      maybeApplyTurnTimeout: () => ({ ok: true, changed: false, reason: "not_due", stateVersion: 3 })
    },
    persistMutatedState: async () => {
      calls.persist += 1;
      return { ok: true };
    },
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => {
      calls.snapshots += 1;
    },
    scheduleBotStep: () => {
      calls.autoplay += 1;
    }
  });

  assert.equal(result.changed, false);
  assert.equal(calls.persist, 0);
  assert.equal(calls.autoplay, 0);
  assert.equal(calls.snapshots, 0);
});

test("handleTurnTimeoutCommand restores and broadcasts snapshots on recoverable persistence conflict", async () => {
  const calls = { restore: 0, resync: 0, autoplay: 0, snapshots: 0 };
  const result = await handleTurnTimeoutCommand({
    tableId: "t1",
    tableManager: {
      maybeApplyTurnTimeout: () => ({ ok: true, changed: true, stateVersion: 9, requestId: "timeout:t1" })
    },
    persistMutatedState: async () => ({ ok: false, reason: "persistence_conflict" }),
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: true };
    },
    broadcastResyncRequired: () => {
      calls.resync += 1;
    },
    broadcastStateSnapshots: () => {
      calls.snapshots += 1;
    },
    scheduleBotStep: () => {
      calls.autoplay += 1;
    }
  });

  assert.equal(result.ok, false);
  assert.equal(calls.restore, 1);
  assert.equal(calls.resync, 0);
  assert.equal(calls.autoplay, 0);
  assert.equal(calls.snapshots, 1);
});

test("handleTurnTimeoutCommand emits resync only when restore itself fails", async () => {
  const calls = { restore: 0, resync: 0, autoplay: 0, snapshots: 0 };
  const result = await handleTurnTimeoutCommand({
    tableId: "t1",
    tableManager: {
      maybeApplyTurnTimeout: () => ({ ok: true, changed: true, stateVersion: 9, requestId: "timeout:t1" })
    },
    persistMutatedState: async () => ({ ok: false, reason: "persistence_conflict" }),
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: false, reason: "restore_failed" };
    },
    broadcastResyncRequired: () => {
      calls.resync += 1;
    },
    broadcastStateSnapshots: () => {
      calls.snapshots += 1;
    },
    scheduleBotStep: () => {
      calls.autoplay += 1;
    }
  });

  assert.equal(result.ok, false);
  assert.equal(calls.restore, 1);
  assert.equal(calls.resync, 1);
  assert.equal(calls.autoplay, 0);
  assert.equal(calls.snapshots, 0);
});
