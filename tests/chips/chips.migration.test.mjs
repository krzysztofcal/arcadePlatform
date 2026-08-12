import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { createPruneStore } from "../../scripts/ops/chips-ledger-archive-prune.mjs";

const dbUrl = process.env.CHIPS_MIGRATIONS_TEST_DB_URL;
const allowDrop = process.env.CHIPS_MIGRATIONS_ALLOW_DROP === "1";

if (!dbUrl) {
  console.log("Skipping chips migration tests: CHIPS_MIGRATIONS_TEST_DB_URL not set.");
  process.exit(0);
}

process.env.SUPABASE_DB_URL = dbUrl;

const seedKey = "seed:treasury:v1";
const seedAmount = 1000000;
const botBankrollSeedKey = "seed:poker-bot-bankroll:v1";
const botBankrollSeedAmount = 1000000;
const primaryUserId = "00000000-0000-4000-8000-000000000001";
const idempotentUserId = "00000000-0000-4000-8000-000000000002";
const conflictUserId = "00000000-0000-4000-8000-000000000003";
const crossUserId = "00000000-0000-4000-8000-000000000004";
const assertTestDatabase = async (sql) => {
  const rows = await sql`select current_database() as name;`;
  const name = rows?.[0]?.name || "";
  const isTestDb = /_test$/i.test(name) || name === "chips_test_db";
  if (!allowDrop && !isTestDb) {
    throw new Error(
      `Refusing to drop non-test database (${name}). Set CHIPS_MIGRATIONS_ALLOW_DROP=1 to override.`
    );
  }
};
const systemBalances = async (sql, key) => {
  const rows = await sql`
    select balance
    from public.chips_accounts
    where account_type = 'SYSTEM'
      and system_key = ${key}
    limit 1;
  `;
  return Number(rows?.[0]?.balance ?? 0);
};

const accountNextSeq = async (sql, key) => {
  const rows = await sql`
    select next_entry_seq
    from public.chips_accounts
    where account_type = 'SYSTEM'
      and system_key = ${key}
    limit 1;
  `;
  return Number(rows?.[0]?.next_entry_seq ?? 0);
};

const seedTxCount = async (sql) => {
  const rows = await sql`select count(*) as count from public.chips_transactions where idempotency_key = ${seedKey};`;
  return Number(rows?.[0]?.count ?? 0);
};

const seedEntryCount = async (sql) => {
  const rows = await sql`
    select count(*) as count
    from public.chips_entries e
    join public.chips_transactions t on t.id = e.transaction_id
    where t.idempotency_key = ${seedKey};
  `;
  return Number(rows?.[0]?.count ?? 0);
};

const botBankrollSeedTxCount = async (sql) => {
  const rows = await sql`select count(*) as count from public.chips_transactions where idempotency_key = ${botBankrollSeedKey};`;
  return Number(rows?.[0]?.count ?? 0);
};

const botBankrollSeedEntryCount = async (sql) => {
  const rows = await sql`
    select count(*) as count
    from public.chips_entries e
    join public.chips_transactions t on t.id = e.transaction_id
    where t.idempotency_key = ${botBankrollSeedKey};
  `;
  return Number(rows?.[0]?.count ?? 0);
};

const expectNegativeBalanceGuard = async (sql) => {
  const genesisBefore = await systemBalances(sql, "GENESIS");
  const ROLLBACK = new Error("rollback");
  await sql
    .begin(async (tx) => {
      await tx`update public.chips_accounts set balance = -1 where system_key = 'GENESIS' and account_type = 'SYSTEM';`;
      const genesisAfter = await systemBalances(tx, "GENESIS");
      assert.equal(genesisAfter, -1, "GENESIS should be allowed to go negative");
      throw ROLLBACK;
    })
    .catch((error) => {
      if (error !== ROLLBACK) {
        throw error;
      }
    });
  assert.equal(await systemBalances(sql, "GENESIS"), genesisBefore, "GENESIS balance should rollback after test");

  try {
    await sql`update public.chips_accounts set balance = -1 where system_key = 'TREASURY' and account_type = 'SYSTEM';`;
    assert.fail("Non-GENESIS accounts must not go negative");
  } catch (error) {
    assert.equal(error?.code, "P0001", "Non-GENESIS negative balance must raise P0001");
    const message = (error?.message || "").toLowerCase();
    assert.ok(message.includes("insufficient_funds"), "Error should mention insufficient_funds");
  }
};

const dropAndRecreateSchema = async (sql) => {
  await assertTestDatabase(sql);
  await sql.unsafe("drop schema if exists public cascade;");
  await sql.unsafe("create schema public;");
};

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const seedMigration = migrationFiles.find((file) => file.includes("seed_treasury_genesis"));
if (!seedMigration) {
  console.log("Seed migration not found; cannot run tests.");
  process.exit(1);
}
const seedMigrationContent = fs.readFileSync(path.join(migrationsDir, seedMigration), "utf8");
if (seedMigrationContent.includes("raise_insufficient_funds")) {
  console.log("Seed migration depends on raise_insufficient_funds; aborting.");
  process.exit(1);
}
const botBankrollMigration = migrationFiles.find((file) => file.includes("poker_bot_bankroll"));
if (!botBankrollMigration) {
  throw new Error("Bounded bot bankroll migration not found; cannot run tests.");
}
const idempotencyGapMigration = migrationFiles.find((file) => file.includes("chips_transaction_idempotency_backfill_gap"));
if (!idempotencyGapMigration) {
  throw new Error("Idempotency gap migration not found; cannot run tests.");
}
const migrationsWithoutBootstrapSeeds = migrationFiles.filter((file) => file !== seedMigration && file !== botBankrollMigration);

const runMigration = async (sql, file) => {
  const content = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  await sql.unsafe(content);
};

const runMigrations = async (sql, files) => {
  for (const file of files) {
    await runMigration(sql, file);
  }
};

const ensureGenesisFixture = async (sql) => {
  await sql`
    insert into public.chips_accounts (account_type, system_key, status, balance, next_entry_seq)
    select 'SYSTEM', 'GENESIS', 'active', 0, 1
    where not exists (
      select 1 from public.chips_accounts where account_type = 'SYSTEM' and system_key = 'GENESIS'
    );
  `;
};

const withLedger = async () => {
  const module = await import("../../netlify/functions/_shared/chips-ledger.mjs");
  return module;
};

