import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function buildHarness(){
  const source = fs.readFileSync(new URL("../poker/poker.js", import.meta.url), "utf8");
  const stopStart = source.indexOf("function stopWsClient(){");
  const stopEnd = source.indexOf("\n\n    function mapTableStateToSeatUpdates", stopStart);
  const stopFn = source.slice(stopStart, stopEnd);

  const wsStart = source.indexOf("function mapTableStateToSeatUpdates(snapshotPayload)");
  const wsEnd = source.indexOf("\n\n    function startWsBootstrap(){", wsStart);
  const wsFns = source.slice(wsStart, wsEnd);

  const factory = new Function(`
    var tableData = null;
    var wsStarted = false;
    var wsSnapshotSeen = false;
    var pendingWsSnapshot = null;
    var tableId = 'table_race';
    var wsClient = { destroy: function(){ this.destroyed = true; }, destroyed: false };
    var renderCount = 0;
    var lastRendered = null;
    var isSeated = false;
    function klog(){}
    function isCurrentUserSeated(){ return false; }
    function renderTable(data){ renderCount++; lastRendered = data; }
    function isPlainObject(value){ return !!(value && typeof value === 'object' && !Array.isArray(value)); }
    function toFiniteOrNull(value){ var n = Number(value); if (!Number.isFinite(n) || Math.floor(n) !== n || n < 0) return null; return n; }
    function getConstraintsFromResponse(data){ if (data && isPlainObject(data.actionConstraints)) return data.actionConstraints; var gameState = data && data.state && data.state.state; if (gameState && isPlainObject(gameState.actionConstraints)) return gameState.actionConstraints; return null; }
    function getSafeConstraints(data){ var constraints = getConstraintsFromResponse(data); return { toCall: toFiniteOrNull(constraints ? constraints.toCall : null), minRaiseTo: toFiniteOrNull(constraints ? constraints.minRaiseTo : null), maxRaiseTo: toFiniteOrNull(constraints ? constraints.maxRaiseTo : null), maxBetAmount: toFiniteOrNull(constraints ? constraints.maxBetAmount : null) }; }
    ${stopFn}
    ${wsFns}
    return {
      applyWsSnapshot: applyWsSnapshot,
      applyWsSnapshotNow: applyWsSnapshotNow,
      stopWsClient: stopWsClient,
      setTableData: function(data){ tableData = data; },
      getTableData: function(){ return tableData; },
      setWsStarted: function(v){ wsStarted = !!v; },
      getPending: function(){ return pendingWsSnapshot; },
      getSeen: function(){ return wsSnapshotSeen; },
      getRenderCount: function(){ return renderCount; },
      getLastRendered: function(){ return lastRendered; },
      getWsStarted: function(){ return wsStarted; },
      hasClient: function(){ return !!wsClient; }
    };
  `);
  return factory();
}

test("stopWsClient reset allows second bootstrap snapshot apply", () => {
  const h = buildHarness();

  h.setTableData({
    table: { id: "table_race" },
    seats: [
      { seatNo: 0, userId: null, status: "EMPTY", stack: 100 },
      { seatNo: 1, userId: null, status: "EMPTY", stack: 150 }
    ],
    state: { version: 1, state: { phase: "PREFLOP" } },
    actionConstraints: { toCall: 6, minRaiseTo: 12, maxRaiseTo: 120, maxBetAmount: 120 },
    _actionConstraints: { toCall: 6, minRaiseTo: 12, maxRaiseTo: 120, maxBetAmount: 120 }
  });

  h.applyWsSnapshot({ type: "table_state", payload: { tableId: "table_race", stateVersion: 2, members: [{ userId: "live_presence", seat: 0 }], authoritativeMembers: [{ userId: "u1", seat: 1 }], hand: { status: "FLOP" } } });
  assert.equal(h.getSeen(), true);
  assert.equal(h.getRenderCount(), 1);
  assert.equal(h.getLastRendered().seats[1].userId, "u1");
  assert.equal(h.getLastRendered().state.version, 2);

  h.setWsStarted(true);
  h.stopWsClient();
  assert.equal(h.getWsStarted(), false);
  assert.equal(h.getSeen(), false);
  assert.equal(h.getPending(), null);
  assert.equal(h.hasClient(), false);

  h.applyWsSnapshot({ type: "table_state", payload: { tableId: "table_race", stateVersion: 3, members: [{ userId: "live_presence", seat: 1 }], authoritativeMembers: [{ userId: "u2", seat: 0 }] } });
  assert.equal(h.getSeen(), true);
  assert.equal(h.getRenderCount(), 2);
  assert.equal(h.getLastRendered().seats[0].userId, "u2");
  assert.equal(h.getLastRendered().state.version, 3);
});

test("deferred snapshot apply preserves baseline constraints when WS omits them", () => {
  const h = buildHarness();

  h.applyWsSnapshot({
    type: "table_state",
    payload: {
      tableId: "table_race",
      stateVersion: 9,
      members: [{ userId: "live_presence", seat: 1 }],
      authoritativeMembers: [{ userId: "new_u", seat: 0 }],
      hand: { status: "TURN" },
      legalActions: { actions: ["CALL", "RAISE"] }
    }
  });
  assert.equal(h.getSeen(), false);
  assert.ok(h.getPending());

  h.setTableData({
    table: { id: "table_race" },
    seats: [
      { seatNo: 0, userId: null, status: "EMPTY", stack: 100 },
      { seatNo: 1, userId: null, status: "EMPTY", stack: 150 }
    ],
    legalActions: ["FOLD"],
    actionConstraints: { toCall: 7, minRaiseTo: 14, maxRaiseTo: 200, maxBetAmount: 200 },
    _actionConstraints: { toCall: 7, minRaiseTo: 14, maxRaiseTo: 200, maxBetAmount: 200 },
    state: { version: 1, state: { phase: "PREFLOP" } }
  });

  const applied = h.applyWsSnapshotNow(h.getPending());
  assert.equal(applied, true);
  assert.equal(h.getSeen(), true);
  assert.equal(h.getPending(), null);
  assert.equal(h.getRenderCount(), 1);
  const merged = h.getTableData();
  assert.equal(merged.state.version, 9);
  assert.deepEqual(merged.legalActions, ["CALL", "RAISE"]);
  assert.deepEqual(merged.actionConstraints, { toCall: 7, minRaiseTo: 14, maxRaiseTo: 200, maxBetAmount: 200 });
  assert.deepEqual(merged._actionConstraints, merged.actionConstraints);

  h.stopWsClient();
  assert.equal(h.getSeen(), false);
  assert.equal(h.getPending(), null);
});
