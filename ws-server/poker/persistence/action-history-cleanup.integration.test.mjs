import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createActionHistoryCleanup } from "./action-history-cleanup.mjs";

// This test intentionally uses a disposable PostgreSQL database only. It is
// enabled by TEST_DB_URL in CI and is never pointed at a shared Supabase DB by
// the application itself.
const dbUrl = process.env.TEST_DB_URL;
const HAS_DB = Boolean(dbUrl);

let sql;
let createdMinimalSchema = false;

async function connect() {
  if (!HAS_DB) return null;
  const postgres = (await import("postgres")).default;
  sql = postgres(dbUrl, { max: 1, idle_timeout: 5 });
  return sql;
}

async function ensureSchema(db) {
  const rows = await db.unsafe(`
    select
      to_regclass('public.poker_tables') as tables_regclass,
      to_regclass('public.poker_state') as state_regclass,
      to_regclass('public.poker_actions') as actions_regclass,
      to_regclass('public.poker_hole_cards') as hole_cards_regclass,
      exists (
        select 1
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'poker_tables'
           and column_name = 'has_human_participant'
      ) as has_human_participant
  `);
  const row = rows[0];
  const present = [row.tables_regclass, row.state_regclass, row.actions_regclass, row.hole_cards_regclass]
    .filter(Boolean).length;

  if (present > 0 && (present < 4 || row.has_human_participant !== true)) {
    throw new Error(
      "TEST_DB_URL has an incomplete poker cleanup schema; use a disposable database with current migrations"
    );
  }
  if (present === 4) return;

  await db.unsafe(`
    create table public.poker_tables (
      id uuid primary key,
      status text not null default 'OPEN',
      has_human_participant boolean not null default false
    );
    create table public.poker_state (
      table_id uuid primary key,
      version bigint not null default 0,
      state jsonb not null default '{}'::jsonb
    );
    create table public.poker_actions (
      id bigserial primary key,
      table_id uuid not null,
      hand_id text,
      action_type text not null,
      created_at timestamptz not null default now()
    );
    create index poker_actions_table_id_hand_id_created_at_idx
      on public.poker_actions (table_id, hand_id, created_at);
    create table public.poker_hole_cards (
      table_id uuid not null,
      hand_id text not null,
      user_id uuid not null,
      cards jsonb not null,
      created_at timestamptz not null default now()
    );
    create index poker_hole_cards_table_hand_idx
      on public.poker_hole_cards (table_id, hand_id);
  `);
  createdMinimalSchema = true;
}

function beginSql(db, afterTransaction) {
  return async (fn) => {
    const result = await db.begin(async (tx) => fn({
      unsafe: (query, params) => tx.unsafe(query, params)
    }));
    await afterTransaction?.();
    return result;
  };
}

function earlySortedTableId() {
  return "00000000-0000-0000-0000-000000000000";
}

