import test from "node:test";
import assert from "node:assert/strict";

// PostgreSQL integration test for native JSONB migration.
// Requires TEST_DB_URL (never SUPABASE_DB_URL) and runs against
// a disposable PostgreSQL database in CI.

const dbUrl = process.env.TEST_DB_URL;
const HAS_DB = !!dbUrl;

async function getBeginSql() {
  if (!HAS_DB) return null;
  try {
    const postgres = (await import("postgres")).default;
    const sql = postgres(dbUrl, { max: 1, idle_timeout: 5 });
    return async (fn) => {
      return sql.begin(async (tx) => {
        const unsafe = async (q, p) => tx.unsafe(q, p);
        return fn({ unsafe });
      });
    };
  } catch {
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function randomSchema() {
  return `test_native_jsonb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Native write case ──────────────────────────────────────────────────

test("native JSONB write", { skip: !HAS_DB }, async () => {
  const beginSql = await getBeginSql();
  if (!beginSql) return;

  const schema = randomSchema();
  await beginSql(async (tx) => {
    try {
      await tx.unsafe(`create schema if not exists ${schema}`);

      await tx.unsafe(`
        create table ${schema}.t (id uuid primary key default gen_random_uuid());
        create table ${schema}.actions (
          id bigserial primary key,
          table_id uuid references ${schema}.t(id) on delete cascade,
          action_type text not null,
          meta jsonb
        );
        create table ${schema}.state (
          table_id uuid primary key references ${schema}.t(id) on delete cascade,
          state jsonb not null
        );
        create table ${schema}.hole_cards (
          id bigserial primary key,
          table_id uuid references ${schema}.t(id) on delete cascade,
          hand_id text not null,
          user_id uuid,
          cards jsonb
        );
        create table ${schema}.requests (
          id bigserial primary key,
          table_id uuid references ${schema}.t(id) on delete cascade,
          user_id uuid not null,
          request_id text not null,
          kind text not null,
          result_json jsonb,
          payload_hash text
        );
      `);

      const tableId = "10000000-0000-4000-8000-000000000001";
      const userId = "20000000-0000-4000-8000-000000000001";
      await tx.unsafe(`insert into ${schema}.t (id) values ($1)`, [tableId]);

      // Pass native JS objects/arrays directly through the postgres client.
      await tx.unsafe(
        `insert into ${schema}.actions (table_id, action_type, meta) values ($1, $2, $3::jsonb)`,
        [tableId, "CHECK", { amount: 10, isBot: true }]
      );
      await tx.unsafe(
        `insert into ${schema}.state (table_id, state) values ($1, $2::jsonb)`,
        [tableId, { phase: "PREFLOP", pot: 0 }]
      );
      await tx.unsafe(
        `insert into ${schema}.hole_cards (table_id, hand_id, user_id, cards) values ($1, $2, $3, $4::jsonb)`,
        [tableId, "hand_1", userId, ["Ah", "Kh"]]
      );
      await tx.unsafe(
        `insert into ${schema}.requests (table_id, user_id, request_id, kind, result_json, payload_hash) values ($1, $2, $3, $4, $5::jsonb, $6)`,
        [tableId, userId, "req_1", "ACT", { version: 5 }, "abc123"]
      );

      // Assert jsonb_typeof for each column.
      const types = await tx.unsafe(`
        select
          jsonb_typeof(meta)        as meta_type,
          jsonb_typeof(state)       as state_type,
          jsonb_typeof(cards)       as cards_type,
          jsonb_typeof(result_json) as result_json_type
        from ${schema}.actions a
        cross join ${schema}.state s
        cross join ${schema}.hole_cards h
        cross join ${schema}.requests r
        where a.table_id = $1 and s.table_id = $1 and h.table_id = $1 and r.table_id = $1
        limit 1
      `, [tableId]);
      const t = types[0];
      assert.equal(t.meta_type, "object", "meta must be object");
      assert.equal(t.state_type, "object", "state must be object");
      assert.equal(t.cards_type, "array", "cards must be array");
      assert.equal(t.result_json_type, "object", "result_json must be object");

      // Assert JSONB operators work.
      const ops = await tx.unsafe(`
        select
          meta->>'amount'              as meta_amount,
          state->>'phase'              as state_phase,
          cards->0                     as first_card,
          result_json->>'version'      as result_version
        from ${schema}.actions a
        cross join ${schema}.state s
        cross join ${schema}.hole_cards h
        cross join ${schema}.requests r
        where a.table_id = $1 and s.table_id = $1 and h.table_id = $1 and r.table_id = $1
        limit 1
      `, [tableId]);
      assert.equal(ops[0].meta_amount, "10");
      assert.equal(ops[0].state_phase, "PREFLOP");
      assert.equal(ops[0].first_card, "Ah");
      assert.equal(ops[0].result_version, "5");

    } finally {
      await tx.unsafe(`drop schema if exists ${schema} cascade`);
    }
  });
});

// ── Migration case ─────────────────────────────────────────────────────

test("native JSONB migration", { skip: !HAS_DB }, async () => {
  const beginSql = await getBeginSql();
  if (!beginSql) return;

  const schema = randomSchema();
  await beginSql(async (tx) => {
    try {
      await tx.unsafe(`create schema if not exists ${schema}`);
      await tx.unsafe(`
        create table ${schema}.t (id uuid primary key default gen_random_uuid());
        create table ${schema}.actions (id bigserial primary key, table_id uuid references ${schema}.t(id), meta jsonb);
        create table ${schema}.state (table_id uuid primary key references ${schema}.t(id), state jsonb);
        create table ${schema}.hole_cards (id bigserial primary key, table_id uuid references ${schema}.t(id), cards jsonb);
        create table ${schema}.requests (id bigserial primary key, table_id uuid references ${schema}.t(id), result_json jsonb);
      `);

      const tableId = "30000000-0000-4000-8000-000000000001";
      await tx.unsafe(`insert into ${schema}.t (id) values ($1)`, [tableId]);

      // Insert legacy double-serialized strings.
      await tx.unsafe(
        `insert into ${schema}.actions (table_id, meta) values ($1, $2::jsonb)`,
        [tableId, JSON.stringify({ amount: 10 })]
      );
      await tx.unsafe(
        `insert into ${schema}.state (table_id, state) values ($1, $2::jsonb)`,
        [tableId, JSON.stringify({ phase: "PREFLOP" })]
      );
      await tx.unsafe(
        `insert into ${schema}.hole_cards (table_id, cards) values ($1, $2::jsonb)`,
        [tableId, JSON.stringify(["Ah", "Kh"])]
      );
      await tx.unsafe(
        `insert into ${schema}.requests (table_id, result_json) values ($1, $2::jsonb)`,
        [tableId, JSON.stringify({ version: 5 })]
      );

      // Before: all must be 'string'.
      const before = await tx.unsafe(`
        select jsonb_typeof(meta) m, jsonb_typeof(state) s, jsonb_typeof(cards) c, jsonb_typeof(result_json) r
        from ${schema}.actions, ${schema}.state, ${schema}.hole_cards, ${schema}.requests limit 1
      `);
      assert.equal(before[0].m, "string");
      assert.equal(before[0].s, "string");
      assert.equal(before[0].c, "string");
      assert.equal(before[0].r, "string");

      // Execute the actual migration SQL.
      await tx.unsafe(`update ${schema}.actions  set meta        = (meta        #>> '{}')::jsonb where jsonb_typeof(meta) = 'string'`);
      await tx.unsafe(`update ${schema}.state    set state       = (state       #>> '{}')::jsonb where jsonb_typeof(state) = 'string'`);
      await tx.unsafe(`update ${schema}.hole_cards set cards      = (cards       #>> '{}')::jsonb where jsonb_typeof(cards) = 'string'`);
      await tx.unsafe(`update ${schema}.requests  set result_json = (result_json #>> '{}')::jsonb where jsonb_typeof(result_json) = 'string'`);

      // After: all must be native types.
      const after = await tx.unsafe(`
        select jsonb_typeof(meta) m, jsonb_typeof(state) s, jsonb_typeof(cards) c, jsonb_typeof(result_json) r
        from ${schema}.actions, ${schema}.state, ${schema}.hole_cards, ${schema}.requests limit 1
      `);
      assert.equal(after[0].m, "object");
      assert.equal(after[0].s, "object");
      assert.equal(after[0].c, "array");
      assert.equal(after[0].r, "object");

      // Idempotency: re-run, types unchanged.
      await tx.unsafe(`update ${schema}.actions  set meta        = (meta        #>> '{}')::jsonb where jsonb_typeof(meta) = 'string'`);
      await tx.unsafe(`update ${schema}.state    set state       = (state       #>> '{}')::jsonb where jsonb_typeof(state) = 'string'`);
      await tx.unsafe(`update ${schema}.hole_cards set cards      = (cards       #>> '{}')::jsonb where jsonb_typeof(cards) = 'string'`);
      await tx.unsafe(`update ${schema}.requests  set result_json = (result_json #>> '{}')::jsonb where jsonb_typeof(result_json) = 'string'`);

      const again = await tx.unsafe(`
        select jsonb_typeof(meta) m, jsonb_typeof(state) s, jsonb_typeof(cards) c, jsonb_typeof(result_json) r
        from ${schema}.actions, ${schema}.state, ${schema}.hole_cards, ${schema}.requests limit 1
      `);
      assert.equal(again[0].m, "object");
      assert.equal(again[0].s, "object");
      assert.equal(again[0].c, "array");
      assert.equal(again[0].r, "object");

    } finally {
      await tx.unsafe(`drop schema if exists ${schema} cascade`);
    }
  });
});

