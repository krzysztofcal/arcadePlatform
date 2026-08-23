import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const dbUrl = process.env.CHIPS_MIGRATIONS_TEST_DB_URL;

if (!dbUrl) {
  console.log("Skipping TABLE metadata fence regression tests: CHIPS_MIGRATIONS_TEST_DB_URL not set.");
  process.exit(0);
}

process.env.SUPABASE_DB_URL = dbUrl;

const ROLLBACK = new Error("table-metadata-fence-test-rollback");

const netlifyLedger = await import("../../netlify/functions/_shared/chips-ledger.mjs");
const wsLedger = await import("../../ws-server/poker/persistence/chips-ledger.mjs");
const db = postgres(dbUrl, { max: 1, idle_timeout: 5 });

function legacyMetadata(tableId) {
  return JSON.stringify({ tableId });
}

function keyFor(kind, tableId, suffix) {
  if (kind === "cashout") return `poker:bot-terminal-cashout:v1:${tableId}:${suffix}`;
  return `bot-seed-buyin:${tableId}:${suffix}`;
}

function referenceFor(kind, tableId) {
  if (kind === "cashout") return `table:${tableId}`;
  return `BOT_SEED_BUY_IN:${tableId}:1`;
}

function tableEntries(fixture, kind, metadata) {
  const buyIn = kind === "buyin";
  return [
    {
      accountType: "SYSTEM",
      systemKey: fixture.fundingKey,
      amount: buyIn ? -100 : 100,
      metadata,
    },
    {
      accountType: "ESCROW",
      systemKey: fixture.escrowKey,
      amount: buyIn ? 100 : -100,
      metadata,
    },
  ];
}

function tablePayload(fixture, kind, metadata, suffix) {
  const txType = kind === "cashout" ? "TABLE_CASH_OUT" : "TABLE_BUY_IN";
  return {
    userId: null,
    txType,
    idempotencyKey: keyFor(kind, fixture.tableId, suffix),
    reference: referenceFor(kind, fixture.tableId),
    metadata,
    entries: tableEntries(fixture, kind, metadata),
    createdBy: fixture.createdBy,
  };
}

async function setFence(active) {
  await db.unsafe("select public.chips_set_table_fence_active($1::boolean);", [active]);
}

async function createFixture() {
  const tableId = randomUUID();
  const fundingAccountId = randomUUID();
  const escrowAccountId = randomUUID();
  const fundingKey = `TABLE_METADATA_TEST:${tableId}`;
  const escrowKey = `POKER_TABLE:${tableId}`;
  const createdBy = randomUUID();
  await db.unsafe(`
    insert into public.poker_tables (id, status, has_human_participant, bot_only_proof_eligible)
    values ($1::uuid, 'OPEN', false, true);
  `, [tableId]);
  await db.unsafe(`
    insert into public.chips_accounts (id, account_type, system_key, status, balance)
    values ($1::uuid, 'SYSTEM', $2, 'active', 1000);
  `, [fundingAccountId, fundingKey]);
  await db.unsafe(`
    insert into public.chips_accounts (id, account_type, system_key, status, balance)
    values ($1::uuid, 'ESCROW', $2, 'active', 0);
  `, [escrowAccountId, escrowKey]);
  return {
    tableId,
    fundingAccountId,
    fundingKey,
    escrowAccountId,
    escrowKey,
    createdBy,
  };
}

async function snapshot(tx, fixture, idempotencyKey) {
  const accounts = await tx.unsafe(`
    select id::text, balance::text, next_entry_seq::text
      from public.chips_accounts
     where id = any($1::uuid[])
     order by id;
  `, [[fixture.fundingAccountId, fixture.escrowAccountId]]);
  const rows = await tx.unsafe(`
    select
      (select count(*) from public.chips_transactions where idempotency_key = $1) as transactions,
      (select count(*) from public.chips_entries where transaction_id in (
        select id from public.chips_transactions where idempotency_key = $1
      )) as entries,
      (select count(*) from public.chips_transaction_idempotency where idempotency_key = $1) as registry_rows;
  `, [idempotencyKey]);
  return {
    accounts,
    transactions: Number(rows[0].transactions),
    entries: Number(rows[0].entries),
    registryRows: Number(rows[0].registry_rows),
  };
}

async function expectRejectedWithoutEffects(fixture, label, operation, {
  idempotencyKey,
  code,
  message,
}) {
  let observed = null;
  await db.begin(async (tx) => {
    const before = await snapshot(tx, fixture, idempotencyKey);
    await tx.unsafe("savepoint table_metadata_fence_attempt;");
    let caught = null;
    try {
      await operation(tx);
      await tx.unsafe("set constraints all immediate;");
    } catch (error) {
      caught = error;
    }
    observed = caught;
    await tx.unsafe("rollback to savepoint table_metadata_fence_attempt;");
    await tx.unsafe("release savepoint table_metadata_fence_attempt;");

    assert.ok(caught, `${label}: operation must fail closed`);
    assert.equal(caught.code, code, `${label}: error code`);
    if (message) assert.match(caught.message || "", message, `${label}: error message`);

    const after = await snapshot(tx, fixture, idempotencyKey);
    assert.deepEqual(after, before, `${label}: transaction, entries, registry and account state must be unchanged`);
    throw ROLLBACK;
  }).catch((error) => {
    if (error !== ROLLBACK) throw error;
  });
  return observed;
}

