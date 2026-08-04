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
  const present = [row.tables_regclass, row.actions_regclass, row.hole_cards_regclass]
    .filter(Boolean).length;

  if (present > 0 && (present < 3 || row.has_human_participant !== true)) {
    throw new Error(
      "TEST_DB_URL has an incomplete poker cleanup schema; use a disposable database with current migrations"
    );
  }
  if (present === 3) return;

  await db.unsafe(`
    create table public.poker_tables (
      id uuid primary key,
      has_human_participant boolean not null default false
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

test("action-history cleanup executes hole-card and settlement SQL on PostgreSQL", { skip: !HAS_DB }, async () => {
  const db = await connect();
  let tableId = null;
  const regularHandId = `cleanup-regular-${randomUUID()}`;
  const activeHandId = `cleanup-active-${randomUUID()}`;
  const guardedHandId = `cleanup-guarded-${randomUUID()}`;
  const userId = randomUUID();
  const oldCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentCreatedAt = new Date().toISOString();
  let phaseTransactions = 0;

  try {
    await ensureSchema(db);
    tableId = randomUUID();
    await db.unsafe(
      "insert into public.poker_tables (id, has_human_participant) values ($1, false)",
      [tableId]
    );

    await db.unsafe(
      `insert into public.poker_actions (table_id, hand_id, action_type, created_at)
       values
         ($1, $2, 'CHECK', $3),
         ($1, $2, 'HAND_SETTLED', $3),
         ($1, $4, 'CHECK', $5),
         ($1, $6, 'HAND_SETTLED', $3)`,
      [tableId, regularHandId, oldCreatedAt, activeHandId, recentCreatedAt, guardedHandId]
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
        if (phaseTransactions === 1) {
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

    const second = await cleanup.sweep();
    assert.equal(second.ok, true);
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
    if (tableId) {
      await db.unsafe("delete from public.poker_hole_cards where table_id = $1", [tableId]);
      await db.unsafe("delete from public.poker_actions where table_id = $1", [tableId]);
      await db.unsafe("delete from public.poker_tables where id = $1", [tableId]);
    }
    if (createdMinimalSchema) {
      await db.unsafe("drop table if exists public.poker_hole_cards");
      await db.unsafe("drop table if exists public.poker_actions");
      await db.unsafe("drop table if exists public.poker_tables");
    }
    await db.end();
    sql = null;
  }
});
