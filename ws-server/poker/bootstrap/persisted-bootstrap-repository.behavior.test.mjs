import test from "node:test";
import assert from "node:assert/strict";
import { createPersistedBootstrapRepository } from "./persisted-bootstrap-repository.mjs";

test("fixture repository load is deterministic without DB env", async () => {
  const tableId = "table_fixture_repo";
  const fixture = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6 },
      seatRows: [{ user_id: "user_a", seat_no: 1, status: "ACTIVE" }],
      stateRow: { version: 4, state: { handId: "h4", phase: "PREFLOP" } }
    }
  };

  const repo = createPersistedBootstrapRepository({
    env: {
      WS_PERSISTED_BOOTSTRAP_FIXTURES_JSON: JSON.stringify(fixture),
      SUPABASE_DB_URL: ""
    }
  });

  const first = await repo.load(tableId);
  const second = await repo.load(tableId);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    tableRow: fixture[tableId].tableRow,
    seatRows: fixture[tableId].seatRows,
    stateRow: fixture[tableId].stateRow
  });
});

test("db bootstrap module resolves from ws-server runtime boundary", async () => {
  const dbModule = await import("./persisted-bootstrap-db.mjs");
  assert.equal(typeof dbModule.beginSqlWs, "function");
});
