import test from "node:test";
import assert from "node:assert/strict";
import { adaptPersistedBootstrap } from "./persisted-bootstrap-adapter.mjs";

test("adapter maps persisted rows into deterministic ws table/core state", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_1",
    tableRow: { id: "table_1", max_players: 6 },
    seatRows: [
      { user_id: "user_b", seat_no: 4, status: "ACTIVE", is_bot: false },
      { user_id: "user_a", seat_no: 2, status: "ACTIVE", is_bot: false },
      { user_id: "user_x", seat_no: 3, status: "LEFT", is_bot: false }
    ],
    stateRow: { version: 12, state: { phase: "PREFLOP", handId: "h1" } }
  });

  assert.equal(result.ok, true);
  assert.equal(result.table.coreState.version, 12);
  assert.deepEqual(result.table.coreState.members, [
    { userId: "user_a", seat: 2 },
    { userId: "user_b", seat: 4 }
  ]);
  assert.deepEqual(result.table.coreState.seats, { user_a: 2, user_b: 4 });
});

test("adapter rejects malformed persisted state", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_2",
    tableRow: { id: "table_2", max_players: 6 },
    seatRows: [{ user_id: "user_a", seat_no: 1, status: "ACTIVE" }],
    stateRow: { version: "bad", state: null }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_persisted_state");
});
