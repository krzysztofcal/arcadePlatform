import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function compactCards(cards){
  return (Array.isArray(cards) ? cards : []).map((card) => ({ r: card.r, s: card.s }));
}

test("rich ws snapshot merge updates public fields and preserves constraints when omitted", () => {
  const source = fs.readFileSync(new URL("../poker/poker.js", import.meta.url), "utf8");
  const start = source.indexOf("function isRichGameplaySnapshot(snapshotPayload, snapshotKind)");
  const end = source.indexOf("\n\n    function startWsBootstrap(){", start);
  assert.ok(start >= 0 && end > start);
  const fnSource = source.slice(start, end);

  const factory = new Function(`
    function isPlainObject(value){ return !!(value && typeof value === 'object' && !Array.isArray(value)); }
    function toFiniteOrNull(value){ var n = Number(value); if (!Number.isFinite(n) || Math.floor(n) !== n || n < 0) return null; return n; }
    function getConstraintsFromResponse(data){ if (data && isPlainObject(data.actionConstraints)) return data.actionConstraints; var gameState = data && data.state && data.state.state; if (gameState && isPlainObject(gameState.actionConstraints)) return gameState.actionConstraints; return null; }
    function getSafeConstraints(data){ var constraints = getConstraintsFromResponse(data); return { toCall: toFiniteOrNull(constraints ? constraints.toCall : null), minRaiseTo: toFiniteOrNull(constraints ? constraints.minRaiseTo : null), maxRaiseTo: toFiniteOrNull(constraints ? constraints.maxRaiseTo : null), maxBetAmount: toFiniteOrNull(constraints ? constraints.maxBetAmount : null) }; }
    function getSeatedCount(data){ var seats = data && Array.isArray(data.seats) ? data.seats : []; var activeCount = 0; for (var i = 0; i < seats.length; i++){ var seat = seats[i]; if (!seat || !seat.userId) continue; var status = typeof seat.status === 'string' ? seat.status.toUpperCase() : ''; if (!status || status === 'ACTIVE' || status === 'SEATED') activeCount++; } return activeCount; }
    var wsAppliedSnapshotSeq = 0;
    var pendingLeaveNavigation = false;
    var leaveConfirmOpen = false;
    function closeLeaveConfirm(){ leaveConfirmOpen = false; }
    ${fnSource}
    return { mergeWsStateIntoTableData, getSafeConstraints };
  `);
  const { mergeWsStateIntoTableData, getSafeConstraints } = factory();

  const baseline = {
    table: { id: "table_rich", stakes: { sb: 5, bb: 10 }, createdAt: "keep-this" },
    seats: [
      { seatNo: 0, userId: "u0", stack: 500, status: "ACTIVE" },
      { seatNo: 1, userId: null, stack: 400, status: "EMPTY" }
    ],
    legalActions: ["FOLD"],
    actionConstraints: { toCall: 20, minRaiseTo: 40, maxRaiseTo: 300, maxBetAmount: 300 },
    _actionConstraints: { toCall: 20, minRaiseTo: 40, maxRaiseTo: 300, maxBetAmount: 300 },
    state: {
      version: 2,
      state: { phase: "WAITING", community: [], pot: 0, turnDeadlineAt: null },
      extraServerFields: { keep: true }
    }
  };

  const noConstraintPayload = {
    tableId: "table_rich",
    stateVersion: 7,
    members: [{ userId: "live_presence_u0", seat: 0 }],
    authoritativeMembers: [{ userId: "u0", seat: 0 }, { userId: "u1", seat: 1 }],
    hand: { handId: "h_7", status: "TURN", round: "TURN" },
    board: { cards: ["Ah", "Kd", "Qc", "2s"] },
    pot: { total: 123, sidePots: [] },
    turn: { userId: "u1", seat: 1, deadlineAt: 999999 },
    legalActions: { seat: 0, actions: ["FOLD", "CALL", "RAISE"] }
  };

  const mergedA = mergeWsStateIntoTableData(baseline, noConstraintPayload);
  mergedA._actionConstraints = getSafeConstraints(mergedA);
  assert.equal(mergedA.state.version, 7);
  assert.equal(mergedA.state.state.phase, "TURN");
  assert.equal(mergedA.state.state.turnUserId, "u1");
  assert.equal(mergedA.state.state.pot, 123);
  assert.deepEqual(compactCards(mergedA.state.state.community), [{ r: "A", s: "H" }, { r: "K", s: "D" }, { r: "Q", s: "C" }, { r: "2", s: "S" }]);
  assert.deepEqual(mergedA.legalActions, ["FOLD", "CALL", "RAISE"]);
  assert.deepEqual(mergedA.actionConstraints, baseline.actionConstraints);
  assert.deepEqual(mergedA._actionConstraints, baseline.actionConstraints);

  const mergedA2 = mergeWsStateIntoTableData(mergedA, noConstraintPayload);
  mergedA2._actionConstraints = getSafeConstraints(mergedA2);
  assert.deepEqual(mergedA2.actionConstraints, mergedA.actionConstraints);
  assert.deepEqual(mergedA2._actionConstraints, mergedA._actionConstraints);

  const withConstraintPayload = Object.assign({}, noConstraintPayload, {
    stateVersion: 8,
    actionConstraints: { toCall: 11, minRaiseTo: 22, maxRaiseTo: 333, maxBetAmount: 333 }
  });
  const mergedB = mergeWsStateIntoTableData(mergedA, withConstraintPayload);
  mergedB._actionConstraints = getSafeConstraints(mergedB);
  assert.equal(mergedB.state.version, 8);
  assert.deepEqual(mergedB.actionConstraints, withConstraintPayload.actionConstraints);
  assert.deepEqual(mergedB._actionConstraints, withConstraintPayload.actionConstraints);
});

