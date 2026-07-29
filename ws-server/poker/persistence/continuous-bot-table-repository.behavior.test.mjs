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
