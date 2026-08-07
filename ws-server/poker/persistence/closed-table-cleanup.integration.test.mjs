import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClosedTableCleanup } from "./closed-table-cleanup.mjs";

// This test intentionally uses a disposable PostgreSQL database only. It is
// enabled by TEST_DB_URL in CI and is never pointed at a shared Supabase DB by
// the application itself.
const dbUrl = process.env.TEST_DB_URL;
const HAS_DB = Boolean(dbUrl);

let sql;

async function connect() {
  if (!HAS_DB) return null;
  const postgres = (await import("postgres")).default;
  sql = postgres(dbUrl, { max: 1, idle_timeout: 5 });
  return sql;
}

async function ensureSchema(db) {
  // Add-missing, idempotent schema setup: this test may share the disposable
  // TEST_DB_URL database with the action-history cleanup integration test,
  // which already created poker_tables/poker_state/poker_actions/
  // poker_hole_cards in a minimal shape (without updated_at). ALTER ... ADD
  // COLUMN IF NOT EXISTS and CREATE ... IF NOT EXISTS make the schema complete
  // for the closed-table SQL regardless of what already exists.
  await db.unsafe(`
    do $$ begin
      create type public.chips_account_type as enum ('USER', 'SYSTEM', 'ESCROW');
    exception when duplicate_object then null;
    end $$;
    do $$ begin
      create type public.chips_account_status as enum ('active', 'frozen', 'closed');
    exception when duplicate_object then null;
    end $$;
    create table if not exists public.poker_tables (
      id uuid primary key,
      status text not null default 'OPEN',
      updated_at timestamptz not null default now()
    );
    alter table public.poker_tables
      add column if not exists updated_at timestamptz not null default now();
    create table if not exists public.poker_state (
      table_id uuid primary key,
      version bigint not null default 0,
      state jsonb not null default '{}'::jsonb
    );
    create table if not exists public.poker_actions (
      id bigserial primary key,
      table_id uuid not null,
      hand_id text,
      action_type text not null,
      created_at timestamptz not null default now()
    );
    create index if not exists poker_actions_table_id_created_at_idx
      on public.poker_actions (table_id, created_at);
    create table if not exists public.poker_hole_cards (
      table_id uuid not null,
      hand_id text not null,
      user_id uuid not null,
      cards jsonb not null,
      created_at timestamptz not null default now()
    );
    create index if not exists poker_hole_cards_table_hand_idx
      on public.poker_hole_cards (table_id, hand_id);
    create table if not exists public.poker_requests (
      table_id uuid not null references public.poker_tables (id) on delete cascade,
      user_id uuid not null,
      request_id text not null,
      kind text not null,
      result_json jsonb,
      created_at timestamptz not null default now(),
      unique (table_id, request_id)
    );
    create table if not exists public.chips_accounts (
      id uuid primary key default gen_random_uuid(),
      account_type public.chips_account_type not null,
      status public.chips_account_status not null default 'active',
      label text,
      system_key text,
      balance bigint not null default 0,
      next_entry_seq bigint not null default 1,
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now())
    );
  `);
  // Ensure poker_state cascades to poker_tables. The shared TEST_DB_URL may
  // already have a minimal poker_state created by the action-history cleanup
  // integration test without the FK; add it idempotently (table is empty at
  // this point because that test cleans up its fixtures in finally).
  await db.unsafe(`
    do $$ begin
      alter table public.poker_state
        add constraint poker_state_table_id_fkey
        foreign key (table_id) references public.poker_tables (id) on delete cascade;
    exception when duplicate_object then null;
    end $$;
  `);
}

function beginSql(db) {
  return async (fn) => db.begin(async (tx) => fn({
    unsafe: (query, params) => tx.unsafe(query, params)
  }));
}

const DAY = 86_400_000;
const RETENTION_MS = 7 * DAY;

function oldCutoff() {
  return new Date(Date.now() - RETENTION_MS).toISOString();
}

function oldDate() {
  return new Date(Date.now() - (RETENTION_MS + 60_000)).toISOString();
}

