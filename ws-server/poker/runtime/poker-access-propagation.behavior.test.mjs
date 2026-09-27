import test from "node:test";
import assert from "node:assert/strict";
import { createTableManager } from "../table/table-manager.mjs";
import { persistAuthoritativeSlowOnlyForUser } from "./poker-access-propagation.mjs";

test("recovery persists authoritative SLOW-only marker before releasing the fail-closed barrier", async () => {
  const tableId = "table_access_recovery_slow";
  const userId = "00000000-0000-4000-8000-000000000031";
  const manager = createTableManager({ maxSeats: 4 });
  assert.equal(manager.restoreTableFromPersisted(tableId, {
    tableMeta: { maxPlayers: 4, lifecycleKind: "STANDARD", isSlowOnly: false },
    coreState: {
      version: 2,
      roomId: tableId,
      maxSeats: 4,
      members: [{ userId, seat: 1 }],
      seats: { [userId]: 1 },
      seatDetailsByUserId: { [userId]: { isBot: false } },
      pokerState: { phase: "SETTLED", handId: "hand_access_recovery", stacks: { [userId]: 100 } }
    }
  }).ok, true);
  manager.setPokerAccessMutationFailClosed(userId, true);

  let persisted = false;
  const tx = {
    async unsafe(sql, params) {
      assert.match(String(sql), /set is_slow_only = true/);
      assert.deepEqual(params, [userId]);
      persisted = true;
      return [{ id: tableId }];
    }
  };
  const tableIds = await persistAuthoritativeSlowOnlyForUser(tx, {
    userId,
    schemaBacked: true,
    effectiveClass: "SLOW"
  });
  assert.deepEqual(tableIds, [tableId]);
  assert.equal(persisted, true);

  manager.markSlowOnlyTables(tableIds);
  assert.equal(manager.tableMeta(tableId).isSlowOnly, true);
  manager.setPokerAccessMutationFailClosed(userId, false);
  manager.cachePokerAccess(tableId, userId, {
    automaticClass: "SLOW", override: "FORCE_SLOW", effectiveClass: "SLOW", revision: 9,
    loadedAtMs: 100, expiresAtMs: 30_100
  }, { schemaBacked: true, slowThresholdCh: 1_000_000_000, revision: 1, loadedAtMs: 100, expiresAtMs: 30_100 }, 100);
  assert.equal(manager.settledAccessStatus(tableId, { nowMs: 100 }).known, true);

  manager.cachePokerAccess(tableId, userId, {
    automaticClass: "SLOW", override: "FORCE_NORMAL", effectiveClass: "NORMAL", revision: 10,
    loadedAtMs: 200, expiresAtMs: 30_200
  }, null, 200);
  assert.equal(manager.tableMeta(tableId).isSlowOnly, true);
  manager.cachePokerAccess(tableId, userId, {
    automaticClass: "SLOW", override: "AUTO", effectiveClass: "SLOW", revision: 11,
    loadedAtMs: 300, expiresAtMs: 30_300
  }, null, 300);
  assert.equal(manager.tableMeta(tableId).isSlowOnly, true);
});

test("authoritative SLOW persistence is a no-op for legacy or non-SLOW snapshots", async () => {
  let calls = 0;
  const tx = { unsafe: async () => { calls += 1; return []; } };
  assert.deepEqual(await persistAuthoritativeSlowOnlyForUser(tx, {
    userId: "00000000-0000-4000-8000-000000000031",
    schemaBacked: false,
    effectiveClass: "SLOW"
  }), []);
  assert.deepEqual(await persistAuthoritativeSlowOnlyForUser(tx, {
    userId: "00000000-0000-4000-8000-000000000031",
    schemaBacked: true,
    effectiveClass: "NORMAL"
  }), []);
  assert.equal(calls, 0);
});
