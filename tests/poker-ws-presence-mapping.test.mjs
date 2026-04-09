import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("poker ws merge preserves baseline constraints when WS omits them and updates when provided", () => {
  const source = fs.readFileSync(new URL("../poker/poker.js", import.meta.url), "utf8");
  const marker = "function isRichGameplaySnapshot(snapshotPayload, snapshotKind)";
  const start = source.indexOf(marker);
  assert.ok(start >= 0, "ws mapping helpers should exist");
  const end = source.indexOf("\n\n    function startWsBootstrap(){", start);
  assert.ok(end > start, "merge helper boundaries should exist");
  const fnSource = source.slice(start, end).trim();
  const factory = new Function(`
    function isPlainObject(value){ return !!(value && typeof value === 'object' && !Array.isArray(value)); }
    function toFiniteOrNull(value){ var n = Number(value); if (!Number.isFinite(n) || Math.floor(n) !== n || n < 0) return null; return n; }
    function getConstraintsFromResponse(data){ if (data && isPlainObject(data.actionConstraints)) return data.actionConstraints; var gameState = data && data.state && data.state.state; if (gameState && isPlainObject(gameState.actionConstraints)) return gameState.actionConstraints; return null; }
    function getSafeConstraints(data){ var constraints = getConstraintsFromResponse(data); return { toCall: toFiniteOrNull(constraints ? constraints.toCall : null), minRaiseTo: toFiniteOrNull(constraints ? constraints.minRaiseTo : null), maxRaiseTo: toFiniteOrNull(constraints ? constraints.maxRaiseTo : null), maxBetAmount: toFiniteOrNull(constraints ? constraints.maxBetAmount : null) }; }
    function getSeatedCount(data){ var seats = data && Array.isArray(data.seats) ? data.seats : []; var activeCount = 0; for (var i = 0; i < seats.length; i++){ var seat = seats[i]; if (!seat || !seat.userId) continue; var status = typeof seat.status === 'string' ? seat.status.toUpperCase() : ''; if (!status || status === 'ACTIVE' || status === 'SEATED') activeCount++; } return activeCount; }
    ${fnSource}
    return { mergeWsStateIntoTableData, getSafeConstraints };
  `);
  const { mergeWsStateIntoTableData, getSafeConstraints } = factory();

  const baselineTableData = {
    table: { id: "table_1", stakes: { sb: 1, bb: 2 } },
    seats: [
      { seatNo: 0, userId: "u0", status: "ACTIVE", stack: 150, tag: "preserve" },
      { seatNo: 1, userId: null, status: "EMPTY", stack: 200, tag: "preserve" }
    ],
    legalActions: ["FOLD"],
    actionConstraints: { toCall: 9, minRaiseTo: 20, maxRaiseTo: 300, maxBetAmount: 300 },
    _actionConstraints: { toCall: 9, minRaiseTo: 20, maxRaiseTo: 300, maxBetAmount: 300 },
    state: {
      version: 12,
      state: { phase: "WAITING", community: [], pot: 0, turnDeadlineAt: null, keepField: "yes" },
      extraBaselineOnly: true
    }
  };

  const wsNoConstraints = {
    tableId: "table_1",
    stateVersion: 42,
    members: [{ userId: "live_presence_user", seat: 0 }],
    authoritativeMembers: [{ userId: "u1", seat: 1 }],
    hand: { status: "TURN", handId: "h1" },
    board: { cards: ["As", "Kd", "2h", "9c"] },
    pot: { total: 77, sidePots: [{ total: 10 }] },
    turn: { userId: "u1", deadlineAt: 123456789 },
    legalActions: { seat: 1, actions: ["CHECK", "BET"] }
  };

  const mergedNoConstraints = mergeWsStateIntoTableData(baselineTableData, wsNoConstraints);
  mergedNoConstraints._actionConstraints = getSafeConstraints(mergedNoConstraints);
  assert.equal(mergedNoConstraints.version, undefined);
  assert.equal(mergedNoConstraints.state.version, 42);
  assert.equal(mergedNoConstraints.state.extraBaselineOnly, true);
  assert.equal(mergedNoConstraints.state.state.keepField, "yes");
  assert.equal(mergedNoConstraints.state.state.phase, "TURN");
  const authoritativeSeat = Array.isArray(mergedNoConstraints.seats)
    ? mergedNoConstraints.seats.find((seat) => Number.isInteger(seat?.seatNo) && seat.seatNo === 1)
    : null;
  assert.ok(authoritativeSeat, "authoritative seat mapping should contain seatNo=1");
  assert.equal(authoritativeSeat.userId, "u1");
  assert.deepEqual(mergedNoConstraints.legalActions, ["CHECK", "BET"]);
  assert.deepEqual(mergedNoConstraints.actionConstraints, baselineTableData.actionConstraints);
  assert.deepEqual(mergedNoConstraints._actionConstraints, baselineTableData.actionConstraints);

  const wsWithConstraints = {
    tableId: "table_1",
    stateVersion: 43,
    members: [{ userId: "live_presence_user", seat: 0 }],
    authoritativeMembers: [{ userId: "u1", seat: 1 }],
    hand: { status: "RIVER", handId: "h2" },
    legalActions: { seat: 1, actions: ["CALL", "RAISE"] },
    actionConstraints: { toCall: 11, minRaiseTo: 22, maxRaiseTo: 333, maxBetAmount: 333 }
  };

  const mergedWithConstraints = mergeWsStateIntoTableData(mergedNoConstraints, wsWithConstraints);
  mergedWithConstraints._actionConstraints = getSafeConstraints(mergedWithConstraints);
  assert.equal(mergedWithConstraints.state.version, 43);
  assert.deepEqual(mergedWithConstraints.legalActions, ["CALL", "RAISE"]);
  assert.deepEqual(mergedWithConstraints.actionConstraints, wsWithConstraints.actionConstraints);
  assert.deepEqual(mergedWithConstraints._actionConstraints, wsWithConstraints.actionConstraints);
});
