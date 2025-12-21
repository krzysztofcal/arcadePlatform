import assert from "node:assert/strict";
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
  const rows = await sql`select balance from public.chips_accounts where system_key = ${key} limit 1;`;
  return Number(rows?.[0]?.balance ?? 0);
};

const accountNextSeq = async (sql, key) => {
  const rows = await sql`select next_entry_seq from public.chips_accounts where system_key = ${key} limit 1;`;
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
  await sql
    .begin(async (tx) => {
      await tx`update public.chips_accounts set balance = -1 where system_key = 'GENESIS' and account_type = 'SYSTEM';`;
      const genesisAfter = await systemBalances(tx, "GENESIS");
      assert.equal(genesisAfter, -1, "GENESIS should be allowed to go negative");
      throw new Error("rollback");
    })
    .catch((error) => {
      if (error?.message !== "rollback") {
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
      userId: "00000000-0000-0000-0000-000000000001",
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
  }
}

async function expectSuccessfulBuyIn(sql) {
  const { postTransaction, getUserBalance } = await withLedger();
  const key = `buyin-ok-${Date.now()}`;
  const result = await postTransaction({
    userId: "00000000-0000-0000-0000-000000000001",
    txType: "BUY_IN",
    idempotencyKey: key,
    entries: [
      { accountType: "USER", amount: 25 },
      { accountType: "SYSTEM", systemKey: "TREASURY", amount: -25 },
    ],
    createdBy: null,
  });
  assert.ok(result?.transaction?.id, "BUY_IN should record a transaction");
  const balance = await getUserBalance("00000000-0000-0000-0000-000000000001");
  assert.equal(balance.balance, 25, "User balance should increase by BUY_IN amount");
  const treasury = await systemBalances(sql, "TREASURY");
  assert.equal(treasury, seedAmount - 25, "Treasury should decrease by buy-in amount");
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
    where system_key in ('GENESIS', 'TREASURY');
  `;
  const seqByKey = new Map(accountRows.map((row) => [row.system_key, Number(row.next_entry_seq || 0)]));
  assert.equal(seqByKey.get("GENESIS"), 2, "GENESIS next_entry_seq should advance after seed entry");
  assert.equal(seqByKey.get("TREASURY"), 2, "TREASURY next_entry_seq should advance after seed entry");
}

async function assertBuyInSequencing(sql) {
  const { getUserBalance, listUserLedger } = await withLedger();
  const userId = "00000000-0000-0000-0000-000000000001";
  const ledger = await listUserLedger(userId, { limit: 10 });
  assert.ok(ledger.sequenceOk, "User ledger sequence should remain contiguous after buy-in");

  const userBalance = await getUserBalance(userId);
  assert.equal(userBalance.nextEntrySeq, 2, "User next_entry_seq should advance after first entry");
  assert.equal(await accountNextSeq(sql, "TREASURY"), 3, "TREASURY next_entry_seq should advance again after buy-in");
}

async function main() {
  const sql = postgres(dbUrl, { max: 1 });
  await dropAndRecreateSchema(sql);

  await runMigrations(sql, migrationsWithoutSeed);
  await expectNegativeBalanceGuard(sql);
  await expectInsufficientBuyIn(sql);

  await runMigration(sql, seedMigration);
  const afterSeed = await systemBalances(sql, "TREASURY");
  assert.ok(afterSeed >= seedAmount, "Treasury should be funded after seed migration");
  assert.equal(await seedTxCount(sql), 1, "Seed transaction should be recorded once");
  assert.equal(await seedEntryCount(sql), 2, "Seed transaction must insert exactly two entries");
  await assertSeedSequencing(sql);

  await expectSuccessfulBuyIn(sql);
  await assertBuyInSequencing(sql);

  await runMigration(sql, seedMigration);
  assert.equal(await seedTxCount(sql), 1, "Seed transaction should stay idempotent");
  const afterRerun = await systemBalances(sql, "TREASURY");
  assert.equal(afterRerun, seedAmount - 25, "Treasury balance should not change on rerun");
  assert.equal(await accountNextSeq(sql, "TREASURY"), 3, "TREASURY sequence should remain stable on rerun");
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