test("action-history cleanup executes hole-card and settlement SQL on PostgreSQL", { skip: !HAS_DB }, async () => {
  const db = await connect();
  let tableId = null;
  const cleanupTableIds = [];
  const regularHandId = `cleanup-regular-${randomUUID()}`;
  const orphanHandId = `cleanup-orphan-${randomUUID()}`;
  const activeHandId = `cleanup-active-${randomUUID()}`;
  const guardedHandId = `cleanup-guarded-${randomUUID()}`;
  const actionGuardedHandId = `cleanup-action-guarded-${randomUUID()}`;
  const userId = randomUUID();
  const oldCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentCreatedAt = new Date().toISOString();
  let phaseTransactions = 0;

  try {
    await ensureSchema(db);
    tableId = earlySortedTableId();
    cleanupTableIds.push(tableId);
    await db.unsafe(
      "insert into public.poker_tables (id, status, has_human_participant) values ($1, 'CLOSED', false)",
      [tableId]
    );
    await db.unsafe(
      "insert into public.poker_state (table_id, state) values ($1, $2::jsonb)",
      [tableId, JSON.stringify({ phase: "HAND_DONE", handId: "" })]
    );

    await db.unsafe(
      `insert into public.poker_actions (table_id, hand_id, action_type, created_at)
       values
         ($1, $2, 'CHECK', $3),
         ($1, $2, 'HAND_SETTLED', $3),
         ($1, $4, 'CHECK', $5),
         ($1, $6, 'HAND_SETTLED', $3),
         ($1, $7, 'CHECK', $3)`,
      [tableId, regularHandId, oldCreatedAt, activeHandId, recentCreatedAt, guardedHandId, actionGuardedHandId]
    );
    await db.unsafe(
      `insert into public.poker_hole_cards (table_id, hand_id, user_id, cards, created_at)
       values ($1, $2, $3, $4::jsonb, $5)`,
      [tableId, regularHandId, userId, JSON.stringify(["AS", "KD"]), oldCreatedAt]
    );
    await db.unsafe(
      `insert into public.poker_hole_cards (table_id, hand_id, user_id, cards, created_at)
       values ($1, $2, $3, $4::jsonb, $5)`,
      [tableId, activeHandId, userId, JSON.stringify(["QH", "JC"]), recentCreatedAt]
    );
    await db.unsafe(
      `insert into public.poker_hole_cards (table_id, hand_id, user_id, cards, created_at)
       values
         ($1, $2, $3, $4::jsonb, $5),
         ($1, $6, $3, $4::jsonb, $5)`,
      [tableId, orphanHandId, userId, JSON.stringify(["9H", "9C"]), oldCreatedAt, actionGuardedHandId]
    );

    const protectedCases = [
      { status: "OPEN", state: { phase: "HAND_DONE", handId: "" }, handId: `open-${randomUUID()}`, dates: [oldCreatedAt] },
      { status: "CLOSED", state: { phase: "FLOP", handId: `current-${randomUUID()}` }, current: true, dates: [oldCreatedAt] },
      { status: "CLOSED", state: null, handId: `missing-state-${randomUUID()}`, dates: [oldCreatedAt] },
      { status: "CLOSED", state: { phase: "HAND_DONE", handId: null }, handId: `invalid-state-${randomUUID()}`, dates: [oldCreatedAt] },
      { status: "CLOSED", state: { phase: "HAND_DONE", handId: "" }, handId: `mixed-age-${randomUUID()}`, dates: [oldCreatedAt, recentCreatedAt] }
    ];
    for (const protectedCase of protectedCases) {
      const protectedTableId = randomUUID();
      cleanupTableIds.push(protectedTableId);
      if (protectedCase.current) protectedCase.handId = protectedCase.state.handId;
      await db.unsafe(
        "insert into public.poker_tables (id, status, has_human_participant) values ($1, $2, false)",
        [protectedTableId, protectedCase.status]
      );
      if (protectedCase.state) {
        await db.unsafe(
          "insert into public.poker_state (table_id, state) values ($1, $2::jsonb)",
          [protectedTableId, JSON.stringify(protectedCase.state)]
        );
      }
      for (let index = 0; index < protectedCase.dates.length; index += 1) {
        await db.unsafe(
          `insert into public.poker_hole_cards (table_id, hand_id, user_id, cards, created_at)
           values ($1, $2, $3, $4::jsonb, $5)`,
          [protectedTableId, protectedCase.handId, randomUUID(), JSON.stringify(["4S", "5S"]), protectedCase.dates[index]]
        );
      }
    }

    const cleanup = createActionHistoryCleanup({
      maxSweepRounds: 1,
      env: {
        WS_POKER_BOT_ACTION_RETENTION_MS: String(60 * 60 * 1000),
        WS_POKER_BOT_SETTLED_RETENTION_MS: String(2 * 60 * 60 * 1000),
        WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
        WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
        WS_POKER_ACTION_HISTORY_BATCH_SIZE: "100"
      },
      beginSql: beginSql(db, async () => {
        phaseTransactions += 1;
        // The first transaction is the real hole-card phase. Add a card after
        // it commits so the real phase-2 SQL must preserve its HAND_SETTLED row.
        if (phaseTransactions === 2) {
          await db.unsafe(
            `insert into public.poker_hole_cards (table_id, hand_id, user_id, cards, created_at)
             values ($1, $2, $3, $4::jsonb, $5)`,
            [tableId, guardedHandId, userId, JSON.stringify(["2C", "3C"]), oldCreatedAt]
          );
        }
      })
    });

    const first = await cleanup.sweep();
    assert.equal(first.ok, true);
    const orphanAfterFirst = await db.unsafe(
      "select count(*)::bigint as rows from public.poker_hole_cards where table_id = $1 and hand_id = $2",
      [tableId, orphanHandId]
    );
    assert.equal(Number(orphanAfterFirst[0].rows), 0, `orphan cleanup result: ${JSON.stringify(first)}`);
    assert.equal(first.orphanHoleCardsDeleted, 1, `orphan cleanup result: ${JSON.stringify(first)}`);
    assert.equal(first.holeCardsDeleted, 1);
    assert.equal(first.phase1Deleted, 1);
    assert.equal(first.phase2Deleted, 1);

    const afterFirst = await db.unsafe(
      `select
         (select count(*) from public.poker_hole_cards where table_id = $1 and hand_id = $2) as guarded_cards,
         (select count(*) from public.poker_actions where table_id = $1 and hand_id = $2 and action_type = 'HAND_SETTLED') as guarded_marker,
         (select count(*) from public.poker_hole_cards where table_id = $1 and hand_id = $3) as active_cards,
         (select count(*) from public.poker_actions where table_id = $1 and hand_id = $3) as active_actions`,
      [tableId, guardedHandId, activeHandId]
    );
    assert.equal(Number(afterFirst[0].guarded_cards), 1, "phase 2 must not delete a marker with cards");
    assert.equal(Number(afterFirst[0].guarded_marker), 1, "HAND_SETTLED must remain for retry");
    assert.equal(Number(afterFirst[0].active_cards), 1, "active hand cards must remain");
    assert.equal(Number(afterFirst[0].active_actions), 1, "active hand actions must remain");
    const protectedCount = await db.unsafe(
      `select count(*)::bigint as rows
         from public.poker_hole_cards
        where table_id = any($1::uuid[])
          and hand_id <> $2`,
      [cleanupTableIds, orphanHandId]
    );
    assert.equal(Number(protectedCount[0].rows), 9, "open, current, malformed, fresh, mixed-age, and action-bearing hands must remain");

    const second = await cleanup.sweep();
    assert.equal(second.ok, true);
    assert.equal(second.orphanHoleCardsDeleted, 0);
    assert.equal(second.holeCardsDeleted, 1);
    assert.equal(second.phase1Deleted, 0);
    assert.equal(second.phase2Deleted, 1);

    const afterSecond = await db.unsafe(
      `select
         (select count(*) from public.poker_hole_cards where table_id = $1 and hand_id = $2) as guarded_cards,
         (select count(*) from public.poker_actions where table_id = $1 and hand_id = $2 and action_type = 'HAND_SETTLED') as guarded_marker,
         (select count(*) from public.poker_actions where table_id = $1 and hand_id = $3) as active_actions`,
      [tableId, guardedHandId, activeHandId]
    );
    assert.equal(Number(afterSecond[0].guarded_cards), 0, "next sweep should retry hole-card cleanup");
    assert.equal(Number(afterSecond[0].guarded_marker), 0, "marker should be removable after cards are gone");
    assert.equal(Number(afterSecond[0].active_actions), 1, "active hand must remain untouched");
  } finally {
    if (cleanupTableIds.length > 0) {
      await db.unsafe("delete from public.poker_hole_cards where table_id = any($1::uuid[])", [cleanupTableIds]);
      await db.unsafe("delete from public.poker_actions where table_id = any($1::uuid[])", [cleanupTableIds]);
      await db.unsafe("delete from public.poker_state where table_id = any($1::uuid[])", [cleanupTableIds]);
      await db.unsafe("delete from public.poker_tables where id = any($1::uuid[])", [cleanupTableIds]);
    }
    if (createdMinimalSchema) {
      await db.unsafe("drop table if exists public.poker_hole_cards");
      await db.unsafe("drop table if exists public.poker_actions");
      await db.unsafe("drop table if exists public.poker_state");
      await db.unsafe("drop table if exists public.poker_tables");
    }
    await db.end();
    sql = null;
  }
});

