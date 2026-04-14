import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("ws bootstrap can hydrate occupied seats from authoritativeMembers when live members are empty", () => {
  const source = fs.readFileSync(new URL("../poker/poker.js", import.meta.url), "utf8");
  const wsStart = source.indexOf("function isRichGameplaySnapshot(snapshotPayload, snapshotKind)");
  const wsEnd = source.indexOf("\n\n    function startWsBootstrap(){", wsStart);
  assert.ok(wsStart >= 0 && wsEnd > wsStart);
  const wsFns = source.slice(wsStart, wsEnd);

  const factory = new Function(`
    var tableData = null;
    var tableId = "table_boot";
    var wsSnapshotSeen = false;
    var pendingWsSnapshot = null;
    var wsAppliedSnapshotSeq = 0;
    var pendingLeaveNavigation = false;
    var leaveConfirmOpen = false;
    function closeLeaveConfirm(){ leaveConfirmOpen = false; }
    var renderCount = 0;
    var lastRendered = null;
    var isSeated = false;
    var stopPollingCalls = 0;
    function isPlainObject(value){ return !!(value && typeof value === 'object' && !Array.isArray(value)); }
    function toFiniteOrNull(value){ var n = Number(value); if (!Number.isFinite(n) || Math.floor(n) !== n || n < 0) return null; return n; }
    function getConstraintsFromResponse(data){ if (data && isPlainObject(data.actionConstraints)) return data.actionConstraints; var gameState = data && data.state && data.state.state; if (gameState && isPlainObject(gameState.actionConstraints)) return gameState.actionConstraints; return null; }
    function getSafeConstraints(data){ var constraints = getConstraintsFromResponse(data); return { toCall: toFiniteOrNull(constraints ? constraints.toCall : null), minRaiseTo: toFiniteOrNull(constraints ? constraints.minRaiseTo : null), maxRaiseTo: toFiniteOrNull(constraints ? constraints.maxRaiseTo : null), maxBetAmount: toFiniteOrNull(constraints ? constraints.maxBetAmount : null) }; }
    function getSeatedCount(data){ var seats = data && Array.isArray(data.seats) ? data.seats : []; var activeCount = 0; for (var i = 0; i < seats.length; i++){ var seat = seats[i]; if (!seat || !seat.userId) continue; var status = typeof seat.status === 'string' ? seat.status.toUpperCase() : ''; if (!status || status === 'ACTIVE' || status === 'SEATED') activeCount++; } return activeCount; }
    function isCurrentUserSeated(){ return false; }
    function renderTable(data){ renderCount++; lastRendered = data; }
    function stopPolling(){ stopPollingCalls++; }
    function klog(){}
    ${wsFns}
    return {
      applyWsSnapshot: applyWsSnapshot,
      applyWsSnapshotNow: applyWsSnapshotNow,
      setTableData: function(data){ tableData = data; },
      getPending: function(){ return pendingWsSnapshot; },
      getSeen: function(){ return wsSnapshotSeen; },
      getRenderCount: function(){ return renderCount; },
      getLastRendered: function(){ return lastRendered; },
      getStopPollingCalls: function(){ return stopPollingCalls; }
    };
  `);

  const h = factory();
  h.applyWsSnapshot({
    type: "table_state",
    payload: {
      tableId: "table_boot",
      members: [],
      authoritativeMembers: [{ userId: "uA", seat: 0 }, { userId: "uB", seat: 1 }],
      stateVersion: 2,
      hand: { status: "PREFLOP" }
    }
  });

  assert.equal(h.getSeen(), false);
  assert.ok(h.getPending());

  h.setTableData({
    table: { id: "table_boot" },
    seats: [
      { seatNo: 0, userId: null, status: "EMPTY", stack: 100 },
      { seatNo: 1, userId: null, status: "EMPTY", stack: 120 }
    ],
    state: { version: 1, state: { phase: "WAITING" } },
    legalActions: [],
    actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
    _actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null }
  });

  const applied = h.applyWsSnapshotNow(h.getPending());
  assert.equal(applied, true);
  assert.equal(h.getSeen(), true);
  assert.equal(h.getRenderCount(), 1);
  assert.equal(h.getLastRendered().seats[0].userId, "uA");
  assert.equal(h.getLastRendered().seats[1].userId, "uB");
  assert.equal(h.getStopPollingCalls(), 1);

  h.applyWsSnapshot({
    type: "table_state",
    payload: {
      tableId: "table_boot",
      members: [],
      authoritativeMembers: [{ userId: "stale", seat: 0 }],
      stateVersion: 2
    }
  });
  assert.equal(h.getStopPollingCalls(), 1);
});
