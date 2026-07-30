import test from "node:test";
import assert from "node:assert/strict";
import { createContinuousBotTableRepository } from "./continuous-bot-table-repository.mjs";

test("requestRetirement persists a due rotation for the exact managed table", async () => {
  const tableId = "00000000-0000-4000-8000-000000000807";
  const queries = [];
  const repository = createContinuousBotTableRepository({
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (run) => run({
      unsafe: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes("select id, rotation_due_at")) {
          return [{ id: tableId, rotation_due_at: null }];
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
  assert.equal(queries.some(({ sql }) => sql.includes("lifecycle_kind = 'CONTINUOUS_BOT'")), true);
  assert.equal(queries.some(({ sql }) => sql.includes("rotation_due_at = least")), true);
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
