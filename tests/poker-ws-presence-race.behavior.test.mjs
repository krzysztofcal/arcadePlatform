import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function buildHarness(){
  const source = fs.readFileSync(new URL("../poker/poker.js", import.meta.url), "utf8");
  const stopStart = source.indexOf("function stopWsClient(){");
  const stopEnd = source.indexOf("\n\n    function mapTableStateToSeatUpdates", stopStart);
  const stopFn = source.slice(stopStart, stopEnd);

  const presenceStart = source.indexOf("function mapTableStateToSeatUpdates(snapshotPayload)");
  const presenceEnd = source.indexOf("\n\n    function startWsBootstrap(){", presenceStart);
  const presenceFns = source.slice(presenceStart, presenceEnd);

  const factory = new Function(`
    var tableData = null;
    var wsStarted = false;
    var wsSnapshotSeen = false;
    var pendingWsSeatUpdate = null;
    var tableId = 'table_race';
    var wsClient = { destroy: function(){ this.destroyed = true; }, destroyed: false };
    var renderCount = 0;
    var lastRendered = null;
    var isSeated = false;
    function klog(){}
    function isCurrentUserSeated(){ return false; }
    function renderTable(data){ renderCount++; lastRendered = data; }
    ${stopFn}
    ${presenceFns}
    return {
      applyWsSnapshot: applyWsSnapshot,
      applyWsSeatUpdate: applyWsSeatUpdate,
      stopWsClient: stopWsClient,
      setTableData: function(data){ tableData = data; },
      setWsStarted: function(v){ wsStarted = !!v; },
      getPending: function(){ return pendingWsSeatUpdate; },
      getSeen: function(){ return wsSnapshotSeen; },
      getRenderCount: function(){ return renderCount; },
      getLastRendered: function(){ return lastRendered; },
      getWsStarted: function(){ return wsStarted; },
      getClientDestroyed: function(){ return !!(wsClient && wsClient.destroyed); },
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
    state: { state: { phase: "PREFLOP" } }
  });

  h.applyWsSnapshot({ type: "table_state", payload: { tableId: "table_race", members: [{ userId: "u1", seat: 1 }] } });
  assert.equal(h.getSeen(), true);
  assert.equal(h.getRenderCount(), 1);
  assert.equal(h.getLastRendered().seats[1].userId, "u1");

  h.setWsStarted(true);
  h.stopWsClient();
  assert.equal(h.getWsStarted(), false);
  assert.equal(h.getSeen(), false);
  assert.equal(h.getPending(), null);
  assert.equal(h.hasClient(), false);

  h.applyWsSnapshot({ type: "table_state", payload: { tableId: "table_race", members: [{ userId: "u2", seat: 0 }] } });
  assert.equal(h.getSeen(), true);
  assert.equal(h.getRenderCount(), 2);
  assert.equal(h.getLastRendered().seats[0].userId, "u2");
});

test("stopWsClient clears deferred pending presence from old session", () => {
  const h = buildHarness();

  h.applyWsSnapshot({ type: "table_state", payload: { tableId: "table_race", members: [{ userId: "old_u", seat: 1 }] } });
  assert.equal(h.getSeen(), false);
  assert.ok(h.getPending());
  assert.equal(h.getRenderCount(), 0);

  h.stopWsClient();
  assert.equal(h.getSeen(), false);
  assert.equal(h.getPending(), null);

  h.setTableData({
    table: { id: "table_race" },
    seats: [
      { seatNo: 0, userId: null, status: "EMPTY", stack: 100 },
      { seatNo: 1, userId: null, status: "EMPTY", stack: 150 }
    ],
    state: { state: { phase: "PREFLOP" } }
  });

  h.applyWsSnapshot({ type: "table_state", payload: { tableId: "table_race", members: [{ userId: "new_u", seat: 0 }] } });
  assert.equal(h.getSeen(), true);
  assert.equal(h.getRenderCount(), 1);
  assert.equal(h.getLastRendered().seats[0].userId, "new_u");
  assert.equal(h.getLastRendered().seats[1].userId, null);
});
