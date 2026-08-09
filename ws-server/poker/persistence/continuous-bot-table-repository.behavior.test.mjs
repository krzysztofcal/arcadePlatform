import test from "node:test";
import assert from "node:assert/strict";
import { createContinuousBotTableRepository } from "./continuous-bot-table-repository.mjs";

const PROFILE = {
  profile_key: "CONTINUOUS_BOT_DEFAULT",
  enabled: false,
  desired_table_count: 2,
  min_bot_count: 2,
  target_bot_count: 3,
  max_bot_count: 3,
  rotation_interval_seconds: 900,
  postpone_interval_seconds: 300,
  small_blind: 1,
  big_blind: 2,
  max_seats: 6
};

test("setDesiredState persists a bounded profile and keeps configured desired count while disabled", async () => {
  let updatedParams = null;
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    maxDesiredTables: 100,
    beginSql: async (run) => run({
      unsafe: async (sql, params) => {
        if (sql.includes("from public.poker_managed_table_profiles")) return [{ ...PROFILE }];
        if (sql.includes("update public.poker_managed_table_profiles")) {
          updatedParams = params;
          return [{ ...PROFILE, desired_table_count: 10, updated_at: "2026-08-01T00:00:00.000Z" }];
        }
        return [];
      }
    })
  });

  const result = await repository.setDesiredState({
    enabled: false,
    desiredTableCount: 10,
    updatedBy: "00000000-0000-4000-8000-000000000010"
  });

  assert.equal(result.ok, true);
  assert.equal(result.profile.enabled, false);
  assert.equal(result.profile.desiredTableCount, 10);
  assert.deepEqual(updatedParams.slice(1, 4), [false, 10, "00000000-0000-4000-8000-000000000010"]);
});

test("setDesiredState rejects a desired-count jump larger than the ramp-up step", async () => {
  let updateCalled = false;
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    maxDesiredTables: 100,
    beginSql: async (run) => run({
      unsafe: async (sql) => {
        if (sql.includes("from public.poker_managed_table_profiles")) return [{ ...PROFILE }];
        if (sql.includes("update public.poker_managed_table_profiles")) updateCalled = true;
        return [];
      }
    })
  });

  const result = await repository.setDesiredState({
    enabled: true,
    desiredTableCount: 13,
    updatedBy: "00000000-0000-4000-8000-000000000010"
  });

  assert.deepEqual(result, { ok: false, reason: "invalid_desired_table_count_step" });
  assert.equal(updateCalled, false);
});

test("reconcile creates at most two missing tables per sweep", async () => {
  const createdTableIds = [
    "00000000-0000-4000-8000-000000000821",
    "00000000-0000-4000-8000-000000000822"
  ];
  let createIndex = 0;
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db", POKER_BOTS_ENABLED: "1" },
    maxDesiredTables: 100,
    beginSql: async (run) => run({
      unsafe: async (sql) => {
        if (sql.includes("from public.poker_managed_table_profiles")) {
          return [{ ...PROFILE, enabled: true, desired_table_count: 100, min_bot_count: 0, target_bot_count: 0, max_bot_count: 0 }];
        }
        if (sql.includes("from public.poker_tables") && sql.includes("for update")) return [];
        if (sql.includes("insert into public.poker_tables")) return [{ id: createdTableIds[createIndex++] }];
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc")) return [];
        if (sql.includes("select state from public.poker_state")) return [{ state: { tableId: createdTableIds[createIndex - 1], phase: "INIT", seats: [], stacks: {} } }];
        if (sql.includes("update public.poker_state")) return [{ table_id: createdTableIds[createIndex - 1] }];
        if (sql.includes("insert into public.chips_accounts")) return [{ id: "escrow-id" }];
        return [];
      }
    })
  });

  const result = await repository.reconcile();

  assert.equal(result.ok, true);
  assert.deepEqual(result.createdTableIds, createdTableIds);
  assert.equal(result.creationLimitPerReconcile, 2);
  assert.equal(result.creationLimited, true);
  assert.equal(result.remainingTableCount, 98);
});

