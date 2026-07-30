import test from "node:test";
import assert from "node:assert/strict";

// PostgreSQL integration test for native JSONB migration.
// Requires SUPABASE_DB_URL or a local postgres:// URL in the environment.

const dbUrl = process.env.SUPABASE_DB_URL || process.env.TEST_DB_URL;
const HAS_DB = !!dbUrl;

async function getBeginSql() {
  if (!HAS_DB) return null;
  try {
    const postgres = (await import("postgres")).default;
    const sql = postgres(dbUrl, { max: 1, idle_timeout: 5 });
    return async (fn) => {
      return sql.begin(async (tx) => fn({ unsafe: (q, p) => tx.unsafe(q, p) }));
    };
  } catch {
    return null;
  }
}

const UUID = "00000000-0000-4000-8000-000000000810";
const TABLE_ID = "00000000-0000-4000-8000-000000000820";

async function setupTables(tx) {
  await tx.unsafe(`create table if not exists _test_poker_tables (
    id uuid primary key default gen_random_uuid(),
    status text not null default 'OPEN',
    created_at timestamptz not null default now()
  )`);
  await tx.unsafe(`create table if not exists _test_poker_actions (
    id bigserial primary key,
    table_id uuid not null references _test_poker_tables(id) on delete cascade,
    action_type text not null,
    meta jsonb,
    created_at timestamptz not null default now()
  )`);
  await tx.unsafe(`create table if not exists _test_poker_state (
    table_id uuid primary key references _test_poker_tables(id) on delete cascade,
    state jsonb not null default '{}'::jsonb,
    version bigint not null default 0
  )`);
  await tx.unsafe(`create table if not exists _test_poker_hole_cards (
    id bigserial primary key,
    table_id uuid not null references _test_poker_tables(id) on delete cascade,
    hand_id text not null,
    user_id uuid,
    cards jsonb
  )`);
  await tx.unsafe(`create table if not exists _test_poker_requests (
    id bigserial primary key,
    table_id uuid not null references _test_poker_tables(id) on delete cascade,
    user_id uuid not null,
    request_id text not null,
    kind text not null,
    result_json jsonb,
    payload_hash text
  )`);
}

async function cleanupTables(tx) {
  await tx.unsafe("drop table if exists _test_poker_requests, _test_poker_hole_cards, _test_poker_state, _test_poker_actions, _test_poker_tables cascade");
}

// ── Migration test ────────────────────────────────────────────────────

