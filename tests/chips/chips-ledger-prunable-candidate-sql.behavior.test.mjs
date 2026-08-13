import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PRUNABLE_CANDIDATE_SQL } from "../../scripts/ops/chips-ledger-archive-export.mjs";

const CUTOFF = "2026-08-13T00:00:00.000000Z";
const PAYLOAD_HASH = "a".repeat(64);
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function uuid(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

async function createFixture() {
  const db = new PGlite();
  await db.exec(`
    create table public.chips_transactions (
      id uuid primary key,
      sequence bigint not null,
      tx_type text not null,
      idempotency_key text not null,
      payload_hash text not null,
      user_id uuid,
      reference text,
      description text,
      metadata jsonb not null default '{}'::jsonb,
      created_by uuid,
      created_at timestamptz not null
    );
    create table public.chips_accounts (
      id uuid primary key,
      user_id uuid,
      system_key text,
      account_type text not null,
      status text not null,
      balance bigint not null
    );
    create table public.chips_entries (
      id bigint primary key,
      transaction_id uuid not null references public.chips_transactions(id),
      account_id uuid not null references public.chips_accounts(id),
      entry_seq bigint not null,
      amount bigint not null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null
    );
    create table public.chips_transaction_idempotency (
      idempotency_key text primary key,
      transaction_id uuid not null,
      payload_hash text not null,
      tx_type text not null,
      user_id uuid,
      transaction_created_at timestamptz not null,
      archive_batch_id text
    );
    create table public.poker_tables (
      id uuid primary key,
      status text not null
    );
  `);
  return db;
}

async function insertCandidate(db, {
  number,
  txType = "TABLE_BUY_IN",
  createdAt,
  tableId = uuid(number + 1000),
  tableStatus = "CLOSED",
  escrowStatus = "active",
  escrowBalance = 0,
  userId = null,
  marker = "metadata",
  registry = "valid",
  entries = "valid",
  direction = "valid",
}) {
  const transactionId = uuid(number);
  const idempotencyKey = `fixture-${number}`;
  const systemAccountId = uuid(number + 10000);
  const escrowAccountId = uuid(number + 20000);
  const userAccountId = uuid(number + 30000);
  const systemAmount = txType === "TABLE_BUY_IN" ? -10 : 10;
  const escrowAmount = -systemAmount;
  const effectiveSystemAmount = direction === "wrong" ? -systemAmount : systemAmount;
  const effectiveEscrowAmount = direction === "wrong" ? -escrowAmount : escrowAmount;
  const metadata = marker === "missing"
    ? {}
    : marker === "invalid"
      ? { tableId: "not-a-uuid" }
      : { tableId };
  const reference = marker === "ambiguous" ? `table:${uuid(number + 40000)}` : null;

  await db.query("insert into public.poker_tables (id, status) values ($1, $2)", [tableId, tableStatus]);
  await db.query(
    `insert into public.chips_accounts (id, user_id, system_key, account_type, status, balance)
     values ($1, null, $2, 'SYSTEM', 'active', 0),
            ($3, null, $4, 'ESCROW', $5, $6)`,
    [systemAccountId, `SYSTEM_FIXTURE:${number}`, escrowAccountId, `POKER_TABLE:${tableId}`, escrowStatus, escrowBalance],
  );
  if (entries === "user") {
    await db.query(
      `insert into public.chips_accounts (id, user_id, system_key, account_type, status, balance)
       values ($1, $2, null, 'USER', 'active', 0)`,
      [userAccountId, USER_ID],
    );
  }
  await db.query(
    `insert into public.chips_transactions
      (id, sequence, tx_type, idempotency_key, payload_hash, user_id, reference, metadata, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [transactionId, number, txType, idempotencyKey, PAYLOAD_HASH, userId, reference, JSON.stringify(metadata), createdAt],
  );

  const entryRows = entries === "missing"
    ? [[systemAccountId, effectiveSystemAmount]]
    : entries === "conservation"
      ? [[systemAccountId, effectiveSystemAmount], [escrowAccountId, effectiveEscrowAmount - 1]]
      : entries === "user"
        ? [[systemAccountId, effectiveSystemAmount], [escrowAccountId, effectiveEscrowAmount], [userAccountId, 1]]
        : [[systemAccountId, effectiveSystemAmount], [escrowAccountId, effectiveEscrowAmount]];
  for (const [index, [accountId, amount]] of entryRows.entries()) {
    await db.query(
      `insert into public.chips_entries
        (id, transaction_id, account_id, entry_seq, amount, created_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [number * 10 + index + 1, transactionId, accountId, index + 1, amount, createdAt],
    );
  }

  if (registry !== "missing") {
    await db.query(
      `insert into public.chips_transaction_idempotency
        (idempotency_key, transaction_id, payload_hash, tx_type, user_id, transaction_created_at, archive_batch_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        idempotencyKey,
        transactionId,
        registry === "mismatched" ? "b".repeat(64) : PAYLOAD_HASH,
        txType,
        userId,
        createdAt,
        registry === "assigned" ? "batch-fixture" : null,
      ],
    );
  }
  return transactionId;
}

async function select(db, options = {}) {
  const result = await db.query(PRUNABLE_CANDIDATE_SQL, [
    options.cutoff || CUTOFF,
    options.limit || 5000,
    options.cursorCreatedAt || null,
    options.cursorId || null,
  ]);
  return result.rows;
}

const db = await createFixture();
try {
  const validBuyIn = await insertCandidate(db, {
    number: 1,
    createdAt: "2026-08-01T00:00:00.000000Z",
  });
  const validCashOut = await insertCandidate(db, {
    number: 2,
    txType: "TABLE_CASH_OUT",
    createdAt: "2026-08-02T00:00:00.000000Z",
  });
  const sameTimestampLow = await insertCandidate(db, {
    number: 3,
    createdAt: "2026-08-03T00:00:00.000000Z",
  });
  const sameTimestampHigh = await insertCandidate(db, {
    number: 4,
    createdAt: "2026-08-03T00:00:00.000000Z",
  });

  const rejected = [
    ["USER transaction", { number: 10, txType: "USER", userId: USER_ID, createdAt: "2026-08-04T00:00:00.000000Z" }],
    ["technical transaction with user_id", { number: 11, userId: USER_ID, createdAt: "2026-08-04T00:00:01.000000Z" }],
    ["mismatched registry", { number: 12, registry: "mismatched", createdAt: "2026-08-05T00:00:00.000000Z" }],
    ["missing registry", { number: 13, registry: "missing", createdAt: "2026-08-05T00:00:01.000000Z" }],
    ["assigned registry", { number: 14, registry: "assigned", createdAt: "2026-08-06T00:00:00.000000Z" }],
    ["ambiguous marker", { number: 15, marker: "ambiguous", createdAt: "2026-08-07T00:00:00.000000Z" }],
    ["invalid marker", { number: 16, marker: "invalid", createdAt: "2026-08-08T00:00:00.000000Z" }],
    ["open table", { number: 17, tableStatus: "OPEN", createdAt: "2026-08-09T00:00:00.000000Z" }],
    ["inactive escrow", { number: 18, escrowStatus: "frozen", createdAt: "2026-08-10T00:00:00.000000Z" }],
    ["non-zero escrow", { number: 19, escrowBalance: 1, createdAt: "2026-08-10T00:00:01.000000Z" }],
    ["invalid entries", { number: 20, entries: "missing", createdAt: "2026-08-11T00:00:00.000000Z" }],
    ["USER entry", { number: 21, entries: "user", createdAt: "2026-08-11T00:00:01.000000Z" }],
    ["non-conserved entries", { number: 22, entries: "conservation", createdAt: "2026-08-12T00:00:00.000000Z" }],
    ["wrong buy-in direction", { number: 23, direction: "wrong", createdAt: "2026-08-12T00:00:01.000000Z" }],
    ["wrong cash-out direction", { number: 24, txType: "TABLE_CASH_OUT", direction: "wrong", createdAt: "2026-08-12T00:00:02.000000Z" }],
  ];
  for (const [, fixture] of rejected) await insertCandidate(db, fixture);

  const rows = await select(db);
  assert.deepEqual(rows.map((row) => row.id), [validBuyIn, validCashOut, sameTimestampLow, sameTimestampHigh]);
  assert.deepEqual(rows.map((row) => row.tx_type), ["TABLE_BUY_IN", "TABLE_CASH_OUT", "TABLE_BUY_IN", "TABLE_BUY_IN"]);

  const limited = await select(db, { limit: 2 });
  assert.deepEqual(limited.map((row) => row.id), [validBuyIn, validCashOut]);

  const afterTieLow = await select(db, {
    cursorCreatedAt: "2026-08-03T00:00:00.000000Z",
    cursorId: sameTimestampLow,
  });
  assert.deepEqual(afterTieLow.map((row) => row.id), [sameTimestampHigh]);
} finally {
  await db.close();
}

process.stdout.write("chips-ledger-prunable-candidate-sql behavior passed\n");