test("preview profile with desired count five creates canonical 100 CH tables", async () => {
  const tableIds = [
    "00000000-0000-4000-8000-000000000823",
    "00000000-0000-4000-8000-000000000824"
  ];
  let createIndex = 0;
  let tableInsertParams = null;
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db", POKER_BOTS_ENABLED: "1" },
    maxDesiredTables: 100,
    beginSql: async (run) => run({
      unsafe: async (sql, params) => {
        if (sql.includes("from public.poker_managed_table_profiles")) {
          return [{ ...PROFILE, enabled: true, desired_table_count: 5, min_bot_count: 0, target_bot_count: 0, max_bot_count: 0 }];
        }
        if (sql.includes("from public.poker_tables") && sql.includes("for update")) return [];
        if (sql.includes("insert into public.poker_tables")) {
          tableInsertParams = params;
          return [{ id: tableIds[createIndex++] }];
        }
        if (sql.includes("select state from public.poker_state")) return [{ state: { tableId: tableIds[createIndex - 1], phase: "INIT", seats: [], stacks: {} } }];
        if (sql.includes("update public.poker_state")) return [{ table_id: tableIds[createIndex - 1] }];
        if (sql.includes("insert into public.chips_accounts")) return [{ id: "escrow-id" }];
        return [];
      }
    })
  });

  const result = await repository.reconcile();

  assert.equal(result.ok, true);
  assert.equal(result.profile.desiredTableCount, 5);
  assert.deepEqual(result.createdTableIds, tableIds);
  assert.equal(tableInsertParams?.[1], 100);
  assert.deepEqual(JSON.parse(tableInsertParams?.[0]), { sb: 1, bb: 2 });
});

test("reconcile rejects a buy-in catalog that cannot serve fixed 100 CH continuous tables", async () => {
  let beginCalled = false;
  const repository = createContinuousBotTableRepository({
    env: {
      SUPABASE_DB_URL: "postgres://example.invalid/db",
      POKER_BOTS_ENABLED: "1",
      POKER_BUY_IN_TIERS_JSON: "[500,1000]"
    },
    beginSql: async (run) => {
      beginCalled = true;
      return run({ unsafe: async () => [] });
    }
  });

  const result = await repository.reconcile();

  assert.equal(result.ok, false);
  assert.equal(result.reason, "poker_buy_in_tiers_config_invalid");
  assert.equal(beginCalled, false);
});

test("requestRetirement persists a due rotation for the exact managed table", async () => {
  const tableId = "00000000-0000-4000-8000-000000000807";
  const queries = [];
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (run) => run({
      unsafe: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes("select id, status, lifecycle_kind, managed_profile_key, rotation_due_at")) {
          return [{
            id: tableId,
            status: "OPEN",
            lifecycle_kind: "CONTINUOUS_BOT",
            managed_profile_key: "CONTINUOUS_BOT_DEFAULT",
            rotation_due_at: null
          }];
        }
        if (sql.includes("update public.poker_tables")) {
          return [{ id: tableId, rotation_due_at: "2026-07-29T15:00:00.000Z" }];
        }
        return [];
      }
    })
  });

  const result = await repository.requestRetirement(tableId);

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(queries.some(({ sql }) => sql.includes("pg_advisory_xact_lock")), true);
  assert.equal(queries.some(({ sql }) => sql.includes("lifecycle_kind")), true);
  assert.equal(queries.some(({ sql }) => sql.includes("rotation_due_at = least")), true);
});

test("readStatus limits maintenance status to open continuous tables", async () => {
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (run) => run({
      unsafe: async (sql) => {
        if (sql.includes("from public.poker_managed_table_profiles")) return [{ ...PROFILE, enabled: true }];
        if (sql.includes("from public.poker_tables")) {
          assert.match(sql, /where status = 'OPEN'/);
          assert.match(sql, /lifecycle_kind = 'CONTINUOUS_BOT'/);
          return [{ id: "00000000-0000-4000-8000-000000000810", status: "OPEN" }];
        }
        return [];
      }
    })
  });

  const result = await repository.readStatus();
  assert.equal(result.ok, true);
  assert.deepEqual(result.tables.map((table) => table.tableId), ["00000000-0000-4000-8000-000000000810"]);
});

test("reconcile schedules a missing rotation deadline from the table creation time", async () => {
  const tableId = "00000000-0000-4000-8000-000000000808";
  const queries = [];
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db", POKER_BOTS_ENABLED: "1" },
    beginSql: async (run) => run({
      unsafe: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes("from public.poker_managed_table_profiles")) {
          return [{
            profile_key: "CONTINUOUS_BOT_DEFAULT",
            enabled: true,
            desired_table_count: 1,
            min_bot_count: 2,
            target_bot_count: 3,
            max_bot_count: 3,
            rotation_interval_seconds: 900,
            postpone_interval_seconds: 300,
            small_blind: 1,
            big_blind: 2,
            max_seats: 6
          }];
        }
        if (sql.includes("from public.poker_tables") && sql.includes("for update")) {
          return [{
            id: tableId,
            status: "OPEN",
            max_players: 6,
            stakes: "{\"sb\":1,\"bb\":2}",
            managed_profile_key: "CONTINUOUS_BOT_DEFAULT",
            rotation_due_at: null,
            created_at: "2026-07-29T12:00:00.000Z"
          }];
        }
        if (sql.includes("set rotation_due_at = $2")) {
          return [{ id: tableId, rotation_due_at: "2026-07-29T12:15:00.000Z" }];
        }
        return [];
      }
    })
  });

  const result = await repository.reconcile();

  assert.equal(result.ok, true);
  assert.deepEqual(result.rotationScheduledTableIds, [tableId]);
  assert.equal(result.rotationDueAtByTableId[tableId], "2026-07-29T12:15:00.000Z");
  assert.equal(queries.some(({ sql }) => sql.includes("rotation_due_at is null")), true);
});

