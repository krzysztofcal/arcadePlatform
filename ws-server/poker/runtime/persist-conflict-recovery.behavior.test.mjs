import test from "node:test";
import assert from "node:assert/strict";
import { recoverFromPersistConflict } from "./persist-conflict-recovery.mjs";

test("recoverFromPersistConflict restores and broadcasts snapshots before resync fallback", async () => {
  const calls = { restore: 0, snapshots: 0, resync: 0 };
  const result = await recoverFromPersistConflict({
    tableId: "t1",
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: true };
    },
    broadcastStateSnapshots: () => {
      calls.snapshots += 1;
    },
    broadcastResyncRequired: () => {
      calls.resync += 1;
    }
  });

  assert.deepEqual(result, {
    ok: true,
    restored: true,
    restoreReason: null
  });
  assert.equal(calls.restore, 1);
  assert.equal(calls.snapshots, 1);
  assert.equal(calls.resync, 0);
});

test("recoverFromPersistConflict emits resync only when restore fails", async () => {
  const calls = { restore: 0, snapshots: 0, resync: 0 };
  const result = await recoverFromPersistConflict({
    tableId: "t1",
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: false, reason: "restore_failed" };
    },
    broadcastStateSnapshots: () => {
      calls.snapshots += 1;
    },
    broadcastResyncRequired: () => {
      calls.resync += 1;
    }
  });

  assert.deepEqual(result, {
    ok: false,
    restored: false,
    restoreReason: "restore_failed"
  });
  assert.equal(calls.restore, 1);
  assert.equal(calls.snapshots, 0);
  assert.equal(calls.resync, 1);
});
