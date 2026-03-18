import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { adaptPersistedBootstrap } from "../ws-server/poker/bootstrap/persisted-bootstrap-adapter.mjs";
import { createTableManager } from "../ws-server/poker/table/table-manager.mjs";

function loadBuildTableStatePayload() {
  const source = fs.readFileSync(new URL("../ws-server/server.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function buildTableStatePayload({ tableState, tableSnapshot }) {");
  const end = source.indexOf("\n\nfunction sendTableState", start);
  assert.ok(start >= 0 && end > start, "buildTableStatePayload must exist in ws-server/server.mjs");
  return new Function(`${source.slice(start, end)}; return buildTableStatePayload;`)();
}

test("lobby/no-hand table snapshot payload includes bumped-version joined seat and stack for UI rendering", async () => {
  const tableId = "table_lobby_join_public_snapshot";
  const tableManager = createTableManager({
    tableBootstrapLoader: async ({ tableId: loadedTableId }) => adaptPersistedBootstrap({
      tableId: loadedTableId,
      tableRow: { id: loadedTableId, max_players: 6 },
      seatRows: [],
      stateRow: { version: 0, state: {} }
    })
  });
  const buildTableStatePayload = loadBuildTableStatePayload();
  const ws = { id: "ws-lobby-join-public" };

  const ensured = await tableManager.ensureTableLoaded(tableId);
  assert.equal(ensured.ok, true);
  const baselineSnapshot = tableManager.tableSnapshot(tableId, "user_joined");
  assert.equal(baselineSnapshot.stateVersion, 0);

  const joined = tableManager.join({
    ws,
    userId: "user_joined",
    tableId,
    requestId: "join-lobby-public",
    nowTs: 100,
    authoritativeSeatNo: 2,
    buyIn: 175
  });
  assert.equal(joined.ok, true);
  assert.equal(joined.changed, true);

  const tableSnapshot = tableManager.tableSnapshot(tableId, "user_joined");
  const payload = buildTableStatePayload({
    tableState: tableManager.tableState(tableId),
    tableSnapshot
  });

  assert.equal(tableSnapshot.stateVersion > baselineSnapshot.stateVersion, true);
  assert.deepEqual(tableSnapshot.seats, [{ userId: "user_joined", seatNo: 2, status: "ACTIVE" }]);
  assert.deepEqual(tableSnapshot.stacks, { user_joined: 175 });
  assert.equal(tableSnapshot.youSeat, 2);
  assert.deepEqual(payload.members, [{ userId: "user_joined", seat: 2 }], "live members should include the connected joined socket");
  assert.deepEqual(payload.authoritativeMembers, [{ userId: "user_joined", seat: 2 }]);
  assert.deepEqual(payload.seats, [{ userId: "user_joined", seatNo: 2, status: "ACTIVE" }]);
  assert.deepEqual(payload.stacks, { user_joined: 175 });
  assert.equal(payload.youSeat, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "private"), false);
});