test("card normalization helpers parse classic string cards and reject invalid entries", () => {
  const source = fs.readFileSync(new URL("../poker/poker.js", import.meta.url), "utf8");
  const start = source.indexOf("function isRichGameplaySnapshot(snapshotPayload, snapshotKind)");
  const end = source.indexOf("\n\n    function startWsBootstrap(){", start);
  const fnSource = source.slice(start, end);
  const factory = new Function(`
    function isPlainObject(value){ return !!(value && typeof value === 'object' && !Array.isArray(value)); }
    function toFiniteOrNull(value){ var n = Number(value); if (!Number.isFinite(n) || Math.floor(n) !== n || n < 0) return null; return n; }
    function getConstraintsFromResponse(data){ if (data && isPlainObject(data.actionConstraints)) return data.actionConstraints; var gameState = data && data.state && data.state.state; if (gameState && isPlainObject(gameState.actionConstraints)) return gameState.actionConstraints; return null; }
    function getSafeConstraints(data){ var constraints = getConstraintsFromResponse(data); return { toCall: toFiniteOrNull(constraints ? constraints.toCall : null), minRaiseTo: toFiniteOrNull(constraints ? constraints.minRaiseTo : null), maxRaiseTo: toFiniteOrNull(constraints ? constraints.maxRaiseTo : null), maxBetAmount: toFiniteOrNull(constraints ? constraints.maxBetAmount : null) }; }
    function getSeatedCount(){ return 0; }
    var wsAppliedSnapshotSeq = 0;
    var pendingLeaveNavigation = false;
    var leaveConfirmOpen = false;
    function closeLeaveConfirm(){ leaveConfirmOpen = false; }
    ${fnSource}
    return { normalizeCardForRender, normalizeCardsForRender };
  `);
  const { normalizeCardForRender, normalizeCardsForRender } = factory();
  assert.deepEqual(normalizeCardForRender("As"), { r: "A", s: "S" });
  assert.deepEqual(normalizeCardForRender("Td"), { r: 10, s: "D" });
  assert.deepEqual(compactCards(normalizeCardsForRender(["As", "Kd", "3h"])), [{ r: "A", s: "S" }, { r: "K", s: "D" }, { r: "3", s: "H" }]);
  assert.deepEqual(compactCards(normalizeCardsForRender(["As", "??", null, "9x", "Kd"])), [{ r: "A", s: "S" }, { r: "K", s: "D" }]);
});