test("closed-table cleanup executes guarded DELETE on PostgreSQL", { skip: !HAS_DB }, async () => {
  const db = await connect();
  const cleanupTableIds = [];

  try {
    await ensureSchema(db);
    const cleanup = createClosedTableCleanup({
      maxSweepRounds: 1,
      env: {
        WS_POKER_CLOSED_TABLE_RETENTION_MS: String(RETENTION_MS),
        WS_POKER_CLOSED_TABLE_BATCH_SIZE: "100"
      },
      beginSql: beginSql(db)
    });

    // --- safe candidate: everything clean, escrow 0, no actions/cards/requests
    const safeTableId = randomUUID();
    cleanupTableIds.push(safeTableId);
    await db.unsafe(
      "insert into public.poker_tables (id, status, updated_at) values ($1, 'CLOSED', $2)",
      [safeTableId, oldDate()]
    );
    await db.unsafe(
      "insert into public.poker_state (table_id, state) values ($1, $2::jsonb)",
      [safeTableId, { phase: "HAND_DONE", handId: "" }]
    );
    await db.unsafe(
      "insert into public.chips_accounts (account_type, status, system_key, balance) values ('ESCROW', 'active', $1, 0)",
      [`POKER_TABLE:${safeTableId}`]
    );
    await db.unsafe(
      "insert into public.poker_requests (table_id, user_id, request_id, kind, result_json, created_at) values ($1, $2, $3, 'ACT', $4::jsonb, $5)",
      [safeTableId, randomUUID(), `req-${randomUUID()}`, JSON.stringify({ ok: true }), oldDate()]
    );

    // --- protected: OPEN table
    const openTableId = randomUUID();
    cleanupTableIds.push(openTableId);
    await db.unsafe(
      "insert into public.poker_tables (id, status, updated_at) values ($1, 'OPEN', $2)",
      [openTableId, oldDate()]
    );

    // --- protected: CLOSED with poker_actions
    const actionsTableId = randomUUID();
    cleanupTableIds.push(actionsTableId);
    await db.unsafe(
      "insert into public.poker_tables (id, status, updated_at) values ($1, 'CLOSED', $2)",
      [actionsTableId, oldDate()]
    );
    await db.unsafe(
      "insert into public.poker_state (table_id, state) values ($1, $2::jsonb)",
      [actionsTableId, { phase: "HAND_DONE", handId: "" }]
    );
    await db.unsafe(
      "insert into public.chips_accounts (account_type, status, system_key, balance) values ('ESCROW', 'active', $1, 0)",
      [`POKER_TABLE:${actionsTableId}`]
    );
    await db.unsafe(
      "insert into public.poker_actions (table_id, action_type, created_at) values ($1, 'CHECK', $2)",
      [actionsTableId, oldDate()]
    );

    // --- protected: CLOSED with escrow > 0
    const escrowTableId = randomUUID();
    cleanupTableIds.push(escrowTableId);
    await db.unsafe(
      "insert into public.poker_tables (id, status, updated_at) values ($1, 'CLOSED', $2)",
      [escrowTableId, oldDate()]
    );
    await db.unsafe(
      "insert into public.poker_state (table_id, state) values ($1, $2::jsonb)",
      [escrowTableId, { phase: "HAND_DONE", handId: "" }]
    );
    await db.unsafe(
      "insert into public.chips_accounts (account_type, status, system_key, balance) values ('ESCROW', 'active', $1, 250)",
      [`POKER_TABLE:${escrowTableId}`]
    );

    // --- protected: CLOSED with unfinished durable ACT
    const unfinishedActTableId = randomUUID();
    cleanupTableIds.push(unfinishedActTableId);
    await db.unsafe(
      "insert into public.poker_tables (id, status, updated_at) values ($1, 'CLOSED', $2)",
      [unfinishedActTableId, oldDate()]
    );
    await db.unsafe(
      "insert into public.poker_state (table_id, state) values ($1, $2::jsonb)",
      [unfinishedActTableId, { phase: "HAND_DONE", handId: "" }]
    );
    await db.unsafe(
      "insert into public.chips_accounts (account_type, status, system_key, balance) values ('ESCROW', 'active', $1, 0)",
      [`POKER_TABLE:${unfinishedActTableId}`]
    );
    await db.unsafe(
      "insert into public.poker_requests (table_id, user_id, request_id, kind, result_json, created_at) values ($1, $2, $3, 'ACT', null, $4)",
      [unfinishedActTableId, randomUUID(), `req-${randomUUID()}`, oldDate()]
    );

    // --- protected: CLOSED with fresh request (any kind, inside window)
    const freshRequestTableId = randomUUID();
    cleanupTableIds.push(freshRequestTableId);
    await db.unsafe(
      "insert into public.poker_tables (id, status, updated_at) values ($1, 'CLOSED', $2)",
      [freshRequestTableId, oldDate()]
    );
    await db.unsafe(
      "insert into public.poker_state (table_id, state) values ($1, $2::jsonb)",
      [freshRequestTableId, { phase: "HAND_DONE", handId: "" }]
    );
    await db.unsafe(
      "insert into public.chips_accounts (account_type, status, system_key, balance) values ('ESCROW', 'active', $1, 0)",
      [`POKER_TABLE:${freshRequestTableId}`]
    );
    await db.unsafe(
      "insert into public.poker_requests (table_id, user_id, request_id, kind, result_json) values ($1, $2, $3, 'LEAVE', $4::jsonb)",
      [freshRequestTableId, randomUUID(), `req-${randomUUID()}`, JSON.stringify({ ok: true })]
    );

    // --- protected: CLOSED with fresh updated_at (inside window)
    const freshTableId = randomUUID();
    cleanupTableIds.push(freshTableId);
    await db.unsafe(
      "insert into public.poker_tables (id, status) values ($1, 'CLOSED')",
      [freshTableId]
    );
    await db.unsafe(
      "insert into public.poker_state (table_id, state) values ($1, $2::jsonb)",
      [freshTableId, { phase: "HAND_DONE", handId: "" }]
    );
    await db.unsafe(
      "insert into public.chips_accounts (account_type, status, system_key, balance) values ('ESCROW', 'active', $1, 0)",
      [`POKER_TABLE:${freshTableId}`]
    );

    // --- protected: CLOSED with non-terminal state
    const nonTerminalTableId = randomUUID();
    cleanupTableIds.push(nonTerminalTableId);
    await db.unsafe(
      "insert into public.poker_tables (id, status, updated_at) values ($1, 'CLOSED', $2)",
      [nonTerminalTableId, oldDate()]
    );
    await db.unsafe(
      "insert into public.poker_state (table_id, state) values ($1, $2::jsonb)",
      [nonTerminalTableId, { phase: "FLOP", handId: `hand-${randomUUID()}` }]
    );
    await db.unsafe(
      "insert into public.chips_accounts (account_type, status, system_key, balance) values ('ESCROW', 'active', $1, 0)",
      [`POKER_TABLE:${nonTerminalTableId}`]
    );

    // --- measure eligible CLOSED count before the sweep (functional proof)
    const eligibleBefore = await cleanup.readBacklog();
    assert.equal(eligibleBefore.available, true, JSON.stringify(eligibleBefore));
    assert.ok(eligibleBefore.eligibleTables >= 1, `expected >=1 eligible before sweep, got ${eligibleBefore.eligibleTables}`);

    const result = await cleanup.sweep({
      claimTableIds: (candidateIds) => ({ claimed: candidateIds, skipped: [] }),
      releaseTableIds: () => {}
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.deleted >= 1, `expected deleted >= 1, got ${result.deleted}`);

    // --- eligible count must decrease after the sweep
    const eligibleAfter = await cleanup.readBacklog();
    assert.equal(eligibleAfter.available, true, JSON.stringify(eligibleAfter));
    assert.ok(eligibleAfter.eligibleTables < eligibleBefore.eligibleTables,
      `expected eligible after < before (${eligibleBefore.eligibleTables}), got ${eligibleAfter.eligibleTables}`);

    const remaining = await db.unsafe(
      "select id from public.poker_tables where id = any($1::uuid[])",
      [cleanupTableIds]
    );
    const remainingIds = remaining.map((row) => row.id);

    // safe table is deleted along with cascade rows
    assert.ok(!remainingIds.includes(safeTableId), `safe table should be deleted: ${remainingIds}`);
    const safeState = await db.unsafe(
      "select count(*)::bigint as rows from public.poker_state where table_id = $1",
      [safeTableId]
    );
    const safeRequests = await db.unsafe(
      "select count(*)::bigint as rows from public.poker_requests where table_id = $1",
      [safeTableId]
    );
    assert.equal(Number(safeState[0].rows), 0, "poker_state should cascade");
    assert.equal(Number(safeRequests[0].rows), 0, "poker_requests should cascade");

    // all protected cases remain
    for (const protectedId of [openTableId, actionsTableId, escrowTableId,
      unfinishedActTableId, freshRequestTableId, freshTableId, nonTerminalTableId]) {
      assert.ok(remainingIds.includes(protectedId), `protected table ${protectedId} should remain`);
    }
  } finally {
    if (sql && cleanupTableIds.length > 0) {
      try {
        await sql`delete from public.poker_tables where id = any(${sql(cleanupTableIds)})`;
      } catch { /* ignore cleanup failure */ }
    }
    await sql?.end();
  }
});