test("native JSONB integration", { skip: !HAS_DB }, async (t) => {
  const beginSql = await getBeginSql();
  if (!beginSql) { t.skip("no database"); return; }

  await beginSql(async (tx) => {
    await setupTables(tx);

    // 1. Insert legacy double-serialized strings
    await tx.unsafe("insert into _test_poker_tables (id) values ($1)", [UUID]);
    await tx.unsafe(
      "insert into _test_poker_actions (table_id, action_type, meta) values ($1, $2, $3::jsonb)",
      [UUID, "CHECK", JSON.stringify({ amount: 10, isBot: true })]
    );
    await tx.unsafe(
      "insert into _test_poker_state (table_id, state) values ($1, $2::jsonb)",
      [UUID, JSON.stringify({ phase: "PREFLOP", pot: 0 })]
    );
    await tx.unsafe(
      "insert into _test_poker_hole_cards (table_id, hand_id, user_id, cards) values ($1, $2, $3, $4::jsonb)",
      [UUID, "hand_1", "00000000-0000-4000-8000-000000000001", JSON.stringify(["Ah", "Kh"])]
    );
    await tx.unsafe(
      "insert into _test_poker_requests (table_id, user_id, request_id, kind, result_json, payload_hash) values ($1, $2, $3, $4, $5::jsonb, $6)",
      [UUID, "00000000-0000-4000-8000-000000000001", "req_1", "ACT", JSON.stringify({ version: 5 }), "abc123"]
    );

    // 2. Before migration: all four columns must be 'string'
    const before = await tx.unsafe(`
      select
        jsonb_typeof(meta)        as meta_type,
        jsonb_typeof(state)       as state_type,
        jsonb_typeof(cards)       as cards_type,
        jsonb_typeof(result_json) as result_json_type
      from _test_poker_actions a
      cross join _test_poker_state s
      cross join _test_poker_hole_cards h
      cross join _test_poker_requests r
      where a.table_id = $1 and s.table_id = $1 and h.table_id = $1 and r.table_id = $1
      limit 1
    `, [UUID]);
    const b = before[0];
    assert.equal(b.meta_type, "string");
    assert.equal(b.state_type, "string");
    assert.equal(b.cards_type, "string");
    assert.equal(b.result_json_type, "string");

    // 3. Run the migration (atomically)
    await tx.unsafe("update _test_poker_actions set meta = (meta #>> '{}')::jsonb where jsonb_typeof(meta) = 'string'");
    await tx.unsafe("update _test_poker_state set state = (state #>> '{}')::jsonb where jsonb_typeof(state) = 'string'");
    await tx.unsafe("update _test_poker_hole_cards set cards = (cards #>> '{}')::jsonb where jsonb_typeof(cards) = 'string'");
    await tx.unsafe("update _test_poker_requests set result_json = (result_json #>> '{}')::jsonb where jsonb_typeof(result_json) = 'string'");

    // 4. After migration: verify jsonb_typeof
    const after = await tx.unsafe(`
      select
        jsonb_typeof(meta)        as meta_type,
        jsonb_typeof(state)       as state_type,
        jsonb_typeof(cards)       as cards_type,
        jsonb_typeof(result_json) as result_json_type
      from _test_poker_actions a
      cross join _test_poker_state s
      cross join _test_poker_hole_cards h
      cross join _test_poker_requests r
      where a.table_id = $1 and s.table_id = $1 and h.table_id = $1 and r.table_id = $1
      limit 1
    `, [UUID]);
    const c = after[0];
    assert.equal(c.meta_type, "object", "meta must be object after migration");
    assert.equal(c.state_type, "object", "state must be object after migration");
    assert.equal(c.cards_type, "array", "cards must be array after migration");
    assert.equal(c.result_json_type, "object", "result_json must be object after migration");

    // 5. Verify JSONB operators work on migrated data
    const ops = await tx.unsafe(`
      select
        meta->>'amount'                  as meta_amount,
        state->>'phase'                  as state_phase,
        cards->0                         as first_card,
        result_json->>'version'          as result_version
      from _test_poker_actions a
      cross join _test_poker_state s
      cross join _test_poker_hole_cards h
      cross join _test_poker_requests r
      where a.table_id = $1 and s.table_id = $1 and h.table_id = $1 and r.table_id = $1
      limit 1
    `, [UUID]);
    assert.equal(ops[0].meta_amount, "10");
    assert.equal(ops[0].state_phase, "PREFLOP");
    assert.equal(ops[0].first_card, "Ah");
    assert.equal(ops[0].result_version, "5");

    // 6. Migration idempotency — re-run, nothing changes
    await tx.unsafe("update _test_poker_actions set meta = (meta #>> '{}')::jsonb where jsonb_typeof(meta) = 'string'");
    await tx.unsafe("update _test_poker_state set state = (state #>> '{}')::jsonb where jsonb_typeof(state) = 'string'");
    await tx.unsafe("update _test_poker_hole_cards set cards = (cards #>> '{}')::jsonb where jsonb_typeof(cards) = 'string'");
    await tx.unsafe("update _test_poker_requests set result_json = (result_json #>> '{}')::jsonb where jsonb_typeof(result_json) = 'string'");

    const after2 = await tx.unsafe(`
      select
        jsonb_typeof(meta)        as meta_type,
        jsonb_typeof(state)       as state_type,
        jsonb_typeof(cards)       as cards_type,
        jsonb_typeof(result_json) as result_json_type
      from _test_poker_actions a
      cross join _test_poker_state s
      cross join _test_poker_hole_cards h
      cross join _test_poker_requests r
      where a.table_id = $1 and s.table_id = $1 and h.table_id = $1 and r.table_id = $1
      limit 1
    `, [UUID]);
    assert.equal(after2[0].meta_type, "object");
    assert.equal(after2[0].state_type, "object");
    assert.equal(after2[0].cards_type, "array");
    assert.equal(after2[0].result_json_type, "object");

    // 7. Legacy string reads — simulate how readers handle both formats
    //    Pass a JSON-string value through the same read helpers used in production.
    const { parseResultJson } = await import(
      "../../netlify/functions/_shared/poker-idempotency.mjs"
    ).then(m => ({ parseResultJson: m.parseResultJson })).catch(() => ({ parseResultJson: null }));

    // Test legacy string read for result_json
    const stringJson = '{"version":5}';
    const parsed = parseResultJson(stringJson);
    assert.deepEqual(parsed, { version: 5 }, "parseResultJson handles legacy string");

    // Test native object read
    const native = parseResultJson({ version: 5 });
    assert.deepEqual(native, { version: 5 }, "parseResultJson handles native object");

    await cleanupTables(tx);
  });
});
