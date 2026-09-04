import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { CLOSED_HUMAN_TABLE_CANDIDATE_SQL } from "../../scripts/ops/chips-ledger-archive-export.mjs";

const CUTOFF = "2026-08-13T00:00:00.000000Z";
const PAYLOAD_HASH = "a".repeat(64);
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function uuid(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

async function createFixture() {
  const db = new PGlite();
  await db.exec(`
    create type public.chips_tx_type as enum (
      'MINT', 'BUY_IN', 'CASH_OUT', 'TABLE_BUY_IN', 'TABLE_CASH_OUT', 'ADMIN_ADJUST'
    );
    create table public.poker_tables (
      id uuid primary key,
      status text not null,
      has_human_participant boolean not null default false
    );
    create table public.chips_accounts (
      id uuid primary key,
      user_id uuid,
      system_key text,
      account_type text not null,
      status text not null,
      balance bigint not null
    );
    create table public.poker_state (
      table_id uuid primary key,
      state jsonb not null
    );
    create table public.poker_requests (
      id bigint primary key,
      table_id uuid not null,
      result_json jsonb
    );
    create table public.chips_transactions (
      id uuid primary key,
      sequence bigint not null,
      tx_type public.chips_tx_type not null,
      idempotency_key text not null,
      payload_hash text not null,
      user_id uuid,
      reference text,
      description text,
      metadata jsonb not null default '{}'::jsonb,
      created_by uuid,
      created_at timestamptz not null
    );
    create table public.chips_transaction_idempotency (
      idempotency_key text primary key,
      transaction_id uuid not null,
      payload_hash text not null,
      tx_type public.chips_tx_type not null,
      user_id uuid,
      transaction_created_at timestamptz not null,
      archive_batch_id text,
      table_id uuid not null
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
  `);
  return db;
}

async function insertHumanTable(db, {
  tableId,
  status = "CLOSED",
  hasHumanParticipant = true,
  escrowStatus = "active",
  escrowBalance = 0,
  phase = "HAND_DONE",
  handId = "",
  pendingRequest = false,
  requestId = 1,
  userId = USER_ID,
}) {
  const tableNumber = Number(tableId.replace(/\D/g, "").slice(-12));
  const escrowAccountId = uuid(tableNumber + 20000);
  const userAccountId = uuid(tableNumber + 30000);
  const systemAccountId = uuid(tableNumber + 40000);

  await db.query(
    `insert into public.poker_tables (id, status, has_human_participant)
     values ($1, $2, $3)`,
    [tableId, status, hasHumanParticipant],
  );
  await db.query(
    `insert into public.chips_accounts (id, user_id, system_key, account_type, status, balance)
     values ($1, null, $2, 'ESCROW', $3, $4)`,
    [escrowAccountId, `POKER_TABLE:${tableId}`, escrowStatus, escrowBalance],
  );
  if (userId) {
    await db.query(
      `insert into public.chips_accounts (id, user_id, system_key, account_type, status, balance)
       values ($1, $2, null, 'USER', 'active', 0)`,
      [userAccountId, userId],
    );
  } else {
    await db.query(
      `insert into public.chips_accounts (id, user_id, system_key, account_type, status, balance)
       values ($1, null, $2, 'SYSTEM', 'active', 0)`,
      [systemAccountId, `SYSTEM_FIXTURE:${tableNumber}`],
    );
  }
  await db.query(
    `insert into public.poker_state (table_id, state)
     values ($1, $2::jsonb)`,
    [tableId, JSON.stringify({ phase, handId })],
  );
  if (pendingRequest) {
    await db.query(
      `insert into public.poker_requests (id, table_id, result_json)
       values ($1, $2, null)`,
      [requestId, tableId],
    );
  }
}

async function insertTransaction(db, {
  tableId,
  number,
  txType,
  createdAt,
  userId = null,
  archiveBatchId = null,
  validEntries = true,
}) {
  const transactionId = uuid(number);
  const idempotencyKey = `human-fixture-${number}`;
  const tableNumber = Number(tableId.replace(/\D/g, "").slice(-12));
  const escrowAccountId = uuid(tableNumber + 20000);
  const userAccountId = uuid(tableNumber + 30000);
  const systemAccountId = uuid(tableNumber + 40000);
  const partnerAccountId = userId ? userAccountId : systemAccountId;

  await db.query(
    `insert into public.chips_transactions
      (id, sequence, tx_type, idempotency_key, payload_hash, user_id, reference, metadata, created_at)
     values ($1, $2, $3::public.chips_tx_type, $4, $5, $6, null, $7::jsonb, $8)`,
    [
      transactionId,
      number,
      txType,
      idempotencyKey,
      PAYLOAD_HASH,
      userId,
      JSON.stringify({ tableId }),
      createdAt,
    ],
  );

  const escrowAmount = txType === "TABLE_BUY_IN" ? 10n : -10n;
  const partnerAmount = -escrowAmount;
  const entries = validEntries
    ? [
        [partnerAccountId, partnerAmount],
        [escrowAccountId, escrowAmount],
      ]
    : [[partnerAccountId, partnerAmount]];

  for (const [index, [accountId, amount]] of entries.entries()) {
    await db.query(
      `insert into public.chips_entries
        (id, transaction_id, account_id, entry_seq, amount, created_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [number * 10 + index + 1, transactionId, accountId, index + 1, amount, createdAt],
    );
  }

  await db.query(
    `insert into public.chips_transaction_idempotency
      (idempotency_key, transaction_id, payload_hash, tx_type, user_id, transaction_created_at, archive_batch_id, table_id)
     values ($1, $2, $3, $4::public.chips_tx_type, $5, $6, $7, $8)`,
    [idempotencyKey, transactionId, PAYLOAD_HASH, txType, userId, createdAt, archiveBatchId, tableId],
  );

  return transactionId;
}

async function select(db, options = {}) {
  const result = await db.query(CLOSED_HUMAN_TABLE_CANDIDATE_SQL, [
    options.cutoff || CUTOFF,
    options.limit ?? 5000,
  ]);
  return result.rows;
}

async function testEligibleCompleteTable() {
  const db = await createFixture();
  try {
    const tableId = uuid(100);
    await insertHumanTable(db, { tableId });
    const buyIn = await insertTransaction(db, {
      tableId,
      number: 1,
      txType: "TABLE_BUY_IN",
      createdAt: "2026-08-01T00:00:00.000000Z",
      userId: USER_ID,
    });
    const cashOut = await insertTransaction(db, {
      tableId,
      number: 2,
      txType: "TABLE_CASH_OUT",
      createdAt: "2026-08-02T00:00:00.000000Z",
      userId: USER_ID,
    });

    const rows = await select(db);
    assert.deepEqual(
      rows.map((row) => row.id),
      [buyIn, cashOut],
      "complete closed human table should return both eligible transactions",
    );
    assert.deepEqual(rows.map((row) => row.table_id), [tableId, tableId]);
    assert.deepEqual(rows.map((row) => row.tx_type), ["TABLE_BUY_IN", "TABLE_CASH_OUT"]);
  } finally {
    await db.close();
  }
}

async function testIncompleteTableFailsClosed() {
  const db = await createFixture();
  try {
    const tableId = uuid(101);
    await insertHumanTable(db, { tableId });
    await insertTransaction(db, {
      tableId,
      number: 11,
      txType: "TABLE_BUY_IN",
      createdAt: "2026-08-01T00:00:00.000000Z",
      userId: USER_ID,
    });
    await insertTransaction(db, {
      tableId,
      number: 12,
      txType: "TABLE_CASH_OUT",
      createdAt: "2026-08-02T00:00:00.000000Z",
      userId: USER_ID,
    });
    // Third registry identity is hot but its entry shape is incomplete, so the
    // table-level complete gate must reject the whole table.
    await insertTransaction(db, {
      tableId,
      number: 13,
      txType: "TABLE_BUY_IN",
      createdAt: "2026-08-03T00:00:00.000000Z",
      userId: USER_ID,
      validEntries: false,
    });

    const rows = await select(db);
    assert.deepEqual(rows, [], "incomplete human table must not be selected");
  } finally {
    await db.close();
  }
}

async function testYoungTableRejected() {
  const db = await createFixture();
  try {
    const tableId = uuid(102);
    await insertHumanTable(db, { tableId });
    await insertTransaction(db, {
      tableId,
      number: 21,
      txType: "TABLE_BUY_IN",
      createdAt: "2026-08-01T00:00:00.000000Z",
      userId: USER_ID,
    });
    await insertTransaction(db, {
      tableId,
      number: 22,
      txType: "TABLE_CASH_OUT",
      createdAt: "2026-08-20T00:00:00.000000Z",
      userId: USER_ID,
    });

    const rows = await select(db);
    assert.deepEqual(rows, [], "table with a younger identity than the cutoff must not be selected");
  } finally {
    await db.close();
  }
}

async function testLifecycleGateRejected() {
  const db = await createFixture();
  try {
    const tableId = uuid(103);
    await insertHumanTable(db, { tableId, pendingRequest: true });
    await insertTransaction(db, {
      tableId,
      number: 31,
      txType: "TABLE_BUY_IN",
      createdAt: "2026-08-01T00:00:00.000000Z",
      userId: USER_ID,
    });
    await insertTransaction(db, {
      tableId,
      number: 32,
      txType: "TABLE_CASH_OUT",
      createdAt: "2026-08-02T00:00:00.000000Z",
      userId: USER_ID,
    });

    const rows = await select(db);
    assert.deepEqual(rows, [], "table with an open poker request must not be selected");
  } finally {
    await db.close();
  }
}

async function testArchivedCompatibilityLeftToLifecycleGate() {
  const db = await createFixture();
  try {
    const tableId = uuid(104);
    await insertHumanTable(db, { tableId });
    // One already-pruned/archived identity. The selector must only require the
    // remaining hot identities to be complete; it must not itself validate the
    // archived batch compatibility. That is chips_assert_closed_human_table_lifecycle_gate's job.
    await insertTransaction(db, {
      tableId,
      number: 41,
      txType: "TABLE_BUY_IN",
      createdAt: "2026-07-01T00:00:00.000000Z",
      userId: USER_ID,
      archiveBatchId: "historical-batch-without-selector-validation",
    });
    const cashOut = await insertTransaction(db, {
      tableId,
      number: 42,
      txType: "TABLE_CASH_OUT",
      createdAt: "2026-08-02T00:00:00.000000Z",
      userId: USER_ID,
    });

    const rows = await select(db);
    assert.deepEqual(
      rows.map((row) => row.id),
      [cashOut],
      "selector should select remaining hot row without validating historical archive compatibility",
    );
  } finally {
    await db.close();
  }
}

async function testUnrelatedRegistryRowsDoNotChangeOutcome() {
  const db = await createFixture();
  try {
    const tableId = uuid(105);
    const otherTableId = uuid(106);
    await insertHumanTable(db, { tableId });
    await insertHumanTable(db, { tableId: otherTableId, hasHumanParticipant: false, userId: null });
    const buyIn = await insertTransaction(db, {
      tableId,
      number: 51,
      txType: "TABLE_BUY_IN",
      createdAt: "2026-08-01T00:00:00.000000Z",
      userId: USER_ID,
    });
    const cashOut = await insertTransaction(db, {
      tableId,
      number: 52,
      txType: "TABLE_CASH_OUT",
      createdAt: "2026-08-02T00:00:00.000000Z",
      userId: USER_ID,
    });
    // Many unrelated bot/non-human registry rows must not leak into the
    // narrowed candidate_registry or change the complete count.
    for (let number = 60; number < 70; number += 1) {
      await insertTransaction(db, {
        tableId: otherTableId,
        number,
        txType: number % 2 === 0 ? "TABLE_BUY_IN" : "TABLE_CASH_OUT",
        createdAt: "2026-07-01T00:00:00.000000Z",
        userId: null,
      });
    }

    const rows = await select(db);
    assert.deepEqual(
      rows.map((row) => row.id),
      [buyIn, cashOut],
      "unrelated non-human registry rows must not affect human selector output",
    );
  } finally {
    await db.close();
  }
}

await testEligibleCompleteTable();
await testIncompleteTableFailsClosed();
await testYoungTableRejected();
await testLifecycleGateRejected();
await testArchivedCompatibilityLeftToLifecycleGate();
await testUnrelatedRegistryRowsDoNotChangeOutcome();

process.stdout.write("chips-ledger-closed-human-candidate-sql behavior passed\n");