test("ws snapshot gating upgrades on higher version and ignores stale payloads", () => {
  const source = fs.readFileSync(new URL("../poker/poker.js", import.meta.url), "utf8");
  const start = source.indexOf("function isRichGameplaySnapshot(snapshotPayload, snapshotKind)");
  const end = source.indexOf("\n\n    function startWsBootstrap(){", start);
  const wsFns = source.slice(start, end);

  const factory = new Function(`
    var tableData = null;
    var wsSnapshotSeen = false;
    var pendingWsSnapshot = null;
    var tableId = 'table_rich';
    var renderCount = 0;
    var isSeated = false;
    var stopPollingCalls = 0;
    function klog(){}
    function renderTable(){ renderCount++; }
    function stopPolling(){ stopPollingCalls++; }
    function isCurrentUserSeated(){ return false; }
    function isPlainObject(value){ return !!(value && typeof value === 'object' && !Array.isArray(value)); }
    function toFiniteOrNull(value){ var n = Number(value); if (!Number.isFinite(n) || Math.floor(n) !== n || n < 0) return null; return n; }
    function getConstraintsFromResponse(data){ if (data && isPlainObject(data.actionConstraints)) return data.actionConstraints; var gameState = data && data.state && data.state.state; if (gameState && isPlainObject(gameState.actionConstraints)) return gameState.actionConstraints; return null; }
    function getSafeConstraints(data){ var constraints = getConstraintsFromResponse(data); return { toCall: toFiniteOrNull(constraints ? constraints.toCall : null), minRaiseTo: toFiniteOrNull(constraints ? constraints.minRaiseTo : null), maxRaiseTo: toFiniteOrNull(constraints ? constraints.maxRaiseTo : null), maxBetAmount: toFiniteOrNull(constraints ? constraints.maxBetAmount : null) }; }
    function getSeatedCount(data){ var seats = data && Array.isArray(data.seats) ? data.seats : []; var activeCount = 0; for (var i = 0; i < seats.length; i++){ var seat = seats[i]; if (!seat || !seat.userId) continue; var status = typeof seat.status === 'string' ? seat.status.toUpperCase() : ''; if (!status || status === 'ACTIVE' || status === 'SEATED') activeCount++; } return activeCount; }
    var wsAppliedSnapshotSeq = 0;
    var pendingLeaveNavigation = false;
    var leaveConfirmOpen = false;
    function closeLeaveConfirm(){ leaveConfirmOpen = false; }
    ${wsFns}
    return {
      applyWsSnapshot,
      setTableData: function(v){ tableData = v; },
      getTableData: function(){ return tableData; },
      getRenderCount: function(){ return renderCount; },
      getStopPollingCalls: function(){ return stopPollingCalls; }
    };
  `);

  const h = factory();
  h.setTableData({
    table: { id: "table_rich" },
    seats: [{ seatNo: 0, userId: "u0", status: "ACTIVE", stack: 500 }],
    state: { version: 10, state: { phase: "TURN" } },
    actionConstraints: { toCall: 2, minRaiseTo: 4, maxRaiseTo: 40, maxBetAmount: 40 },
    _actionConstraints: { toCall: 2, minRaiseTo: 4, maxRaiseTo: 40, maxBetAmount: 40 }
  });

  h.applyWsSnapshot({ type: "table_state", payload: { tableId: "table_rich", stateVersion: 11, authoritativeMembers: [{ userId: "u1", seat: 0 }], hand: { status: "RIVER" } } });
  assert.equal(h.getTableData().state.version, 11);
  assert.equal(h.getRenderCount(), 1);
  assert.equal(h.getStopPollingCalls(), 1);

  h.applyWsSnapshot({ type: "table_state", payload: { tableId: "table_rich", stateVersion: 9, authoritativeMembers: [{ userId: "stale", seat: 0 }] } });
  assert.equal(h.getTableData().state.version, 11);
  assert.equal(h.getTableData().seats[0].userId, "u1");
  assert.equal(h.getRenderCount(), 1);
  assert.equal(h.getStopPollingCalls(), 1);

  h.applyWsSnapshot({
    kind: "stateSnapshot",
    payload: {
      table: { tableId: "table_rich", members: [{ userId: "u1", seat: 0 }] },
      version: 10,
      private: { holeCards: [{ r: "A", s: "S" }, { r: "K", s: "D" }] },
      public: { board: [{ r: "2", s: "C" }, { r: "3", s: "D" }, { r: "4", s: "H" }] }
    }
  });
  assert.equal(h.getTableData().state.version, 11);
  assert.equal(Array.isArray(h.getTableData().myHoleCards), false);
  assert.equal(h.getRenderCount(), 1);
});

