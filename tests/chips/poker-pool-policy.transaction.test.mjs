import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const dbUrl = process.env.POKER_POLICY_TEST_DB_URL || "";
const allowNonTestDb = process.env.POKER_POLICY_ALLOW_NONTEST_DB === "1";
const sourcePath = path.join(process.cwd(), "shared", "poker-domain", "table-participation.mjs");

test("poker table slot queries keep bounded user-leading and creator-leading contracts", async () => {
  const source = await fs.readFile(sourcePath, "utf8");
  assert.match(source, /from public\.poker_seats s[\s\S]*where s\.user_id = \$1[\s\S]*limit \$\{boundedLimit\}/);
  assert.match(source, /from public\.poker_tables t[\s\S]*where t\.created_by = \$1[\s\S]*limit \$\{boundedLimit\}/);
  assert.match(source, /select distinct s\.table_id/);
  assert.match(source, /public\.poker_state ps[\s\S]*state -> 'seats'[\s\S]*state -> 'stacks'/);
  assert.match(source, /not exists \([\s\S]*public\.poker_seats/);
  assert.match(source, /not exists \([\s\S]*public\.chips_transactions/);
  assert.equal((source.match(/MAX_ACTIVE_POKER_TABLES = 4/g) || []).length, 1);
  assert.equal((source.match(/MAX_PENDING_POKER_TABLES = 4/g) || []).length, 1);
});

test("local PostgreSQL EXPLAIN confirms indexed bounded active and pending access paths", { skip: !dbUrl }, async () => {
  const sql = postgres(dbUrl, { max: 2 });
  try {
    const databaseRows = await sql`select current_database() as name;`;
    const databaseName = String(databaseRows?.[0]?.name || "");
    if (!allowNonTestDb) assert.match(databaseName, /(?:^|_)test$/i, "refusing EXPLAIN fixture outside a test database");

    const indexRows = await sql`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname in ('poker_seats_user_id_active_human_idx', 'poker_tables_created_by_pending_standard_idx', 'chips_transactions_poker_table_id_idx');
    `;
    const indexes = new Map(indexRows.map((row) => [row.indexname, row.indexdef]));
    assert.match(indexes.get("poker_seats_user_id_active_human_idx") || "", /\(user_id, table_id\)/i);
    assert.match(indexes.get("poker_tables_created_by_pending_standard_idx") || "", /\(created_by, id\)/i);
    assert.match(indexes.get("chips_transactions_poker_table_id_idx") || "", /metadata.*tableId/i);

    const activeExplain = await sql.unsafe(`
      explain (format json)
      select count(*)::int as count
      from (
        select distinct s.table_id
        from public.poker_seats s
        join public.poker_tables t on t.id = s.table_id
        where s.user_id = $1
          and s.status = 'ACTIVE'
          and coalesce(s.is_bot, false) = false
          and coalesce(s.stack, 0) > 0
          and upper(coalesce(t.status, 'OPEN')) not in ('CLOSED', 'TERMINAL')
        limit 5
      ) active_tables;
    `, ["00000000-0000-4000-8000-000000000001"]);
    const pendingExplain = await sql.unsafe(`
      explain (format json)
      select count(*)::int as count
      from (
        select t.id
        from public.poker_tables t
        where t.created_by = $1
          and t.status = 'OPEN'
          and t.lifecycle_kind = 'STANDARD'
          and t.has_human_participant = false
          and exists (
            select 1
            from public.poker_state ps
            where ps.table_id = t.id
              and ps.state -> 'seats' = '[]'::jsonb
              and ps.state -> 'stacks' = '{}'::jsonb
          )
          and not exists (select 1 from public.poker_seats s where s.table_id = t.id)
          and not exists (select 1 from public.chips_transactions ct where ct.metadata ->> 'tableId' = t.id::text)
        limit 5
      ) pending_tables;
    `, ["00000000-0000-4000-8000-000000000001"]);
    const activePlan = JSON.stringify(activeExplain?.[0]?.["QUERY PLAN"] || activeExplain);
    const pendingPlan = JSON.stringify(pendingExplain?.[0]?.["QUERY PLAN"] || pendingExplain);
    assert.match(activePlan, /poker_seats_user_id_active_human_idx|Index Scan|Bitmap Index Scan/i, "active count must expose an indexed user-leading path");
    assert.match(pendingPlan, /poker_tables_created_by_pending_standard_idx|Index Scan|Bitmap Index Scan/i, "pending count must expose an indexed creator-leading path");
  } finally {
    await sql.end({ timeout: 5 });
  }
});