async function insertDirectTransaction(tx, fixture, {
  transactionId,
  idempotencyKey,
  metadataSql,
  metadataValue,
  entryMetadataSql = "'{}'::jsonb",
  entryMetadataValue = null,
}) {
  const reference = referenceFor("buyin", fixture.tableId);
  await tx.unsafe(`
    insert into public.chips_transactions
      (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id)
    values ($1::uuid, $2, ${metadataSql}, $4, $5, 'TABLE_BUY_IN', null);
  `, [transactionId, reference, metadataValue, idempotencyKey, "a".repeat(64)]);

  await tx.unsafe(`
    insert into public.chips_entries (transaction_id, account_id, amount, metadata)
    values
      ($1::uuid, $2::uuid, -100, ${entryMetadataSql}),
      ($1::uuid, $3::uuid, 100, ${entryMetadataSql});
  `, [transactionId, fixture.fundingAccountId, fixture.escrowAccountId, entryMetadataValue]);
}

async function assertObjectMetadata(transactionId, tableId) {
  const rows = await db.unsafe(`
    select
      jsonb_typeof(t.metadata) as transaction_metadata_type,
      t.metadata as transaction_metadata,
      jsonb_agg(jsonb_typeof(e.metadata) order by e.id) as entry_metadata_types
      from public.chips_transactions t
      join public.chips_entries e on e.transaction_id = t.id
     where t.id = $1::uuid
     group by t.metadata;
  `, [transactionId]);
  assert.equal(rows.length, 1, "metadata regression transaction must exist");
  assert.equal(rows[0].transaction_metadata_type, "object", "transaction metadata must be JSONB object");
  assert.deepEqual(rows[0].transaction_metadata, { tableId });
  assert.deepEqual(rows[0].entry_metadata_types, ["object", "object"], "entry metadata must be JSONB objects");
}

async function validProducerContract(fixture) {
  const netlifyBuy = tablePayload(fixture, "buyin", { tableId: fixture.tableId }, `netlify-${randomUUID()}`);
  const netlifyResult = await db.begin((tx) => netlifyLedger.postTransaction({ ...netlifyBuy, tx }));
  assert.equal(netlifyResult.transaction.tx_type, "TABLE_BUY_IN", "Netlify TABLE_BUY_IN should pass");
  await assertObjectMetadata(netlifyResult.transaction.id, fixture.tableId);

  const wsBuy = tablePayload(fixture, "buyin", { tableId: fixture.tableId }, `ws-${randomUUID()}`);
  const wsResult = await db.begin((tx) => wsLedger.postTransaction({ ...wsBuy, tx }));
  assert.equal(wsResult.transaction.tx_type, "TABLE_BUY_IN", "WS TABLE_BUY_IN should pass");
  await assertObjectMetadata(wsResult.transaction.id, fixture.tableId);

  const netlifyCashout = tablePayload(fixture, "cashout", { tableId: fixture.tableId }, `netlify-${randomUUID()}`);
  const cashoutResult = await db.begin((tx) => netlifyLedger.postTransaction({ ...netlifyCashout, tx }));
  assert.equal(cashoutResult.transaction.tx_type, "TABLE_CASH_OUT", "Netlify TABLE_CASH_OUT should pass");
  await assertObjectMetadata(cashoutResult.transaction.id, fixture.tableId);

  const balances = await db.unsafe(`
    select system_key, balance::text
      from public.chips_accounts
     where id = any($1::uuid[])
     order by id;
  `, [[fixture.fundingAccountId, fixture.escrowAccountId]]);
  assert.deepEqual(
    Object.fromEntries(balances.map((row) => [row.system_key, row.balance])),
    { [fixture.fundingKey]: "900", [fixture.escrowKey]: "100" },
    "valid buy-in and cash-out producers must apply their balanced fixture deltas",
  );
}

async function netlifyWrongMetadataContract(fixture) {
  const payload = tablePayload(
    fixture,
    "buyin",
    { tableId: randomUUID() },
    `netlify-wrong-${randomUUID()}`,
  );
  const caught = await expectRejectedWithoutEffects(fixture, "Netlify substituted metadata.tableId", async (tx) => {
    await netlifyLedger.postTransaction({ ...payload, tx });
  }, {
    idempotencyKey: payload.idempotencyKey,
    code: "invalid_table_binding",
    message: /TABLE idempotency key or binding is invalid/,
  });
  assert.equal(caught?.cause?.code, "P8902", "Netlify must preserve the database P8902 cause");
}

