import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const dbUrl = process.env.CHIPS_MIGRATIONS_TEST_DB_URL;
const allowDrop = process.env.CHIPS_MIGRATIONS_ALLOW_DROP === "1";

if (!dbUrl) {
  console.log("Skipping chips migration tests: CHIPS_MIGRATIONS_TEST_DB_URL not set.");
  process.exit(0);
}

process.env.SUPABASE_DB_URL = dbUrl;

const seedKey = "seed:treasury:v1";
const seedAmount = 1000000;
const primaryUserId = "00000000-0000-0000-0000-000000000001";
const idempotentUserId = "00000000-0000-0000-0000-000000000002";
const conflictUserId = "00000000-0000-0000-0000-000000000003";
const crossUserId = "00000000-0000-0000-0000-000000000004";
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
const migrationsWithoutSeed = migrationFiles.filter((file) => file !== seedMigration);

const runMigration = async (sql, file) => {
  const content = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  await sql.unsafe(content);
};

const runMigrations = async (sql, files) => {
  for (const file of files) {
    await runMigration(sql, file);
  }
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
      and system_key in ('GENESIS', 'TREASURY');
  `;
  const seqByKey = new Map(accountRows.map((row) => [row.system_key, Number(row.next_entry_seq || 0)]));
  assert.equal(seqByKey.get("GENESIS"), 2, "GENESIS next_entry_seq should advance after seed entry");
  assert.equal(seqByKey.get("TREASURY"), 2, "TREASURY next_entry_seq should advance after seed entry");
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

  await runMigrations(sql, migrationsWithoutSeed);
  await expectNegativeBalanceGuard(sql);
  await expectInsufficientBuyIn(sql);
  await expectInvalidMetadata(sql);
  await expectInvalidEntryMetadata(sql);
  await expectInvalidMetadataShape(sql);
  await expectInvalidEntryMetadataShape(sql);

  await runMigration(sql, seedMigration);
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

  await runMigration(sql, seedMigration);
  assert.equal(await seedTxCount(sql), 1, "Seed transaction should stay idempotent");
  const afterRerun = await systemBalances(sql, "TREASURY");
  assert.equal(afterRerun, expectedTreasuryBalance, "Treasury balance should remain unchanged on rerun");
  assert.equal(await accountNextSeq(sql, "TREASURY"), expectedTreasurySeq, "TREASURY sequence should remain stable on rerun");
  assert.equal(await seedEntryCount(sql), 2, "Seed rerun must not add or drop entries");

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