test("orphan cleanup skips a locked state and protects the hand committed as current", { skip: !HAS_DB }, async () => {
  const postgres = (await import("postgres")).default;
  const cleanupDb = postgres(dbUrl, { max: 1, idle_timeout: 5 });
  const writerDb = postgres(dbUrl, { max: 1, idle_timeout: 5 });
  const tableId = earlySortedTableId();
  const handId = `cleanup-concurrent-${randomUUID()}`;
  const oldCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let releaseWriter;
  let reportLocked;
  const writerRelease = new Promise((resolve) => { releaseWriter = resolve; });
  const stateLocked = new Promise((resolve) => { reportLocked = resolve; });

  try {
    await ensureSchema(cleanupDb);
    await cleanupDb.unsafe(
      "insert into public.poker_tables (id, status, has_human_participant) values ($1, 'CLOSED', false)",
      [tableId]
    );
    await cleanupDb.unsafe(
      "insert into public.poker_state (table_id, state) values ($1, $2::jsonb)",
      [tableId, JSON.stringify({ phase: "HAND_DONE", handId: "" })]
    );
    await cleanupDb.unsafe(
      `insert into public.poker_hole_cards (table_id, hand_id, user_id, cards, created_at)
       values ($1, $2, $3, $4::jsonb, $5)`,
      [tableId, handId, randomUUID(), JSON.stringify(["7H", "8H"]), oldCreatedAt]
    );

    const writer = writerDb.begin(async (tx) => {
      await tx.unsafe("select state from public.poker_state where table_id = $1 for update", [tableId]);
      reportLocked();
      await writerRelease;
      await tx.unsafe(
        "update public.poker_state set state = $2::jsonb where table_id = $1",
        [tableId, JSON.stringify({ phase: "FLOP", handId })]
      );
    });
    await stateLocked;

    const cleanup = createActionHistoryCleanup({
      env: {
        WS_POKER_BOT_ACTION_RETENTION_MS: String(60 * 60 * 1000),
        WS_POKER_BOT_SETTLED_RETENTION_MS: "0",
        WS_POKER_HUMAN_ACTION_RETENTION_MS: "0",
        WS_POKER_HUMAN_SETTLED_RETENTION_MS: "0",
        WS_POKER_ACTION_HISTORY_BATCH_SIZE: "10"
      },
      beginSql: beginSql(cleanupDb)
    });
    const startedAt = Date.now();
    const whileLocked = await cleanup.sweep();
    assert.equal(whileLocked.orphanHoleCardsDeleted, 0);
    assert.ok(Date.now() - startedAt < 1_500, "SKIP LOCKED must avoid waiting on the writer");

    releaseWriter();
    await writer;
    const afterCommit = await cleanup.sweep();
    assert.equal(afterCommit.orphanHoleCardsDeleted, 0);
    const remaining = await cleanupDb.unsafe(
      "select count(*)::bigint as rows from public.poker_hole_cards where table_id = $1 and hand_id = $2",
      [tableId, handId]
    );
    assert.equal(Number(remaining[0].rows), 1);
  } finally {
    releaseWriter?.();
    await cleanupDb.unsafe("delete from public.poker_hole_cards where table_id = $1", [tableId]);
    await cleanupDb.unsafe("delete from public.poker_actions where table_id = $1", [tableId]);
    await cleanupDb.unsafe("delete from public.poker_state where table_id = $1", [tableId]);
    await cleanupDb.unsafe("delete from public.poker_tables where id = $1", [tableId]);
    if (createdMinimalSchema) {
      await cleanupDb.unsafe("drop table if exists public.poker_hole_cards");
      await cleanupDb.unsafe("drop table if exists public.poker_actions");
      await cleanupDb.unsafe("drop table if exists public.poker_state");
      await cleanupDb.unsafe("drop table if exists public.poker_tables");
    }
    await Promise.all([cleanupDb.end(), writerDb.end()]);
  }
});