test("equal-version rich snapshot applies when it adds private hole cards", () => {
  const source = fs.readFileSync(new URL("../poker/poker.js", import.meta.url), "utf8");
  const start = source.indexOf("function isRichGameplaySnapshot(snapshotPayload, snapshotKind)");
  const end = source.indexOf("\n\n    function startWsBootstrap(){", start);
  const wsFns = source.slice(start, end);

  const factory = new Function(`
    var tableData = null;
    var wsSnapshotSeen = false;
    var pendingWsSnapshot = null;
    var tableId = 'table_rich';
    var isSeated = false;
    function klog(){}
    function renderTable(){}
    function stopPolling(){}
    function isCurrentUserSeated(){ return true; }
    function maybeAutoStartHand(){}
    var lastAutoStartSeatCount = null;
    var currentUserId = 'u0';
    function isPlainObject(value){ return !!(value && typeof value === 'object' && !Array.isArray(value)); }
    function toFiniteOrNull(value){ var n = Number(value); if (!Number.isFinite(n) || Math.floor(n) !== n || n < 0) return null; return n; }
    function getConstraintsFromResponse(data){ if (data && isPlainObject(data.actionConstraints)) return data.actionConstraints; var gameState = data && data.state && data.state.state; if (gameState && isPlainObject(gameState.actionConstraints)) return gameState.actionConstraints; return null; }
    function getSafeConstraints(data){ var constraints = getConstraintsFromResponse(data); return { toCall: toFiniteOrNull(constraints ? constraints.toCall : null), minRaiseTo: toFiniteOrNull(constraints ? constraints.minRaiseTo : null), maxRaiseTo: toFiniteOrNull(constraints ? constraints.maxRaiseTo : null), maxBetAmount: toFiniteOrNull(constraints ? constraints.maxBetAmount : null) }; }
    function getSeatedCount(){ return 1; }
    var wsAppliedSnapshotSeq = 0;
    var pendingLeaveNavigation = false;
    var leaveConfirmOpen = false;
    function closeLeaveConfirm(){ leaveConfirmOpen = false; }
    ${wsFns}
    return {
      applyWsSnapshot,
      setTableData: function(v){ tableData = v; },
      getTableData: function(){ return tableData; }
    };
  `);
  const h = factory();
  h.setTableData({
    table: { id: "table_rich" },
    seats: [{ seatNo: 0, userId: "u0", status: "ACTIVE", stack: 500 }],
    legalActions: [],
    actionConstraints: {},
    _actionConstraints: {},
    state: { version: 7, state: { phase: "PREFLOP", community: [] } }
  });

  h.applyWsSnapshot({
    kind: "stateSnapshot",
    payload: {
      table: { tableId: "table_rich", members: [{ userId: "u0", seat: 0 }] },
      version: 7,
      public: { hand: { handId: "h7", status: "PREFLOP" }, board: [] },
      private: { holeCards: [{ r: "A", s: "S" }, { r: "K", s: "D" }] }
    }
  });

  assert.equal(h.getTableData().state.version, 7);
  assert.equal(Array.isArray(h.getTableData().myHoleCards), true);
  assert.deepEqual(compactCards(h.getTableData().myHoleCards), [{ r: "A", s: "S" }, { r: "K", s: "D" }]);
});

test("rich snapshot public board maps into community cards", () => {
  const source = fs.readFileSync(new URL("../poker/poker.js", import.meta.url), "utf8");
  const start = source.indexOf("function isRichGameplaySnapshot(snapshotPayload, snapshotKind)");
  const end = source.indexOf("\n\n    function startWsBootstrap(){", start);
  const wsFns = source.slice(start, end);

  const factory = new Function(`
    var tableData = null;
    var wsSnapshotSeen = false;
    var pendingWsSnapshot = null;
    var tableId = 'table_rich';
    var isSeated = false;
    function klog(){}
    function renderTable(){}
    function stopPolling(){}
    function isCurrentUserSeated(){ return true; }
    function maybeAutoStartHand(){}
    var lastAutoStartSeatCount = null;
    var currentUserId = 'u0';
    function isPlainObject(value){ return !!(value && typeof value === 'object' && !Array.isArray(value)); }
    function toFiniteOrNull(value){ var n = Number(value); if (!Number.isFinite(n) || Math.floor(n) !== n || n < 0) return null; return n; }
    function getConstraintsFromResponse(data){ if (data && isPlainObject(data.actionConstraints)) return data.actionConstraints; var gameState = data && data.state && data.state.state; if (gameState && isPlainObject(gameState.actionConstraints)) return gameState.actionConstraints; return null; }
    function getSafeConstraints(data){ var constraints = getConstraintsFromResponse(data); return { toCall: toFiniteOrNull(constraints ? constraints.toCall : null), minRaiseTo: toFiniteOrNull(constraints ? constraints.minRaiseTo : null), maxRaiseTo: toFiniteOrNull(constraints ? constraints.maxRaiseTo : null), maxBetAmount: toFiniteOrNull(constraints ? constraints.maxBetAmount : null) }; }
    function getSeatedCount(){ return 1; }
    var wsAppliedSnapshotSeq = 0;
    var pendingLeaveNavigation = false;
    var leaveConfirmOpen = false;
    function closeLeaveConfirm(){ leaveConfirmOpen = false; }
    ${wsFns}
    return {
      applyWsSnapshot,
      setTableData: function(v){ tableData = v; },
      getTableData: function(){ return tableData; }
    };
  `);
  const h = factory();
  h.setTableData({
    table: { id: "table_rich" },
    seats: [{ seatNo: 0, userId: "u0", status: "ACTIVE", stack: 500 }],
    legalActions: [],
    actionConstraints: {},
    _actionConstraints: {},
    state: { version: 4, state: { phase: "PREFLOP", community: [] } }
  });

  h.applyWsSnapshot({
    kind: "stateSnapshot",
    payload: {
      table: { tableId: "table_rich", members: [{ userId: "u0", seat: 0 }] },
      version: 5,
      public: {
        hand: { handId: "h5", status: "FLOP" },
        board: [{ r: "A", s: "S" }, { r: "K", s: "D" }, { r: "3", s: "H" }]
      }
    }
  });

  assert.equal(h.getTableData().state.version, 5);
  assert.equal(h.getTableData().state.state.phase, "FLOP");
  assert.deepEqual(compactCards(h.getTableData().state.state.community), [{ r: "A", s: "S" }, { r: "K", s: "D" }, { r: "3", s: "H" }]);
});

