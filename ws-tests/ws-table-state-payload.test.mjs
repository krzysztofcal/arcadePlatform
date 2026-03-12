import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("buildTableStatePayload includes actionConstraints when present and keeps public fields", () => {
  const source = fs.readFileSync(new URL("../ws-server/server.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function buildTableStatePayload({ tableState, tableSnapshot }) {");
  assert.ok(start >= 0, "buildTableStatePayload should exist");
  const end = source.indexOf("\n\nfunction sendTableState", start);
  assert.ok(end > start, "buildTableStatePayload boundary should exist");
  const fnSource = source.slice(start, end);
  const factory = new Function(`${fnSource}; return buildTableStatePayload;`);
  const buildTableStatePayload = factory();

  const tableState = { tableId: "table_1", members: [{ userId: "u1", seat: 0 }] };
  const withConstraints = buildTableStatePayload({
    tableState,
    tableSnapshot: {
      roomId: "table_1",
      stateVersion: 22,
      hand: { status: "TURN" },
      board: { cards: ["Ah", "Kd", "Qs", "2c"] },
      pot: { total: 90, sidePots: [] },
      turn: { userId: "u1", seat: 0, deadlineAt: 123 },
      legalActions: { seat: 0, actions: ["CHECK", "BET"] },
      actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: 500 },
      private: { shouldNotBeIncluded: true }
    }
  });

  assert.equal(withConstraints.tableId, "table_1");
  assert.deepEqual(withConstraints.members, [{ userId: "u1", seat: 0 }]);
  assert.equal(withConstraints.stateVersion, 22);
  assert.deepEqual(withConstraints.legalActions, { seat: 0, actions: ["CHECK", "BET"] });
  assert.deepEqual(withConstraints.actionConstraints, { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: 500 });
  assert.equal(Object.prototype.hasOwnProperty.call(withConstraints, "private"), false);

  const noConstraints = buildTableStatePayload({
    tableState,
    tableSnapshot: { roomId: "table_1", stateVersion: 23, legalActions: { seat: 0, actions: ["CHECK"] } }
  });
  assert.equal(Object.prototype.hasOwnProperty.call(noConstraints, "actionConstraints"), false);
});
