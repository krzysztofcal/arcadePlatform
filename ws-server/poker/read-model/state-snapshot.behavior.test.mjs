import test from "node:test";
import assert from "node:assert/strict";
import { createTableManager } from "../table/table-manager.mjs";
import { buildStateSnapshotPayload } from "./state-snapshot.mjs";

test("buildStateSnapshotPayload returns canonical payload for seated authenticated user", () => {
  const tableManager = createTableManager({ maxSeats: 6 });
  const wsA = {};
  const wsB = {};

  const joinB = tableManager.join({ ws: wsB, userId: "user_b", tableId: "table_A", requestId: "join-b" });
  assert.equal(joinB.ok, true);
  const joinA = tableManager.join({ ws: wsA, userId: "user_a", tableId: "table_A", requestId: "join-a" });
  assert.equal(joinA.ok, true);

  const tableSnapshot = tableManager.tableSnapshot("table_A", "user_a");
  const payload = buildStateSnapshotPayload({ tableSnapshot, userId: "user_a" });

  assert.equal(Number.isInteger(payload.stateVersion), true);
  assert.equal(typeof payload.table, "object");
  assert.equal(typeof payload.you, "object");
  assert.deepEqual(payload.table.members, [
    { userId: "user_b", seat: 1 },
    { userId: "user_a", seat: 2 }
  ]);
  assert.equal(payload.you.userId, "user_a");
  assert.equal(payload.you.seat, 2);
});

test("buildStateSnapshotPayload keeps user scope and null seat for non-seated authenticated user", () => {
  const tableManager = createTableManager({ maxSeats: 6 });
  const wsA = {};
  const wsB = {};

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId: "table_B", requestId: "join-a" }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId: "table_B", requestId: "join-b" }).ok, true);

  const tableSnapshot = tableManager.tableSnapshot("table_B", "observer_user");
  const payload = buildStateSnapshotPayload({ tableSnapshot, userId: "observer_user" });

  assert.equal(payload.you.userId, "observer_user");
  assert.equal(payload.you.seat, null);
  assert.equal("private" in payload, false);
  assert.equal("players" in payload.you, false);
});