test("invalid rich board cards do not clobber existing valid community cards", () => {
  const source = fs.readFileSync(new URL("../poker/poker.js", import.meta.url), "utf8");
  const start = source.indexOf("function isRichGameplaySnapshot(snapshotPayload, snapshotKind)");
  const end = source.indexOf("\n\n    function startWsBootstrap(){", start);
  const wsFns = source.slice(start, end);
  const factory = new Function(`
    var tableData = null;
    var wsSnapshotSeen = false;
    var pendingWsSnapshot = null;
    var tableId = 'table_rich';
    var isSeated = false;
    function klog(){}
    function renderTable(){}
    function stopPolling(){}
    function isCurrentUserSeated(){ return true; }
    function maybeAutoStartHand(){}
    var lastAutoStartSeatCount = null;
    var currentUserId = 'u0';
    function isPlainObject(value){ return !!(value && typeof value === 'object' && !Array.isArray(value)); }
    function toFiniteOrNull(value){ var n = Number(value); if (!Number.isFinite(n) || Math.floor(n) !== n || n < 0) return null; return n; }
    function getConstraintsFromResponse(data){ if (data && isPlainObject(data.actionConstraints)) return data.actionConstraints; var gameState = data && data.state && data.state.state; if (gameState && isPlainObject(gameState.actionConstraints)) return gameState.actionConstraints; return null; }
    function getSafeConstraints(data){ var constraints = getConstraintsFromResponse(data); return { toCall: toFiniteOrNull(constraints ? constraints.toCall : null), minRaiseTo: toFiniteOrNull(constraints ? constraints.minRaiseTo : null), maxRaiseTo: toFiniteOrNull(constraints ? constraints.maxRaiseTo : null), maxBetAmount: toFiniteOrNull(constraints ? constraints.maxBetAmount : null) }; }
    function getSeatedCount(){ return 1; }
    var wsAppliedSnapshotSeq = 0;
    var pendingLeaveNavigation = false;
    var leaveConfirmOpen = false;
    function closeLeaveConfirm(){ leaveConfirmOpen = false; }
    ${wsFns}
    return {
      applyWsSnapshot,
      setTableData: function(v){ tableData = v; },
      getTableData: function(){ return tableData; }
    };
  `);
  const h = factory();
  h.setTableData({
    table: { id: "table_rich" },
    seats: [{ seatNo: 0, userId: "u0", status: "ACTIVE", stack: 500 }],
    legalActions: [],
    actionConstraints: {},
    _actionConstraints: {},
    state: { version: 6, state: { phase: "TURN", community: [{ r: "A", s: "S" }, { r: "K", s: "D" }, { r: "Q", s: "C" }] } }
  });

  h.applyWsSnapshot({
    kind: "stateSnapshot",
    payload: {
      table: { tableId: "table_rich", members: [{ userId: "u0", seat: 0 }] },
      version: 7,
      public: { board: ["??", "", null] }
    }
  });

  assert.deepEqual(compactCards(h.getTableData().state.state.community), [{ r: "A", s: "S" }, { r: "K", s: "D" }, { r: "Q", s: "C" }]);
});