async function directSqlMetadataContracts(fixture) {
  const wrongTableId = randomUUID();
  const wrongTransactionId = randomUUID();
  const wrongKey = keyFor("buyin", fixture.tableId, `legacy-wrong-${randomUUID()}`);
  await expectRejectedWithoutEffects(fixture, "legacy JSONB string with substituted tableId", async (tx) => {
    await insertDirectTransaction(tx, fixture, {
      transactionId: wrongTransactionId,
      idempotencyKey: wrongKey,
      metadataSql: "to_jsonb($3::text)",
      metadataValue: legacyMetadata(wrongTableId),
    });
  }, {
    transactionId: wrongTransactionId,
    idempotencyKey: wrongKey,
    code: "P8902",
    message: /metadata\.tableId/,
  });

  const wrongEntryTransactionId = randomUUID();
  const wrongEntryKey = keyFor("buyin", fixture.tableId, `entry-legacy-wrong-${randomUUID()}`);
  await expectRejectedWithoutEffects(fixture, "entry JSONB string with substituted tableId", async (tx) => {
    await insertDirectTransaction(tx, fixture, {
      transactionId: wrongEntryTransactionId,
      idempotencyKey: wrongEntryKey,
      metadataSql: "$3::jsonb",
      metadataValue: JSON.stringify({ tableId: fixture.tableId }),
      entryMetadataSql: "to_jsonb($4::text)",
      entryMetadataValue: legacyMetadata(wrongTableId),
    });
  }, {
    transactionId: wrongEntryTransactionId,
    idempotencyKey: wrongEntryKey,
    code: "P8904",
    message: /authoritative ESCROW table/,
  });

  const invalidMetadataCases = [
    ["malformed legacy string", "to_jsonb($3::text)", "{\"tableId\":"],
    ["legacy scalar", "to_jsonb($3::text)", "42"],
    ["legacy array", "to_jsonb($3::text)", "[]"],
    ["native scalar", "$3::jsonb", "42"],
    ["native array", "$3::jsonb", "[]"],
  ];
  for (const [label, metadataSql, metadataValue] of invalidMetadataCases) {
    const transactionId = randomUUID();
    const idempotencyKey = keyFor("buyin", fixture.tableId, `${label.replaceAll(" ", "-")}-${randomUUID()}`);
    await expectRejectedWithoutEffects(fixture, label, async (tx) => {
      await insertDirectTransaction(tx, fixture, {
        transactionId,
        idempotencyKey,
        metadataSql,
        metadataValue,
      });
    }, {
      transactionId,
      idempotencyKey,
      code: "P8902",
      message: /TABLE metadata/,
    });
  }

  const validLegacyTransactionId = randomUUID();
  const validLegacyKey = keyFor("buyin", fixture.tableId, `legacy-valid-${randomUUID()}`);
  await db.begin(async (tx) => {
    await insertDirectTransaction(tx, fixture, {
      transactionId: validLegacyTransactionId,
      idempotencyKey: validLegacyKey,
      metadataSql: "to_jsonb($3::text)",
      metadataValue: legacyMetadata(fixture.tableId),
      entryMetadataSql: "to_jsonb($4::text)",
      entryMetadataValue: legacyMetadata(fixture.tableId),
    });
    await tx.unsafe("set constraints all immediate;");
  });
  const legacyRows = await db.unsafe(`
    select
      jsonb_typeof(t.metadata) as transaction_metadata_type,
      jsonb_agg(jsonb_typeof(e.metadata) order by e.id) as entry_metadata_types
      from public.chips_transactions t
      join public.chips_entries e on e.transaction_id = t.id
     where t.id = $1::uuid
     group by t.metadata;
  `, [validLegacyTransactionId]);
  assert.deepEqual(legacyRows[0], {
    transaction_metadata_type: "string",
    entry_metadata_types: ["string", "string"],
  }, "a valid legacy JSONB string must remain accepted for both tables");
}

async function main() {
  const databaseRows = await db`select current_database() as name;`;
  assert.ok(/(?:_test|reset_contract)$/i.test(databaseRows[0]?.name || ""), "metadata fence tests require a disposable database");

  await setFence(false);
  const fixture = await createFixture();
  await setFence(true);
  try {
    await validProducerContract(fixture);
    await netlifyWrongMetadataContract(fixture);
    await directSqlMetadataContracts(fixture);
  } finally {
    await setFence(false);
    await db.end({ timeout: 5 });
    const adminModule = await import("../../netlify/functions/_shared/supabase-admin.mjs");
    if (adminModule?.closeSql) await adminModule.closeSql();
  }
  console.log("TABLE metadata fence regression tests passed");
}

main().catch(async (error) => {
  console.error("TABLE metadata fence regression tests failed", error);
  await db.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
