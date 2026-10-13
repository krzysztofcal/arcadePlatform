import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { adaptPersistedBootstrap } from "../ws-server/poker/bootstrap/persisted-bootstrap-adapter.mjs";
import { createTableManager } from "../ws-server/poker/table/table-manager.mjs";
import { normalizePrivateBranch } from "../ws-server/poker/read-model/state-snapshot.mjs";

test("public Online lobby excludes UUID tables until trusted mode is known", async () => {
  const tableId = '00000000-0000-4000-8000-000000000107';
  const manager = createTableManager();
  await manager.ensureTableLoaded(tableId, { allowCreate: true });
  const source = fs.readFileSync(new URL('../ws-server/server.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function buildLobbyTableEntry(tableId) {');
  const end = source.indexOf('\nfunction syncLobbyTable(', start);
  const dependencies = {
    tableManager: manager, isGuestTableId: () => false,
    normalizeLobbyHandStatus: () => 'WAITING', isLiveHandPhase: () => false,
    isLobbyTableJoinable: () => true, hasVisibleHumanLobbySeat: () => false
  };
  const buildEntry = new Function(...Object.keys(dependencies), source.slice(start, end) + '\nreturn buildLobbyTableEntry;')(...Object.values(dependencies));
  assert.equal(buildEntry(tableId), null, 'missing mode cannot advertise a persisted table as Online');
  manager.materializeLobbyTable({ tableId, tableMeta: { isSinglePlayer: false } });
  assert.equal(buildEntry(tableId)?.tableId, tableId, 'known Online mode remains discoverable');
});

function loadBuildTableStatePayload() {
  const source = fs.readFileSync(new URL("../ws-server/server.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function buildTableStatePayload({ tableState, tableSnapshot, userId }) {");
  const end = source.indexOf("\n\nfunction sendTableState", start);
  assert.ok(start >= 0 && end > start, "buildTableStatePayload must exist in ws-server/server.mjs");
  // buildTableStatePayload references normalizePrivateBranch and its helpers from
  // the module import — inject the real implementations so the extracted function
  // behaves identically to production.
  const normalizeCards = (cards) => (Array.isArray(cards) ? cards.filter((card) => typeof card === "string") : []);
  const normalizePlayerState = (playerState) => {
    if (!playerState || typeof playerState !== "object" || Array.isArray(playerState)) return null;
    const allowedStatuses = new Set(["ACTIVE", "OUT_OF_CHIPS", "WAITING_NEXT_HAND"]);
    const status = typeof playerState.status === "string" ? playerState.status.trim().toUpperCase() : "";
    if (!allowedStatuses.has(status) || !Number.isInteger(playerState.stack) || playerState.stack < 0) return null;
    return { status, stack: playerState.stack, canRebuy: playerState.canRebuy === true };
  };
  return new Function(`const normalizeCards = ${normalizeCards.toString()}; const normalizePlayerState = ${normalizePlayerState.toString()}; const normalizePrivateBranch = ${normalizePrivateBranch.toString()}; ${source.slice(start, end)}; return buildTableStatePayload;`)();
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
