import test from "node:test";
import assert from "node:assert/strict";
import { createPokerTableWithState } from "../../../netlify/functions/_shared/poker-table-init.mjs";
import { createContinuousBotTableRepository } from "./continuous-bot-table-repository.mjs";

function enableAccountDeletion(t) {
  const previous = process.env.ACCOUNT_DELETION_ENABLED;
  process.env.ACCOUNT_DELETION_ENABLED = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.ACCOUNT_DELETION_ENABLED;
    else process.env.ACCOUNT_DELETION_ENABLED = previous;
  });
}

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
  let updateSql = "";
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    maxDesiredTables: 100,
    beginSql: async (run) => run({
      unsafe: async (sql, params) => {
        if (sql.includes("to_regclass")) return [{ available: false }];
        if (sql.includes("from public.poker_managed_table_profiles")) return [{ ...PROFILE }];
        if (sql.includes("update public.poker_managed_table_profiles")) {
          updateSql = sql;
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
  assert.equal(result.profile.minBotCount, 2);
  assert.equal(result.profile.targetBotCount, 3);
  assert.equal(result.profile.maxBotCount, 3);
  assert.deepEqual(updatedParams.slice(1, 4), [false, 10, "00000000-0000-4000-8000-000000000010"]);
  assert.doesNotMatch(updateSql, /min_bot_count\s*=/);
  assert.doesNotMatch(updateSql, /target_bot_count\s*=/);
  assert.doesNotMatch(updateSql, /max_bot_count\s*=/);
});

test("setDesiredState atomically persists an extended 1/1/1 bot profile", async () => {
  let updateCount = 0;
  let updatedParams = null;
  let updateSql = "";
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    maxDesiredTables: 2,
    beginSql: async (run) => run({
      unsafe: async (sql, params) => {
        if (sql.includes("to_regclass")) return [{ available: false }];
        if (sql.includes("from public.poker_managed_table_profiles")) return [{ ...PROFILE, desired_table_count: 0 }];
        if (sql.includes("update public.poker_managed_table_profiles")) {
          updateCount += 1;
          updateSql = sql;
          updatedParams = params;
          return [{
            ...PROFILE,
            enabled: true,
            desired_table_count: 1,
            min_bot_count: 1,
            target_bot_count: 1,
            max_bot_count: 1,
            updated_at: "2026-08-01T00:00:00.000Z"
          }];
        }
        return [];
      }
    })
  });

  const result = await repository.setDesiredState({
    enabled: true,
    desiredTableCount: 1,
    minBotCount: 1,
    targetBotCount: 1,
    maxBotCount: 1,
    updatedBy: "00000000-0000-4000-8000-000000000010"
  });

  assert.equal(result.ok, true);
  assert.equal(updateCount, 1);
  assert.match(updateSql, /min_bot_count\s*=\s*\$4/);
  assert.match(updateSql, /target_bot_count\s*=\s*\$5/);
  assert.match(updateSql, /max_bot_count\s*=\s*\$6/);
  assert.deepEqual(updatedParams, [
    "CONTINUOUS_BOT_DEFAULT",
    true,
    1,
    1,
    1,
    1,
    "00000000-0000-4000-8000-000000000010"
  ]);
  assert.equal(result.profile.minBotCount, 1);
  assert.equal(result.profile.targetBotCount, 1);
  assert.equal(result.profile.maxBotCount, 1);
});

test("setDesiredState rejects bot-count ordering before the profile UPDATE", async () => {
  let updateCount = 0;
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (run) => run({
      unsafe: async (sql) => {
        if (sql.includes("to_regclass")) return [{ available: false }];
        if (sql.includes("from public.poker_managed_table_profiles")) return [{ ...PROFILE }];
        if (sql.includes("update public.poker_managed_table_profiles")) updateCount += 1;
        return [];
      }
    })
  });

  const result = await repository.setDesiredState({
    enabled: true,
    desiredTableCount: 1,
    minBotCount: 2,
    targetBotCount: 1,
    maxBotCount: 1,
    updatedBy: "00000000-0000-4000-8000-000000000010"
  });

  assert.deepEqual(result, { ok: false, reason: "invalid_bot_count_order" });
  assert.equal(updateCount, 0);
});