async function expectInsufficientBuyIn(sql) {
  const { postTransaction } = await withLedger();
  const key = `buyin-${Date.now()}`;
  try {
    await postTransaction({
      userId: primaryUserId,
      txType: "BUY_IN",
      idempotencyKey: key,
      entries: [
        { accountType: "USER", amount: 10 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -10 },
      ],
      createdBy: null,
    });
    assert.fail("BUY_IN should fail when treasury is empty");
  } catch (error) {
    const message = (error?.message || "").toLowerCase();
    assert.ok(message.includes("insufficient_funds"), "Error should report insufficient_funds");
    assert.equal(error?.code, "P0001", "Insufficient funds should surface with P0001");
  }
}

async function expectInvalidMetadata(sql) {
  const { postTransaction } = await withLedger();
  const key = `badmeta-${Date.now()}`;
  const before = await systemBalances(sql, "TREASURY");
  const circular = {};
  circular.self = circular;
  let caught = null;
  try {
    await postTransaction({
      userId: primaryUserId,
      txType: "BUY_IN",
      idempotencyKey: key,
      metadata: circular,
      entries: [
        { accountType: "USER", amount: 1 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -1 },
      ],
      createdBy: null,
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, "Circular metadata must reject the transaction");
  assert.equal(caught?.status, 400, "Invalid metadata should surface as bad request");
  assert.equal(caught?.code, "invalid_metadata", "Invalid metadata should map to invalid_metadata");
  const after = await systemBalances(sql, "TREASURY");
  assert.equal(after, before, "Balances must remain unchanged when metadata is invalid");
  const txRows = await sql`
    select count(*) as count
    from public.chips_transactions
    where idempotency_key = ${key};
  `;
  assert.equal(Number(txRows?.[0]?.count || 0), 0, "Invalid metadata must not create a transaction");
}

async function expectInvalidEntryMetadata(sql) {
  const { postTransaction } = await withLedger();
  const key = `bad-entry-meta-${Date.now()}`;
  const before = await systemBalances(sql, "TREASURY");
  let caught = null;
  try {
    await postTransaction({
      userId: primaryUserId,
      txType: "BUY_IN",
      idempotencyKey: key,
      metadata: {},
      entries: [
        { accountType: "USER", amount: 1, metadata: { a: 1n } },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -1 },
      ],
      createdBy: null,
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, "Non-serializable entry metadata must reject the transaction");
  assert.equal(caught?.status, 400, "Invalid entry metadata should surface as bad request");
  assert.equal(caught?.code, "invalid_entry_metadata", "Entry metadata should map to invalid_entry_metadata");
  const after = await systemBalances(sql, "TREASURY");
  assert.equal(after, before, "Balances must remain unchanged when entry metadata is invalid");
  const txRows = await sql`
    select count(*) as count
    from public.chips_transactions
    where idempotency_key = ${key};
  `;
  assert.equal(Number(txRows?.[0]?.count || 0), 0, "Invalid entry metadata must not create a transaction");
}

async function expectInvalidMetadataShape(sql) {
  const { postTransaction } = await withLedger();
  const shapes = [[], "x"];
  for (let i = 0; i < shapes.length; i += 1) {
    const key = `badmeta-shape-${i}-${Date.now()}`;
    const before = await systemBalances(sql, "TREASURY");
    let caught = null;
    try {
      await postTransaction({
        userId: primaryUserId,
        txType: "BUY_IN",
        idempotencyKey: key,
        metadata: shapes[i],
        entries: [
          { accountType: "USER", amount: 1 },
          { accountType: "SYSTEM", systemKey: "TREASURY", amount: -1 },
        ],
        createdBy: null,
      });
    } catch (error) {
      caught = error;
    }

    assert.ok(caught, "Non-object metadata must reject the transaction");
    assert.equal(caught?.status, 400, "Invalid metadata shape should surface as bad request");
    assert.equal(caught?.code, "invalid_metadata", "Invalid metadata should map to invalid_metadata");
    const after = await systemBalances(sql, "TREASURY");
    assert.equal(after, before, "Balances must remain unchanged when metadata shape is invalid");
    const txRows = await sql`
      select count(*) as count
      from public.chips_transactions
      where idempotency_key = ${key};
    `;
    assert.equal(Number(txRows?.[0]?.count || 0), 0, "Invalid metadata shape must not create a transaction");
  }
}

async function expectInvalidEntryMetadataShape(sql) {
  const { postTransaction } = await withLedger();
  const shapes = [[], "x"];
  for (let i = 0; i < shapes.length; i += 1) {
    const key = `bad-entry-shape-${i}-${Date.now()}`;
    const before = await systemBalances(sql, "TREASURY");
    let caught = null;
    try {
      await postTransaction({
        userId: primaryUserId,
        txType: "BUY_IN",
        idempotencyKey: key,
        metadata: {},
        entries: [
          { accountType: "USER", amount: 1, metadata: shapes[i] },
          { accountType: "SYSTEM", systemKey: "TREASURY", amount: -1 },
        ],
        createdBy: null,
      });
    } catch (error) {
      caught = error;
    }

    assert.ok(caught, "Non-object entry metadata must reject the transaction");
    assert.equal(caught?.status, 400, "Invalid entry metadata shape should surface as bad request");
    assert.equal(caught?.code, "invalid_entry_metadata", "Entry metadata should map to invalid_entry_metadata");
    const after = await systemBalances(sql, "TREASURY");
    assert.equal(after, before, "Balances must remain unchanged when entry metadata shape is invalid");
    const txRows = await sql`
      select count(*) as count
      from public.chips_transactions
      where idempotency_key = ${key};
    `;
    assert.equal(Number(txRows?.[0]?.count || 0), 0, "Invalid entry metadata shape must not create a transaction");
  }
}

async function expectIdempotentReplaySamePayload(sql) {
  const { postTransaction } = await withLedger();
  const key = `idem-same-${Date.now()}`;
  const amount = 15;
  const beforeTreasury = await systemBalances(sql, "TREASURY");
  const beforeSeq = await accountNextSeq(sql, "TREASURY");
  const first = await postTransaction({
    userId: idempotentUserId,
    txType: "BUY_IN",
    idempotencyKey: key,
    entries: [
      { accountType: "USER", amount },
      { accountType: "SYSTEM", systemKey: "TREASURY", amount: -amount },
    ],
    createdBy: null,
  });

  const afterFirstSeq = await accountNextSeq(sql, "TREASURY");
  assert.equal(afterFirstSeq, beforeSeq + 1, "First idempotent call should advance TREASURY sequence once");
  const firstEntries = await sql`
    select account_id, amount, entry_seq
    from public.chips_entries
    where transaction_id = ${first.transaction.id}
    order by entry_seq;
  `;

  const second = await postTransaction({
    userId: idempotentUserId,
    txType: "BUY_IN",
    idempotencyKey: key,
    entries: [
      { accountType: "USER", amount },
      { accountType: "SYSTEM", systemKey: "TREASURY", amount: -amount },
    ],
    createdBy: null,
  });

  const afterSecondSeq = await accountNextSeq(sql, "TREASURY");
  assert.equal(afterSecondSeq, afterFirstSeq, "Idempotent replay must not advance TREASURY sequence");
  const secondEntries = await sql`
    select account_id, amount, entry_seq
    from public.chips_entries
    where transaction_id = ${second.transaction.id}
    order by entry_seq;
  `;

  assert.equal(first?.transaction?.id, second?.transaction?.id, "Idempotent replay should return same transaction");
  const afterTreasury = await systemBalances(sql, "TREASURY");
  assert.equal(afterTreasury, beforeTreasury - amount, "Treasury should only be charged once for idempotent replay");
  const entryCountRows = await sql`
    select count(*) as count
    from public.chips_entries
    where transaction_id = ${first.transaction.id};
  `;
  assert.equal(Number(entryCountRows?.[0]?.count || 0), 2, "Idempotent replay must keep single set of entries");

  const pluck = (row) => ({
    account_id: row.account_id,
    amount: Number(row.amount || 0),
    entry_seq: Number(row.entry_seq || 0),
  });
  assert.deepEqual(
    secondEntries.map(pluck),
    firstEntries.map(pluck),
    "Replay response must match original entries"
  );

  const normalizeResp = (row) => ({
    account_id: row.account_id,
    amount: Number(row.amount || 0),
    entry_seq: Number(row.entry_seq || 0),
  });
  assert.deepEqual(
    (second.entries || []).map(normalizeResp),
    (first.entries || []).map(normalizeResp),
    "Idempotent replay must return identical snapshot entries"
  );

  return { amountSpent: amount, treasurySeqDelta: afterFirstSeq - beforeSeq };
}

async function expectIdempotentReplayDifferentPayload(sql) {
  const { postTransaction } = await withLedger();
  const key = `idem-conflict-${Date.now()}`;
  const amount = 5;
  const beforeTreasury = await systemBalances(sql, "TREASURY");
  const beforeSeq = await accountNextSeq(sql, "TREASURY");

  const first = await postTransaction({
    userId: conflictUserId,
    txType: "BUY_IN",
    idempotencyKey: key,
    entries: [
      { accountType: "USER", amount },
      { accountType: "SYSTEM", systemKey: "TREASURY", amount: -amount },
    ],
    createdBy: null,
  });

  const afterFirstSeq = await accountNextSeq(sql, "TREASURY");
  assert.equal(afterFirstSeq, beforeSeq + 1, "First conflict call should advance TREASURY sequence once");
  const firstEntries = await sql`
    select account_id, amount, entry_seq
    from public.chips_entries
    where transaction_id = ${first.transaction.id}
    order by entry_seq;
  `;

  let caught = null;
  try {
    await postTransaction({
      userId: conflictUserId,
      txType: "BUY_IN",
      idempotencyKey: key,
      entries: [
        { accountType: "USER", amount: amount + 1 },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -(amount + 1) },
      ],
      createdBy: null,
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, "Different payload must raise idempotency conflict");
  assert.equal(caught?.status, 409, "Idempotency conflict should surface with 409");
  const afterTreasury = await systemBalances(sql, "TREASURY");
  assert.equal(afterTreasury, beforeTreasury - amount, "Conflict replay should not re-apply balances");
  const afterSecondSeq = await accountNextSeq(sql, "TREASURY");
  assert.equal(afterSecondSeq, afterFirstSeq, "Conflict replay must not advance TREASURY sequence");
  const entryCountRows = await sql`
    select count(*) as count
    from public.chips_entries
    where transaction_id = ${first.transaction.id};
  `;
  assert.equal(Number(entryCountRows?.[0]?.count || 0), 2, "Conflict replay must retain original entries only");

  const entryRows = await sql`
    select account_id, amount, entry_seq
    from public.chips_entries
    where transaction_id = ${first.transaction.id}
    order by entry_seq;
  `;
  const pluck = (row) => ({
    account_id: row.account_id,
    amount: Number(row.amount || 0),
    entry_seq: Number(row.entry_seq || 0),
  });
  assert.deepEqual(
    entryRows.map(pluck),
    firstEntries.map(pluck),
    "Conflict replay must keep original entry ordering"
  );

  const replayOriginal = await postTransaction({
    userId: conflictUserId,
    txType: "BUY_IN",
    idempotencyKey: key,
    entries: [
      { accountType: "USER", amount },
      { accountType: "SYSTEM", systemKey: "TREASURY", amount: -amount },
    ],
    createdBy: null,
  });
  const afterReplaySeq = await accountNextSeq(sql, "TREASURY");
  assert.equal(afterReplaySeq, afterSecondSeq, "Replay after conflict must not advance TREASURY sequence");
  assert.equal(
    replayOriginal?.transaction?.id,
    first.transaction.id,
    "Original payload should replay to the original transaction after conflict"
  );

  return { amountSpent: amount, treasurySeqDelta: afterFirstSeq - beforeSeq };
}

async function expectCrossUserIdempotencyConflict(sql) {
  const { postTransaction } = await withLedger();
  const key = `idem-cross-${Date.now()}`;
  const amount = 7;
  const beforeTreasury = await systemBalances(sql, "TREASURY");
  const beforeSeq = await accountNextSeq(sql, "TREASURY");

  const first = await postTransaction({
    userId: idempotentUserId,
    txType: "BUY_IN",
    idempotencyKey: key,
    entries: [
      { accountType: "USER", amount },
      { accountType: "SYSTEM", systemKey: "TREASURY", amount: -amount },
    ],
    createdBy: null,
  });

  const afterFirstSeq = await accountNextSeq(sql, "TREASURY");
  assert.equal(afterFirstSeq, beforeSeq + 1, "Cross-user first call should advance TREASURY sequence once");

  let caught = null;
  try {
    await postTransaction({
      userId: crossUserId,
      txType: "BUY_IN",
      idempotencyKey: key,
      entries: [
        { accountType: "USER", amount },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -amount },
      ],
      createdBy: null,
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, "Cross-user reuse must raise idempotency conflict");
  assert.equal(caught?.status, 409, "Cross-user idempotency conflict should surface with 409");
  const afterTreasury = await systemBalances(sql, "TREASURY");
  assert.equal(afterTreasury, beforeTreasury - amount, "Cross-user conflict must not re-apply balances");
  const afterSecondSeq = await accountNextSeq(sql, "TREASURY");
  assert.equal(afterSecondSeq, afterFirstSeq, "Cross-user conflict must not advance TREASURY sequence");

  const entryCountRows = await sql`
    select count(*) as count
    from public.chips_entries
    where transaction_id = ${first.transaction.id};
  `;
  assert.equal(Number(entryCountRows?.[0]?.count || 0), 2, "Cross-user conflict must keep original entries only");

  const replayOriginal = await postTransaction({
    userId: idempotentUserId,
    txType: "BUY_IN",
    idempotencyKey: key,
    entries: [
      { accountType: "USER", amount },
      { accountType: "SYSTEM", systemKey: "TREASURY", amount: -amount },
    ],
    createdBy: null,
  });
  assert.equal(
    replayOriginal?.transaction?.id,
    first.transaction.id,
    "Original user replay should still return the original transaction"
  );

  const afterReplaySeq = await accountNextSeq(sql, "TREASURY");
  assert.equal(afterReplaySeq, afterSecondSeq, "Replay after cross-user conflict must not advance TREASURY sequence");

  return { amountSpent: amount, treasurySeqDelta: afterFirstSeq - beforeSeq };
}

async function expectSuccessfulBuyIn(sql) {
  const { postTransaction, getUserBalance } = await withLedger();
  const key = `buyin-ok-${Date.now()}`;
  const amount = 25;
  let result = null;
  let caught = null;
  const beforeTreasury = await systemBalances(sql, "TREASURY");
  const beforeUser = await getUserBalance(primaryUserId);
  try {
    result = await postTransaction({
      userId: primaryUserId,
      txType: "BUY_IN",
      idempotencyKey: key,
      entries: [
        { accountType: "USER", amount },
        { accountType: "SYSTEM", systemKey: "TREASURY", amount: -amount },
      ],
      createdBy: null,
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(!caught, `BUY_IN should succeed without errors (got ${caught?.code || caught?.message || "unknown"})`);
  assert.notEqual(caught?.code, "27000", "Posting must not raise tuple-already-modified trigger errors");
  assert.ok(result?.transaction?.id, "BUY_IN should record a transaction");
  const balance = await getUserBalance(primaryUserId);
  assert.equal(balance.balance, beforeUser.balance + amount, "User balance should increase by BUY_IN amount");
  const treasury = await systemBalances(sql, "TREASURY");
  assert.equal(treasury, beforeTreasury - amount, "Treasury should decrease by buy-in amount");
  const registryRows = await sql`
    select transaction_id, payload_hash, replay_transaction, replay_entries, replay_completed_at
    from public.chips_transaction_idempotency
    where idempotency_key = ${key};
  `;
  assert.equal(registryRows.length, 1, "New transaction must create one registry row atomically");
  assert.equal(registryRows[0].transaction_id, result.transaction.id, "Registry must preserve transaction id");
  assert.ok(registryRows[0].replay_transaction, "BUY_IN registry replay transaction must be complete");
  assert.ok(registryRows[0].replay_entries, "BUY_IN registry replay entries must be complete");
  assert.ok(registryRows[0].replay_completed_at, "BUY_IN registry replay completion timestamp is required");
  return { amountSpent: amount, treasurySeqDelta: 1 };
}

async function assertSeedSequencing(sql) {
  const txRows = await sql`select id from public.chips_transactions where idempotency_key = ${seedKey} limit 1;`;
  const txId = txRows?.[0]?.id;
  assert.ok(txId, "Seed transaction should exist");

  const entries = await sql`
    select account_id, amount, entry_seq
    from public.chips_entries
    where transaction_id = ${txId}
    order by account_id, entry_seq;
  `;

  assert.equal(entries.length, 2, "Seed transaction must create two entries");
  assert.equal(entries.reduce((sum, row) => sum + Number(row.amount || 0), 0), 0, "Entries must balance to zero");
  entries.forEach((row) => {
    assert.ok(Number(row.entry_seq) > 0, "Entries require positive sequence");
  });

  const accountRows = await sql`
    select system_key, next_entry_seq
    from public.chips_accounts
    where account_type = 'SYSTEM'
      and system_key in ('GENESIS', 'TREASURY', 'POKER_BOT_BANKROLL');
  `;
  const seqByKey = new Map(accountRows.map((row) => [row.system_key, Number(row.next_entry_seq || 0)]));
  assert.equal(seqByKey.get("GENESIS"), 3, "GENESIS next_entry_seq should advance after both genesis allocations");
  assert.equal(seqByKey.get("TREASURY"), 2, "TREASURY next_entry_seq should advance after seed entry");
  assert.equal(seqByKey.get("POKER_BOT_BANKROLL"), 2, "POKER_BOT_BANKROLL next_entry_seq should advance after its seed entry");
}

async function assertBotBankrollSeed(sql) {
  assert.equal(await botBankrollSeedTxCount(sql), 1, "Bounded bot bankroll seed transaction should exist once");
  assert.equal(await botBankrollSeedEntryCount(sql), 2, "Bounded bot bankroll seed must create two entries");
  assert.equal(await systemBalances(sql, "POKER_BOT_BANKROLL"), botBankrollSeedAmount, "Bounded bot bankroll should start with 1,000,000 CH");
  const rows = await sql`
    select a.system_key, e.amount
    from public.chips_entries e
    join public.chips_transactions t on t.id = e.transaction_id
    join public.chips_accounts a on a.id = e.account_id
    where t.idempotency_key = ${botBankrollSeedKey}
    order by a.system_key;
  `;
  assert.deepEqual(rows.map((row) => [row.system_key, Number(row.amount)]), [
    ["GENESIS", -botBankrollSeedAmount],
    ["POKER_BOT_BANKROLL", botBankrollSeedAmount]
  ]);
}

async function assertIdempotencyRegistryParity(sql) {
  const rows = await sql`
    select
      (select count(*) from public.chips_transactions) as transaction_count,
      (select count(*) from public.chips_transaction_idempotency) as registry_count,
      (select count(*)
       from public.chips_transactions t
       left join public.chips_transaction_idempotency r on r.idempotency_key = t.idempotency_key
       where r.idempotency_key is null
          or r.transaction_id <> t.id
          or r.payload_hash <> t.payload_hash
          or r.tx_type <> t.tx_type
          or r.user_id is distinct from t.user_id
          or r.transaction_created_at <> t.created_at) as mismatch_count,
      (select count(*)
       from public.chips_transaction_idempotency r
       join public.chips_transactions t on t.id = r.transaction_id
       where t.tx_type::text in ('BUY_IN', 'CASH_OUT', 'WELCOME_BONUS', 'PROMO_BONUS', 'ADMIN_ADJUST')
         and (r.replay_transaction is null or r.replay_entries is null or r.replay_completed_at is null)) as incomplete_full_replay_count;
  `;
  const row = rows?.[0] || {};
  assert.equal(Number(row.transaction_count), Number(row.registry_count), "Registry row count must match transaction row count");
  assert.equal(Number(row.mismatch_count), 0, "Registry identity must match every transaction");
  assert.equal(Number(row.incomplete_full_replay_count), 0, "Full-replay transaction types require complete snapshots");
  return {
    transactionCount: Number(row.transaction_count),
    registryCount: Number(row.registry_count),
    mismatchCount: Number(row.mismatch_count),
    incompleteFullReplayCount: Number(row.incomplete_full_replay_count),
  };
}

async function expectSavepointError(tx, savepoint, operation, expectedMessage) {
  assert.match(savepoint, /^[a-z_]+$/);
  await tx.unsafe(`savepoint ${savepoint};`);
  let caught = null;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await tx.unsafe(`rollback to savepoint ${savepoint};`);
  await tx.unsafe(`release savepoint ${savepoint};`);
  assert.match(caught?.message || "", expectedMessage);
}

async function assertArchivePrunerRoleContracts(sql) {
  const hashes = await sql`
    select
      public.chips_archive_uuid_ids_sha256(array[
        '00000000-0000-4000-8000-00000000000a'::uuid,
        '00000000-0000-4000-8000-00000000000b'::uuid
      ]) as transaction_hash,
      public.chips_archive_bigint_ids_sha256(array[1::bigint, 2, 10, 9007199254740993]) as entry_hash;
  `;
  assert.equal(hashes[0].transaction_hash, "726400e7a16ea9e7ca71ee707fb025934613059de29366a5ae7f626256b688fa");
  assert.equal(hashes[0].entry_hash, "58eb8c6b6deb82261f809eb3277a61b010224ae0fe568f199ced00f51f7dd8ac");

  const roleRows = await sql`
    select rolsuper, rolcreatedb, rolcreaterole, rolreplication,
           rolbypassrls, rolcanlogin, rolinherit
      from pg_catalog.pg_roles
      where rolname = 'chips_ledger_archive_pruner';
  `;
  assert.deepEqual(roleRows[0], {
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
    rolcanlogin: false,
    rolinherit: false,
  }, "archive pruner must remain a least-privilege NOLOGIN role");

  const functionOwners = await sql`
    select
      pg_catalog.pg_get_userbyid((
        select proowner from pg_catalog.pg_proc
        where oid = 'public.chips_assert_archive_prune_stage()'::regprocedure
      )) as gate_owner,
      pg_catalog.pg_get_userbyid((
        select proowner from pg_catalog.pg_proc
        where oid = 'public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean)'::regprocedure
      )) as prune_owner,
      pg_catalog.pg_get_userbyid((
        select proowner from pg_catalog.pg_proc
        where oid = 'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)'::regprocedure
      )) as prune_internal_owner,
      (select proisstrict from pg_catalog.pg_proc
       where oid = 'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)'::regprocedure) as prune_internal_strict,
      pg_catalog.to_regclass('public.chips_transaction_idempotency_archive_batch_idx') is not null as archive_mapping_index_exists,
      exists (
        select 1
          from pg_catalog.pg_auth_members memberships
          join pg_catalog.pg_roles granted_role on granted_role.oid = memberships.roleid
          join pg_catalog.pg_roles member_role on member_role.oid = memberships.member
          join pg_catalog.pg_roles grantor_role on grantor_role.oid = memberships.grantor
          where granted_role.rolname = 'chips_ledger_archive_pruner'
            and not (
              member_role.rolname = 'postgres'
              and grantor_role.rolname = 'supabase_admin'
              and memberships.admin_option
              and not memberships.inherit_option
              and not memberships.set_option
            )
      ) as unsafe_membership,
      pg_catalog.has_schema_privilege('chips_ledger_archive_pruner', 'public', 'usage') as public_schema_usage,
      pg_catalog.has_schema_privilege('chips_ledger_archive_pruner', 'public', 'create') as public_schema_create;
  `;
  assert.equal(functionOwners[0].gate_owner, "postgres", "read-only Stage identity gate must retain its privileged owner");
  assert.equal(functionOwners[0].prune_owner, "chips_ledger_archive_pruner", "destructive function must use the NOLOGIN owner");
  assert.equal(functionOwners[0].prune_internal_owner, "chips_ledger_archive_pruner", "internal pruning implementation must use the NOLOGIN owner");
  assert.equal(functionOwners[0].prune_internal_strict, true, "internal pruning implementation must never receive NULL arguments");
  assert.equal(functionOwners[0].archive_mapping_index_exists, false, "initial pruning measurement must not add an archive mapping index");
  assert.equal(functionOwners[0].unsafe_membership, false, "only the managed non-inheriting ADMIN membership may remain");
  assert.equal(functionOwners[0].public_schema_usage, true, "pruner needs schema usage for qualified objects");
  assert.equal(functionOwners[0].public_schema_create, false, "temporary schema CREATE must be revoked");

  const acl = await sql`
    select
      has_function_privilege('service_role', 'public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean)', 'execute') as service_role_execute,
      has_function_privilege('anon', 'public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean)', 'execute') as anon_execute,
      has_function_privilege('authenticated', 'public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean)', 'execute') as authenticated_execute,
      has_function_privilege('service_role', 'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)', 'execute') as service_role_internal_execute,
      has_function_privilege('anon', 'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)', 'execute') as anon_internal_execute,
      has_function_privilege('authenticated', 'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)', 'execute') as authenticated_internal_execute,
      has_function_privilege('service_role', 'public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric)', 'execute') as service_role_proof_execute,
      exists (
        select 1 from pg_catalog.pg_proc procedures
        cross join lateral pg_catalog.aclexplode(coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))) privileges
        where procedures.oid = 'public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean)'::regprocedure
          and privileges.grantee = 'postgres'::regrole::oid
          and privileges.privilege_type = 'EXECUTE'
      ) as postgres_execute,
      exists (
        select 1 from pg_catalog.pg_proc procedures
        cross join lateral pg_catalog.aclexplode(coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))) privileges
        where procedures.oid = 'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)'::regprocedure
          and privileges.grantee = 'postgres'::regrole::oid
          and privileges.privilege_type = 'EXECUTE'
      ) as postgres_internal_execute;
  `;
  assert.equal(acl[0].service_role_execute, false, "service_role must not execute the destructive function");
  assert.equal(acl[0].anon_execute, false, "anon must not execute the destructive function");
  assert.equal(acl[0].authenticated_execute, false, "authenticated must not execute the destructive function");
  assert.equal(acl[0].service_role_internal_execute, false, "service_role must not execute the internal destructive function");
  assert.equal(acl[0].anon_internal_execute, false, "anon must not execute the internal destructive function");
  assert.equal(acl[0].authenticated_internal_execute, false, "authenticated must not execute the internal destructive function");
  assert.equal(acl[0].service_role_proof_execute, false, "service_role must not register immutable archive proof");
  assert.equal(acl[0].postgres_execute, true, "the explicit operations role must execute the destructive function");
  assert.equal(acl[0].postgres_internal_execute, false, "the operations role must not bypass the NULL-safe wrapper");

  const ROLLBACK = new Error("archive-pruner-probe-rollback");
  await sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level serializable;");
    await tx.unsafe(`create or replace function public.chips_assert_archive_prune_stage()
      returns text language sql security definer set search_path = ''
      as $override$ select '7656985631720456337'::text $override$;`);
    const tableId = "00000000-0000-4000-8000-00000000b401";
    const escrowId = "00000000-0000-4000-8000-00000000b402";
    const transactionIds = [
      "00000000-0000-4000-8000-00000000b403",
      "00000000-0000-4000-8000-00000000b404",
    ];
    const cursorStartId = "00000000-0000-4000-8000-00000000b400";
    const cutoff = "2026-02-01T00:00:00.123456Z";
    const cursorStartCreatedAt = "2025-12-31T23:59:59.654321Z";
    const createdAt = ["2026-01-01T00:00:00.000001Z", "2026-01-01T00:00:00.000002Z"];
    await tx`insert into public.poker_tables (id, status) values (${tableId}, 'ACTIVE');`;
    await tx`
      insert into public.chips_accounts (id, account_type, system_key, status)
      values (${escrowId}, 'ESCROW', ${`POKER_TABLE:${tableId}`}, 'active');
    `;
    for (let index = 0; index < transactionIds.length; index += 1) {
      await tx.unsafe(`insert into public.chips_transactions (
        id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id, created_at
      ) values ($1::uuid, $2, $3::jsonb, $4, $5, $6, null, $7::timestamptz);`, [
        transactionIds[index], `table:${tableId}`, { tableId }, `archive-pruner-probe:${index}`,
        (index === 0 ? "a" : "b").repeat(64), index === 0 ? "TABLE_BUY_IN" : "TABLE_CASH_OUT", sql.typed(createdAt[index], 25),
      ]);
    }
    const entryIds = [];
    for (let index = 0; index < transactionIds.length; index += 1) {
      const entryRows = await tx.unsafe(`with accounts as (
        select id, system_key from public.chips_accounts
        where (account_type = 'SYSTEM' and system_key = 'GENESIS') or id = $2::uuid
      )
      insert into public.chips_entries (transaction_id, account_id, amount, metadata)
      select $1::uuid, id,
             case
               when $3::boolean and system_key = 'GENESIS' then -10
               when $3::boolean then 10
               when system_key = 'GENESIS' then 10
               else -10
             end,
             '{}'::jsonb
      from accounts order by system_key returning id;`, [transactionIds[index], escrowId, index === 0]);
      entryIds.push(...entryRows.map((row) => String(row.id)).sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1));
    }
    const accountsBefore = await tx`
      select id, balance, next_entry_seq from public.chips_accounts
      where system_key in ('GENESIS', ${`POKER_TABLE:${tableId}`}) order by id;
    `;
    const compressedHash = "2".repeat(64);
    const manifestRows = await tx.unsafe(`insert into public.chips_ledger_archive_batches (
      object_path, project_ref, format_version, cutoff, cursor_start_created_at, cursor_start_id,
      cursor_end_created_at, cursor_end_id,
      first_created_at, last_created_at, transaction_count, entry_count, tx_types,
      raw_bytes, compressed_bytes, raw_sha256, compressed_sha256, credits, debits,
      net_amount, status, committed_at
    ) values (
      $1, 'krydukthwdvccggbyjfw', 1, $2::timestamptz, $3::timestamptz, $4::uuid,
      $5::timestamptz, $6::uuid, $7::timestamptz, $5::timestamptz,
      2, 4, '{"TABLE_BUY_IN":1,"TABLE_CASH_OUT":1}'::jsonb,
      100, 80, $8, $9, 20, 20, 0, 'committed', timezone('utc', now())
    ) returning batch_id;`, [
      `v1/sha256/${compressedHash}.jsonl.gz`, sql.typed(cutoff, 25), sql.typed(cursorStartCreatedAt, 25), cursorStartId,
      sql.typed(createdAt[1], 25), transactionIds[1], sql.typed(createdAt[0], 25), "1".repeat(64), compressedHash,
    ]);
    const batchId = String(manifestRows[0].batch_id);
    const objectPath = `v1/sha256/${compressedHash}.jsonl.gz`;
    const generatedHashes = await tx.unsafe(`select
      public.chips_archive_uuid_ids_sha256($1::uuid[]) as transaction_hash,
      public.chips_archive_bigint_ids_sha256($2::bigint[]) as entry_hash;`, [transactionIds, entryIds]);
    const transactionHash = generatedHashes[0].transaction_hash;
    const entryHash = generatedHashes[0].entry_hash;

    await expectSavepointError(tx, "archive_direct_proof", () => tx.unsafe(`update public.chips_ledger_archive_batches
      set archived_transaction_ids_sha256 = $2,
          archived_entry_ids_sha256 = $3,
          archive_proof_verified_at = timezone('utc', now())
      where batch_id = $1;`, [batchId, transactionHash, entryHash]), /proof may only be written by the archive pruner/i);
    await expectSavepointError(tx, "archive_direct_mapping", () => tx.unsafe(`update public.chips_transaction_idempotency
      set archive_batch_id = $2
      where transaction_id = $1::uuid;`, [transactionIds[0], batchId]), /mapping may only be written by the archive pruner/i);
    await expectSavepointError(tx, "archive_combined_transition", async () => {
      await tx.unsafe("set local role chips_ledger_archive_pruner;");
      await tx.unsafe(`update public.chips_ledger_archive_batches
        set archived_transaction_ids_sha256 = $2,
            archived_entry_ids_sha256 = $3,
            archive_proof_verified_at = timezone('utc', now()),
            pruned_at = timezone('utc', now()),
            pruned_transaction_count = 2,
            pruned_entry_count = 4,
            pruned_transaction_ids_sha256 = $2,
            pruned_entry_ids_sha256 = $3
        where batch_id = $1;`, [batchId, transactionHash, entryHash]);
    }, /proof and prune receipt require separate transitions/i);

    const untouchedGuardState = await tx.unsafe(`select
      (select archive_proof_verified_at from public.chips_ledger_archive_batches where batch_id = $1) as proof_at,
      (select pruned_at from public.chips_ledger_archive_batches where batch_id = $1) as pruned_at,
      (select count(*) from public.chips_transaction_idempotency where archive_batch_id = $1) as mappings;`, [batchId]);
    assert.equal(untouchedGuardState[0].proof_at, null);
    assert.equal(untouchedGuardState[0].pruned_at, null);
    assert.equal(Number(untouchedGuardState[0].mappings), 0);

    const pruneStore = createPruneStore({
      unsafe: (...args) => tx.unsafe(...args),
      begin: async (callback) => callback({
        unsafe: (query, parameters) => query === "set transaction isolation level repeatable read;"
          ? Promise.resolve([])
          : tx.unsafe(query, parameters),
      }),
      typed: (value, type) => sql.typed(value, type),
    });
    const adapterManifest = await pruneStore.getManifest(objectPath);
    assert.deepEqual([
      adapterManifest.cutoff, adapterManifest.cursor_start_created_at,
      adapterManifest.cursor_end_created_at, adapterManifest.first_created_at, adapterManifest.last_created_at,
    ], [
      "2026-02-01 00:00:00.123456+00", "2025-12-31 23:59:59.654321+00",
      "2026-01-01 00:00:00.000002+00", "2026-01-01 00:00:00.000001+00", "2026-01-01 00:00:00.000002+00",
    ], "real PostgreSQL adapter must preserve manifest microseconds");
    const proofResult = await pruneStore.registerProof(adapterManifest, { transactionIds, entryIds });
    assert.equal(proofResult.state, "proof_registered", "real PostgreSQL adapter must preserve microseconds when registering proof");

    await expectSavepointError(tx, "archive_direct_receipt", () => tx.unsafe(`update public.chips_ledger_archive_batches
      set pruned_at = timezone('utc', now()),
          pruned_transaction_count = 2,
          pruned_entry_count = 4,
          pruned_transaction_ids_sha256 = $2,
          pruned_entry_ids_sha256 = $3
      where batch_id = $1;`, [batchId, transactionHash, entryHash]), /receipt may only be written by the archive pruner/i);

    await tx.unsafe("savepoint archive_active_table_probe;");
    let activeTableError = null;
    try {
      await tx.unsafe(
        "select public.chips_prune_committed_archive_batch($1, $2::uuid[], $3::bigint[], false) as result;",
        [objectPath, transactionIds, entryIds],
      );
    } catch (error) {
      activeTableError = error;
    }
    await tx.unsafe("rollback to savepoint archive_active_table_probe;");
    await tx.unsafe("release savepoint archive_active_table_probe;");
    assert.match(activeTableError?.message || "", /active table or non-zero\/missing escrow/i);
    await tx`update public.poker_tables set status = 'CLOSED' where id = ${tableId};`;

    await expectSavepointError(tx, "archive_null_execute", () => tx.unsafe(
      "select public.chips_prune_committed_archive_batch($1, $2::uuid[], $3::bigint[], $4::boolean) as result;",
      [objectPath, transactionIds, entryIds, null],
    ), /execute flag must not be NULL/i);
    const nullExecuteState = await tx.unsafe(`select
      (select count(*) from public.chips_transactions where id = any($1::uuid[])) as hot_transactions,
      (select count(*) from public.chips_entries where id = any($2::bigint[])) as hot_entries,
      (select count(*) from public.chips_transaction_idempotency where transaction_id = any($1::uuid[]) and archive_batch_id is not null) as mappings,
      (select pruned_at from public.chips_ledger_archive_batches where batch_id = $3) as pruned_at;`,
      [transactionIds, entryIds, batchId]);
    assert.equal(Number(nullExecuteState[0].hot_transactions), 2, "NULL execute must not delete transactions");
    assert.equal(Number(nullExecuteState[0].hot_entries), 4, "NULL execute must not delete entries");
    assert.equal(Number(nullExecuteState[0].mappings), 0, "NULL execute must not create archive mappings");
    assert.equal(nullExecuteState[0].pruned_at, null, "NULL execute must not write a prune receipt");

    const dryRows = await tx.unsafe(
      "select public.chips_prune_committed_archive_batch($1, $2::uuid[], $3::bigint[], false) as result;",
      [objectPath, transactionIds, entryIds],
    );
    assert.equal(dryRows[0].result.state, "ready", "validated batch must be ready before DELETE");
    const executeRows = await tx.unsafe(
      "select public.chips_prune_committed_archive_batch($1, $2::uuid[], $3::bigint[], true) as result;",
      [objectPath, transactionIds, entryIds],
    );
    assert.equal(executeRows[0].result.state, "pruned", "real destructive function must pass through owner-role RLS");
    await tx.unsafe("set constraints all immediate;");
    const retryRows = await tx.unsafe(
      "select public.chips_prune_committed_archive_batch($1, $2::uuid[], $3::bigint[], true) as result;",
      [objectPath, transactionIds, entryIds],
    );
    assert.equal(retryRows[0].result.state, "already_pruned", "retry must not require deleted hot rows");

    const accountsAfter = await tx`
      select id, balance, next_entry_seq from public.chips_accounts
      where system_key in ('GENESIS', ${`POKER_TABLE:${tableId}`}) order by id;
    `;
    assert.deepEqual(accountsAfter, accountsBefore, "pruning must preserve balances and account sequences exactly");
    const receiptRows = await tx.unsafe(`select
      (select count(*) from public.chips_transactions where id = any($1::uuid[])) as hot_transactions,
      (select count(*) from public.chips_entries where id = any($2::bigint[])) as hot_entries,
      (select count(*) from public.chips_transaction_idempotency where transaction_id = any($1::uuid[]) and archive_batch_id = $3) as mappings,
      (select pruned_transaction_count from public.chips_ledger_archive_batches where batch_id = $3) as receipt_count;`,
      [transactionIds, entryIds, batchId]);
    assert.equal(Number(receiptRows[0].hot_transactions), 0);
    assert.equal(Number(receiptRows[0].hot_entries), 0);
    assert.equal(Number(receiptRows[0].mappings), 2);
    assert.equal(Number(receiptRows[0].receipt_count), 2);
    throw ROLLBACK;
  }).catch((error) => {
    if (error !== ROLLBACK) throw error;
  });
}

async function assertBuyInSequencing(sql, expectedTreasurySeq) {
  const { getUserBalance, listUserLedger } = await withLedger();
  const userId = primaryUserId;
  const ledger = await listUserLedger(userId, { limit: 10 });
  assert.ok(Array.isArray(ledger.items), "User ledger should return items after buy-in");
  assert.ok(ledger.items.length > 0, "User ledger should include entries after buy-in");

  const userBalance = await getUserBalance(userId);
  assert.equal(userBalance.nextEntrySeq, 2, "User next_entry_seq should advance after first entry");
  const treasurySeq = await accountNextSeq(sql, "TREASURY");
  assert.equal(treasurySeq, expectedTreasurySeq, "TREASURY next_entry_seq should advance as expected after buy-in");
  return { treasurySeq };
}

async function expectAtomicSequenceAllocation(sql, startingSeq) {
  const treasuryRows = await sql`
    select id, next_entry_seq
    from public.chips_accounts
    where account_type = 'SYSTEM'
      and system_key = 'TREASURY'
    limit 1;
  `;
  const treasuryId = treasuryRows?.[0]?.id;
  const beforeSeq = Number(treasuryRows?.[0]?.next_entry_seq || 0);
  assert.ok(treasuryId, "TREASURY account must exist before sequence allocation test");
  if (typeof startingSeq === "number") {
    assert.equal(beforeSeq, startingSeq, "TREASURY next_entry_seq should match expected starting value");
  }

  const seqKey = `sequence-${Date.now()}`;
  const seqHash = crypto.createHash("sha256").update(seqKey).digest("hex");

  const txIdRows = await sql`
    insert into public.chips_transactions (
      reference,
      description,
      metadata,
      idempotency_key,
      payload_hash,
      tx_type,
      created_by
    ) values (
      'sequence-check',
      'ensure atomic entry sequencing',
      '{}'::jsonb,
      ${seqKey},
      ${seqHash},
      'MINT',
      null
    )
    returning id;
  `;
  const txId = txIdRows?.[0]?.id;
  assert.ok(txId, "Sequence test requires a transaction id");

  let caught = null;
  try {
    await sql.begin(async (tx) => {
      await tx`
        insert into public.chips_entries (transaction_id, account_id, amount, metadata)
        select ${txId}, ${treasuryId}, v.amount, '{}'::jsonb
        from (values (1::bigint), (-1::bigint)) as v(amount);
      `;
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(!caught, `Sequence allocation should not throw (got ${caught?.code || caught?.message || "unknown"})`);

  const entries = await sql`
    select entry_seq
    from public.chips_entries
    where transaction_id = ${txId}
    order by entry_seq;
  `;
  const entrySeqs = entries.map((row) => Number(row.entry_seq || 0));
  assert.deepEqual(
    entrySeqs,
    [beforeSeq, beforeSeq + 1],
    "Multi-row insert must assign distinct, contiguous entry_seq values"
  );

  const afterSeq = await accountNextSeq(sql, "TREASURY");
  assert.equal(afterSeq, beforeSeq + 2, "TREASURY next_entry_seq should advance for each inserted entry");
  return afterSeq;
}

async function main() {
  const sql = postgres(dbUrl, { max: 1 });
  await dropAndRecreateSchema(sql);

  await runMigrations(sql, migrationsWithoutBootstrapSeeds);
  await ensureGenesisFixture(sql);
  await assertArchivePrunerRoleContracts(sql);
  await expectNegativeBalanceGuard(sql);
  await expectInsufficientBuyIn(sql);
  await expectInvalidMetadata(sql);
  await expectInvalidEntryMetadata(sql);
  await expectInvalidMetadataShape(sql);
  await expectInvalidEntryMetadataShape(sql);

  await runMigration(sql, seedMigration);
  await runMigration(sql, botBankrollMigration);
  await assertBotBankrollSeed(sql);
  await assertIdempotencyRegistryParity(sql);
  const afterSeed = await systemBalances(sql, "TREASURY");
  assert.ok(afterSeed >= seedAmount, "Treasury should be funded after seed migration");
  assert.equal(await seedTxCount(sql), 1, "Seed transaction should be recorded once");
  assert.equal(await seedEntryCount(sql), 2, "Seed transaction must insert exactly two entries");
  await assertSeedSequencing(sql);

  let expectedTreasuryBalance = afterSeed;
  let expectedTreasurySeq = await accountNextSeq(sql, "TREASURY");

  const idemReplay = await expectIdempotentReplaySamePayload(sql);
  expectedTreasuryBalance -= idemReplay.amountSpent;
  expectedTreasurySeq += idemReplay.treasurySeqDelta;

  const idemConflict = await expectIdempotentReplayDifferentPayload(sql);
  expectedTreasuryBalance -= idemConflict.amountSpent;
  expectedTreasurySeq += idemConflict.treasurySeqDelta;

  const crossConflict = await expectCrossUserIdempotencyConflict(sql);
  expectedTreasuryBalance -= crossConflict.amountSpent;
  expectedTreasurySeq += crossConflict.treasurySeqDelta;

  const buyInResult = await expectSuccessfulBuyIn(sql);
  expectedTreasuryBalance -= buyInResult.amountSpent;
  expectedTreasurySeq += buyInResult.treasurySeqDelta;

  const { treasurySeq } = await assertBuyInSequencing(sql, expectedTreasurySeq);
  expectedTreasurySeq = treasurySeq;

  const postSequenceTest = await expectAtomicSequenceAllocation(sql, expectedTreasurySeq);
  expectedTreasurySeq = postSequenceTest;
  await assertIdempotencyRegistryParity(sql);

  await runMigration(sql, seedMigration);
  assert.equal(await seedTxCount(sql), 1, "Seed transaction should stay idempotent");
  const afterRerun = await systemBalances(sql, "TREASURY");
  assert.equal(afterRerun, expectedTreasuryBalance, "Treasury balance should remain unchanged on rerun");
  assert.equal(await accountNextSeq(sql, "TREASURY"), expectedTreasurySeq, "TREASURY sequence should remain stable on rerun");
  assert.equal(await seedEntryCount(sql), 2, "Seed rerun must not add or drop entries");
  await runMigration(sql, botBankrollMigration);
  await assertBotBankrollSeed(sql);
  await runMigration(sql, idempotencyGapMigration);
  await assertIdempotencyRegistryParity(sql);

  await sql.end({ timeout: 5 });
  const adminModule = await import("../../netlify/functions/_shared/supabase-admin.mjs");
  if (adminModule?.closeSql) {
    await adminModule.closeSql();
  }
  console.log("Chips migration tests passed");
}

main().catch((error) => {
  console.error("Chips migration tests failed", error);
  process.exit(1);
});
