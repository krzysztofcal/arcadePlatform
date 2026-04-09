import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("buildTableStatePayload keeps live members and emits authoritativeMembers from snapshot", () => {
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
      memberCount: 1,
      seats: [{ userId: "seed_user", seatNo: 2, status: "ACTIVE" }],
      stacks: { seed_user: 180 },
      hand: { status: "TURN" },
      board: { cards: ["Ah", "Kd", "Qs", "2c"] },
      pot: { total: 90, sidePots: [] },
      turn: { userId: "u1", seat: 0, deadlineAt: 123 },
      legalActions: { seat: 0, actions: ["CHECK", "BET"] },
      actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: 500 },
      members: [{ userId: "seed_user", seat: 2 }],
      private: { shouldNotBeIncluded: true }
    }
  });

  assert.equal(withConstraints.tableId, "table_1");
  assert.deepEqual(withConstraints.members, [{ userId: "u1", seat: 0 }]);
  assert.equal(withConstraints.stateVersion, 22);
  assert.equal(withConstraints.memberCount, 1);
  assert.deepEqual(withConstraints.seats, [{ userId: "seed_user", seatNo: 2, status: "ACTIVE" }]);
  assert.deepEqual(withConstraints.stacks, { seed_user: 180 });
  assert.deepEqual(withConstraints.legalActions, { seat: 0, actions: ["CHECK", "BET"] });
  assert.deepEqual(withConstraints.actionConstraints, { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: 500 });
  assert.deepEqual(withConstraints.authoritativeMembers, [{ userId: "seed_user", seat: 2 }]);
  assert.equal(Object.prototype.hasOwnProperty.call(withConstraints, "private"), false);

  const noConstraints = buildTableStatePayload({
    tableState,
    tableSnapshot: { roomId: "table_1", stateVersion: 23, legalActions: { seat: 0, actions: ["CHECK"] } }
  });
  assert.equal(Object.prototype.hasOwnProperty.call(noConstraints, "actionConstraints"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(noConstraints, "authoritativeMembers"), false);
});


test("buildTableStatePayload forwards lobby/no-hand public seats and stacks without private data", () => {
  const source = fs.readFileSync(new URL("../ws-server/server.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function buildTableStatePayload({ tableState, tableSnapshot }) {");
  const end = source.indexOf("\n\nfunction sendTableState", start);
  const buildTableStatePayload = new Function(`${source.slice(start, end)}; return buildTableStatePayload;`)();

  const payload = buildTableStatePayload({
    tableState: { tableId: "table_lobby", members: [] },
    tableSnapshot: {
      tableId: "table_lobby",
      roomId: "table_lobby",
      stateVersion: 0,
      youSeat: 2,
      members: [{ userId: "user_joined", seat: 2 }],
      seats: [{ userId: "user_joined", seatNo: 2, status: "ACTIVE" }],
      stacks: { user_joined: 175 },
      hand: { handId: null, status: "LOBBY", round: null },
      pot: { total: 0, sidePots: [] },
      turn: { userId: "user_joined", seat: 2, startedAt: null, deadlineAt: null },
      private: { holeCards: ["As", "Kd"] }
    }
  });

  assert.deepEqual(payload.members, []);
  assert.deepEqual(payload.authoritativeMembers, [{ userId: "user_joined", seat: 2 }]);
  assert.deepEqual(payload.seats, [{ userId: "user_joined", seatNo: 2, status: "ACTIVE" }]);
  assert.deepEqual(payload.stacks, { user_joined: 175 });
  assert.equal(payload.youSeat, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "private"), false);
});