test("setDesiredState rejects a desired-count jump larger than the ramp-up step", async () => {
  let updateCalled = false;
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    maxDesiredTables: 100,
    beginSql: async (run) => run({
      unsafe: async (sql) => {
        if (sql.includes("to_regclass")) return [{ available: false }];
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

test("reconcile creates at most two missing tables per sweep with Account Deletion enabled", async (t) => {
  enableAccountDeletion(t);
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
        if (sql.includes("to_regclass")) return [{ available: false }];
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

test("reconcile treats an enabled profile with disabled tier 100 as controlled inactive without table creation churn", async () => {
  const tableId = "00000000-0000-4000-8000-000000000825";
  let tableInserted = false;
  let transactionCommitted = false;
  let transactionRolledBack = false;
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db", POKER_BOTS_ENABLED: "1" },
    beginSql: async (run) => {
      const tx = {
        unsafe: async (sql) => {
          const normalizedSql = String(sql).toLowerCase();
          if (normalizedSql.includes("to_regclass")) return [{ available: true }];
          if (normalizedSql.includes("from public.poker_managed_table_profiles")) {
            return [{
              ...PROFILE,
              enabled: true,
              desired_table_count: 1,
              min_bot_count: 1,
              target_bot_count: 1,
              max_bot_count: 1
            }];
          }
          if (normalizedSql.includes("from public.poker_tables") && normalizedSql.includes("for update")) return [];
          if (normalizedSql.includes("insert into public.poker_tables")) {
            tableInserted = true;
            return [{ id: tableId }];
          }
          if (normalizedSql.includes("from public.poker_bot_tier_policy")) {
            return [{
              buy_in: 100,
              enabled: false,
              normal_refill_threshold_ch: 1,
              normal_refill_amount_ch: 1,
              slow_refill_threshold_ch: 1,
              slow_refill_amount_ch: 1,
              revision: 1
            }];
          }
          if (normalizedSql.includes("from public.chips_accounts") && normalizedSql.includes("system_key = any")) return [];
          if (normalizedSql.includes("insert into public.chips_accounts")) return [{ id: "escrow-id" }];
          if (normalizedSql.includes("select state from public.poker_state")) {
            return [{ state: { tableId, phase: "INIT", seats: [], stacks: {} } }];
          }
          if (normalizedSql.includes("update public.poker_state")) return [{ table_id: tableId }];
          return [];
        }
      };
      try {
        const result = await run(tx);
        transactionCommitted = true;
        return result;
      } catch (error) {
        transactionRolledBack = true;
        throw error;
      }
    }
  });

  const result = await repository.reconcile();

  assert.equal(tableInserted, false);
  assert.equal(transactionCommitted, true);
  assert.equal(transactionRolledBack, false);
  assert.equal(result.ok, true);
  assert.equal(result.controlledInactive, true);
  assert.equal(result.reason, "tier_disabled");
  assert.deepEqual(result.createdTableIds, []);

  // kolejne reconcile również nie generuje churnu
  const secondResult = await repository.reconcile();
  assert.equal(tableInserted, false);
  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.controlledInactive, true);
  assert.equal(secondResult.reason, "tier_disabled");
  assert.deepEqual(secondResult.createdTableIds, []);
});

test("reconcile retires an existing managed table below its minimum bot occupancy", async () => {
  const tableId = "00000000-0000-4000-8000-000000000826";
  let retirementUpdate = false;
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db", POKER_BOTS_ENABLED: "1" },
    beginSql: async (run) => run({
      unsafe: async (sql) => {
        const normalizedSql = String(sql).toLowerCase();
        if (normalizedSql.includes("to_regclass")) return [{ available: true }];
        if (normalizedSql.includes("from public.poker_managed_table_profiles")) {
          return [{ ...PROFILE, enabled: true, desired_table_count: 1, min_bot_count: 2, target_bot_count: 3, max_bot_count: 3 }];
        }
        if (normalizedSql.includes("from public.poker_tables") && normalizedSql.includes("for update")) {
          return [{
            id: tableId,
            status: "OPEN",
            max_players: 6,
            buy_in: 100,
            stakes: JSON.stringify({ sb: 1, bb: 2 }),
            managed_profile_key: "CONTINUOUS_BOT_DEFAULT",
            rotation_due_at: null,
            created_at: "2026-09-27T19:00:00.000Z",
            active_bot_count: 0
          }];
        }
        if (normalizedSql.includes("update public.poker_tables set rotation_due_at")) {
          retirementUpdate = true;
          return [{ id: tableId }];
        }
        return [];
      }
    })
  });
  const result = await repository.reconcile();
  assert.equal(result.ok, true);
  assert.deepEqual(result.retirementTableIds, [tableId]);
  assert.deepEqual(result.activeTableIds, []);
  assert.equal(retirementUpdate, true);
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
        if (sql.includes("to_regclass")) return [{ available: false }];
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

test("legacy catalog ENV cannot gate fixed canonical 100 CH continuous tables", async () => {
  let beginCalled = false;
  const repository = createContinuousBotTableRepository({
    env: {
      SUPABASE_DB_URL: "postgres://example.invalid/db",
      POKER_BOTS_ENABLED: "1",
      POKER_BUY_IN_TIERS_JSON: "[500,1000]"
    },
    beginSql: async (run) => {
      beginCalled = true;
      return run({ unsafe: async (sql) => sql.includes("to_regclass") ? [{ available: false }] : sql.includes("poker_managed_table_profiles") ? [{ ...PROFILE }] : [] });
    }
  });

  const result = await repository.reconcile();

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(beginCalled, true);
});

test("requestRetirement persists a due rotation for the exact managed table", async () => {
  const tableId = "00000000-0000-4000-8000-000000000807";
  const queries = [];
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (run) => run({
      unsafe: async (sql, params) => {
        if (sql.includes("to_regclass")) return [{ available: false }];
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
        if (sql.includes("to_regclass")) return [{ available: false }];
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
        if (sql.includes("to_regclass")) return [{ available: false }];
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
        if (sql.includes("to_regclass")) return [{ available: false }];
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
        if (sql.includes("to_regclass")) return [{ available: false }];
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
        if (sql.includes("to_regclass")) return [{ available: false }];
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

test("reconcile treats an enabled profile with unprovisioned tier 100 as controlled inactive with zero table INSERT", async () => {
  let tableInserted = false;
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db", POKER_BOTS_ENABLED: "1" },
    beginSql: async (run) => {
      const tx = {
        unsafe: async (sql) => {
          const normalizedSql = String(sql).toLowerCase();
          if (normalizedSql.includes("to_regclass")) return [{ available: true }];
          if (normalizedSql.includes("from public.poker_managed_table_profiles")) {
            return [{
              ...PROFILE,
              enabled: true,
              desired_table_count: 1,
              min_bot_count: 1,
              target_bot_count: 1,
              max_bot_count: 1
            }];
          }
          if (normalizedSql.includes("from public.poker_tables") && normalizedSql.includes("for update")) return [];
          if (normalizedSql.includes("from public.poker_bot_tier_policy")) {
            return [{
              buy_in: 100,
              enabled: true,
              normal_refill_threshold_ch: 1,
              normal_refill_amount_ch: 1,
              slow_refill_threshold_ch: 1,
              slow_refill_amount_ch: 1,
              revision: 1
            }];
          }
          // Provisioning check: only NORMAL is provisioned, SLOW is missing
          if (normalizedSql.includes("from public.chips_accounts") && normalizedSql.includes("system_key = any")) {
            return [{ system_key: "POKER_BOT_BANKROLL_100", status: "ACTIVE" }];
          }
          if (normalizedSql.includes("insert into public.poker_tables")) {
            tableInserted = true;
            return [{ id: "unwanted-table-id" }];
          }
          return [];
        }
      };
      return run(tx);
    }
  });

  const result = await repository.reconcile();

  assert.equal(tableInserted, false);
  assert.equal(result.ok, true);
  assert.equal(result.controlledInactive, true);
  assert.equal(result.reason, "tier_unprovisioned");
  assert.deepEqual(result.createdTableIds, []);
});


test("table creation limits the system-owner exception and retains human lifecycle fencing", async (t) => {
  enableAccountDeletion(t);
  const human = "00000000-0000-4000-8000-000000000901";
  const system = { userId: null, lifecycleKind: "CONTINUOUS_BOT", managedProfileKey: "CONTINUOUS_BOT_DEFAULT", isSinglePlayer: false };
  const options = { maxPlayers: 6, stakesJson: '{"sb":1,"bb":2}', buyIn: 100 };
  function fixture({ present = true, deleting = false } = {}) {
    const calls = [];
    const tx = { unsafe: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes("to_regclass")) return [{ available: true }];
      if (sql.includes("pending_tables")) return [{ count: 0 }];
      if (sql.includes("from auth.users")) return [{ present, deleting }];
      if (sql.includes("insert into public.poker_tables")) return [{ id: "00000000-0000-4000-8000-000000000902" }];
      if (sql.includes("insert into public.chips_accounts")) return [{ id: "escrow" }];
      return [];
    } };
    return { tx, calls };
  }
  await t.test("trusted managed system table creates only empty state and escrow, without a human lifecycle lookup", async () => {
    const { tx, calls } = fixture();
    await createPokerTableWithState(tx, { ...options, ...system });
    assert.equal(calls.length, 3);
    assert(calls[0].sql.includes("insert into public.poker_tables"));
    assert.equal(calls[0].params[3], null);
    assert.deepEqual(calls[1].params[1].stacks, {});
    assert.equal(calls[1].params[1].pot, 0);
    assert(calls[2].sql.includes("insert into public.chips_accounts"));
    assert(calls.every(c => !c.sql.includes("chips_entries") && !c.sql.includes("chips_transactions")));
  });
  for (const [name, override] of [
    ["STANDARD without owner", { lifecycleKind: "STANDARD" }],
    ["missing managed profile", { managedProfileKey: null }],
    ["unknown managed profile", { managedProfileKey: "OTHER" }],
    ["Single Player", { isSinglePlayer: true }],
    ["missing identity", { userId: undefined }],
    ["invalid identity", { userId: "not-a-uuid" }]
  ]) await t.test(name + " cannot bypass the human guard", async () => {
    const { tx, calls } = fixture();
    await assert.rejects(createPokerTableWithState(tx, { ...options, ...system, ...override }), { code: "invalid_identity" });
    assert(!calls.some(c => /insert into/i.test(c.sql)));
  });
  for (const single of [false, true]) await t.test((single ? "Single Player" : "STANDARD") + " human keeps slot→lifecycle lock→active check→INSERT order", async () => {
    const { tx, calls } = fixture();
    await createPokerTableWithState(tx, { ...options, userId: human, isSinglePlayer: single });
    const slot = calls.findIndex(c => c.params[0] === "poker-table-slots:v1:" + human);
    const fence = calls.findIndex(c => c.params[0] === "account-lifecycle:" + human);
    const check = calls.findIndex(c => c.sql.includes("from auth.users"));
    const insert = calls.findIndex(c => c.sql.includes("insert into public.poker_tables"));
    assert(slot >= 0 && slot < fence && fence < check && check < insert);
  });
  for (const [name, state, context] of [
    ["deleting STANDARD human", { deleting: true }, {}],
    ["deleting Single Player human", { deleting: true }, { isSinglePlayer: true }],
    ["missing human account", { present: false }, {}],
    ["managed metadata with a deleting human owner", { deleting: true }, system]
  ]) await t.test(name + " remains rejected before writes", async () => {
    const { tx, calls } = fixture(state);
    await assert.rejects(createPokerTableWithState(tx, { ...options, ...context, userId: human }), { code: "account_not_active" });
    assert(calls.some(c => c.params[0] === "account-lifecycle:" + human));
    assert(!calls.some(c => /insert into/i.test(c.sql)));
  });
});