test("postponeRotation extends only an already-due managed table", async () => {
  const tableId = "00000000-0000-4000-8000-000000000809";
  const queries = [];
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (run) => run({
      unsafe: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes("set rotation_due_at = $2") && sql.includes("rotation_due_at <= now()")) {
          return [{ id: tableId, rotation_due_at: "2026-07-29T15:05:00.000Z" }];
        }
        return [];
      }
    })
  });

  const result = await repository.postponeRotation(tableId, "2026-07-29T15:05:00.000Z");

  assert.deepEqual(result, {
    ok: true,
    changed: true,
    rotationDueAt: "2026-07-29T15:05:00.000Z"
  });
  assert.equal(queries.some(({ sql }) => sql.includes("rotation_due_at <= now()")), true);
});

test("reconcile always returns rotationScheduledTableIds and rotationDueAtByTableId in its result shape", async () => {
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db", POKER_BOTS_ENABLED: "1" },
    beginSql: async (run) => run({
      unsafe: async (sql) => {
        if (sql.includes("from public.poker_managed_table_profiles")) {
          return [{
            profile_key: "CONTINUOUS_BOT_DEFAULT",
            enabled: true,
            desired_table_count: 0,
            min_bot_count: 2,
            target_bot_count: 3,
            max_bot_count: 3,
            rotation_interval_seconds: 900,
            postpone_interval_seconds: 300,
            small_blind: 1,
            big_blind: 2,
            max_seats: 6
          }];
        }
        if (sql.includes("from public.poker_tables") && sql.includes("for update")) {
          return [];
        }
        return [];
      }
    })
  });

  const result = await repository.reconcile();

  assert.equal(result.ok, true);
  assert.deepEqual(result.createdTableIds, []);
  assert.ok(Array.isArray(result.rotationScheduledTableIds), "rotationScheduledTableIds is present");
  assert.equal(typeof result.rotationDueAtByTableId, "object");
  assert.equal(result.rotationDueAtByTableId !== null, true);
});

test("reconcile includes a newly created table in rotationScheduledTableIds", async () => {
  const newTableId = "00000000-0000-4000-8000-000000000811";
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db", POKER_BOTS_ENABLED: "1" },
    beginSql: async (run) => run({
      unsafe: async (sql, params) => {
        if (sql.includes("from public.poker_managed_table_profiles")) {
          return [{
            profile_key: "CONTINUOUS_BOT_DEFAULT",
            enabled: true,
            desired_table_count: 1,
            min_bot_count: 0,
            target_bot_count: 0,
            max_bot_count: 0,
            rotation_interval_seconds: 900,
            postpone_interval_seconds: 300,
            small_blind: 1,
            big_blind: 2,
            max_seats: 6
          }];
        }
        if (sql.includes("from public.poker_tables") && sql.includes("for update")) {
          return [];
        }
        if (sql.includes("insert into public.poker_tables")) {
          return [{ id: newTableId }];
        }
        if (sql.includes("from public.poker_seats") && sql.includes("order by seat_no asc")) {
          return [];
        }
        if (sql.includes("select state from public.poker_state")) {
          return [{ state: { tableId: newTableId, phase: "INIT", seats: [], stacks: {} } }];
        }
        if (sql.includes("update public.poker_state")) {
          return [{ table_id: newTableId }];
        }
        if (sql.includes("insert into public.chips_accounts")) {
          return [{ id: "escrow-id" }];
        }
        return [];
      }
    })
  });

  const result = await repository.reconcile();

  assert.equal(result.ok, true);
  assert.deepEqual(result.createdTableIds, [newTableId]);
  assert.deepEqual(result.rotationScheduledTableIds, [newTableId]);
  assert.equal(typeof result.rotationDueAtByTableId[newTableId], "string");
  assert.ok(
    Number.isFinite(Date.parse(result.rotationDueAtByTableId[newTableId])),
    "rotationDueAtByTableId entry must be a valid ISO timestamp"
  );
});
