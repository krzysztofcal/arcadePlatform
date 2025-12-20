import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const dbUrl = process.env.CHIPS_MIGRATIONS_TEST_DB_URL;

if (!dbUrl) {
  console.log("Skipping chips migration tests: CHIPS_MIGRATIONS_TEST_DB_URL not set.");
  process.exit(0);
}

process.env.SUPABASE_DB_URL = dbUrl;

const seedKey = "seed:treasury:v1";
const seedAmount = 1000000;
const systemBalances = async (sql, key) => {
  const rows = await sql`select balance from public.chips_accounts where system_key = ${key} limit 1;`;
  return Number(rows?.[0]?.balance ?? 0);
};

const seedTxCount = async (sql) => {
  const rows = await sql`select count(*) as count from public.chips_transactions where idempotency_key = ${seedKey};`;
  return Number(rows?.[0]?.count ?? 0);
};

const dropAndRecreateSchema = async (sql) => {
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

async function main() {
  const sql = postgres(dbUrl, { max: 1 });
  await dropAndRecreateSchema(sql);

  await runMigrations(sql, migrationsWithoutSeed);
  await expectInsufficientBuyIn(sql);

  await runMigration(sql, seedMigration);
  const afterSeed = await systemBalances(sql, "TREASURY");
  assert.ok(afterSeed >= seedAmount, "Treasury should be funded after seed migration");
  assert.equal(await seedTxCount(sql), 1, "Seed transaction should be recorded once");

  await expectSuccessfulBuyIn(sql);

  await runMigration(sql, seedMigration);
  assert.equal(await seedTxCount(sql), 1, "Seed transaction should stay idempotent");
  const afterRerun = await systemBalances(sql, "TREASURY");
  assert.equal(afterRerun, seedAmount - 25, "Treasury balance should not change on rerun");

  await sql.end({ timeout: 5 });
  console.log("Chips migration tests passed");
}

main().catch((error) => {
  console.error("Chips migration tests failed", error);
  process.exit(1);
});