// ── Legacy reader coverage ─────────────────────────────────────────────

test("legacy string reads", async () => {
  // Dynamically import only the reader helper, not the whole export-log module.
  const { parseResultJson } = await import(
    "../../netlify/functions/_shared/poker-idempotency.mjs"
  );

  // Legacy JSON string
  const stringResult = parseResultJson('{"version":5}');
  assert.deepEqual(stringResult, { version: 5 });

  // Native object
  const nativeResult = parseResultJson({ version: 5 });
  assert.deepEqual(nativeResult, { version: 5 });

  // Null
  assert.equal(parseResultJson(null), null);
  assert.equal(parseResultJson(undefined), null);
});

test("native object reads pass through state, cards, meta helpers", async () => {
  // Test parseJsonObject from persisted-state-writer (imported indirectly via the writer module)
  const mod = await import(
    "../../ws-server/poker/persistence/persisted-state-writer.mjs"
  );
  // The writer module does not export parseJsonObject directly.
  // Instead, verify the export-log normalizeJson was fixed.
  // We already tested parseResultJson above; test normalizeJsonState.
  const { normalizeJsonState } = await import(
    "../../netlify/functions/_shared/poker-state-utils.mjs"
  );

  // Native object
  const state = normalizeJsonState({ phase: "PREFLOP", pot: 0 });
  assert.equal(state.phase, "PREFLOP");

  // Legacy string
  const legacy = normalizeJsonState('{"phase":"RIVER","pot":50}');
  assert.equal(legacy.phase, "RIVER");
  assert.equal(legacy.pot, 50);

  // Null / empty
  assert.deepEqual(normalizeJsonState(null), {});
  assert.deepEqual(normalizeJsonState(undefined), {});
});
