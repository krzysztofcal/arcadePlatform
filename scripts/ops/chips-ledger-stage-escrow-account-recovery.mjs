import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import {
  ACCOUNT_RECOVERY_MIME_TYPE,
  ACCOUNT_RETIREMENT_REGISTRY_SQL,
  assertAdvisoryLock,
  classifyRecoveryAccountSet,
  sha256Hex,
  verifyAccountRetirementReceipt,
  verifyAccountRecoveryBytes,
} from "./chips-ledger-stage-escrow-retention.mjs";
import {
  readPrivateObjectIfExists,
  resolveStorageTarget,
} from "./chips-ledger-archive-store.mjs";
import {
  STAGE_AUTOMATION_LOCK_KEY,
  STAGE_PROJECT_REF,
  STAGE_SYSTEM_IDENTIFIER,
  validateStageEnvironment,
} from "./chips-ledger-stage-automation.mjs";

const GO_PREFIX = "GO ";

function text(value) {
  return value == null ? "" : String(value).trim();
}

function fail(message) {
  throw new Error(message);
}

function recoveryObjectPathForBytes(bytes) {
  return `account-recovery/v1/sha256/${sha256Hex(bytes)}.json.gz`;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { file: null, objectPath: null, dbUrl: null, restore: false, execute: false, goAccountId: null, confirmation: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--file" || token === "--object-path" || token === "--db-url" || token === "--go-account-id" || token === "--confirmation") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${token} requires a value`);
      const key = token === "--file"
        ? "file"
        : token === "--object-path"
          ? "objectPath"
          : token === "--db-url"
            ? "dbUrl"
            : token === "--go-account-id"
              ? "goAccountId"
              : "confirmation";
      if (args[key] !== null) fail(`${token} was supplied more than once`);
      args[key] = value;
      index += 1;
    } else if (token === "--restore" || token === "--execute") {
      args[token.slice(2)] = true;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      fail(`unknown recovery verifier option: ${token}`);
    }
  }
  if (!args.file && !args.objectPath && !args.help) fail("--file or --object-path is required");
  if (args.restore && (!args.execute || !args.goAccountId || args.confirmation !== `${GO_PREFIX}${args.goAccountId}`)) {
    fail("restore requires --execute, --go-account-id and exact GO <account_id> confirmation");
  }
  if (!args.restore && (args.execute || args.goAccountId || args.confirmation)) {
    fail("--execute/--go-account-id/--confirmation are only valid with --restore");
  }
  return args;
}

async function loadRecovery(args, env) {
  if (args.file) {
    const bytes = await fs.readFile(path.resolve(args.file));
    return {
      bytes,
      objectPath: args.objectPath || recoveryObjectPathForBytes(bytes),
      dbUrl: args.dbUrl || env.CHIPS_LEDGER_ESCROW_RECOVERY_DB_URL || env.CHIPS_MIGRATIONS_TEST_DB_URL || null,
    };
  }
  const config = validateStageEnvironment(env, { requireCommitSha: true });
  const storageTarget = resolveStorageTarget("stage", {
    EXPECTED_SUPABASE_STAGE_PROJECT_REF: STAGE_PROJECT_REF,
    SUPABASE_STAGE_DB_URL: config.dbUrl,
    SUPABASE_URL: config.apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: config.serviceKey,
    SUPABASE_EXPECTED_STAGE_PROJECT_REF: STAGE_PROJECT_REF,
  }, { singleTarget: true });
  const object = await readPrivateObjectIfExists(storageTarget, args.objectPath);
  if (!object) fail(`recovery object does not exist: ${args.objectPath}`);
  return { bytes: object.bytes, objectPath: args.objectPath, storageTarget, config, dbUrl: config.dbUrl };
}

function assertAccountShape(account) {
  if (!account || typeof account !== "object" || account.account_type !== "ESCROW"
    || account.user_id !== null || account.status !== "active"
    || !/^POKER_TABLE:[0-9a-f-]{36}$/i.test(account.system_key)) {
    fail("recovery account is not an exact active canonical ESCROW account");
  }
}

export async function verifyRecoveryObject({ bytes, objectPath, expectedAccountIds = null } = {}) {
  return verifyAccountRecoveryBytes({
    bytes,
    objectPath,
    mimeType: ACCOUNT_RECOVERY_MIME_TYPE,
    expectedAccountIds,
  });
}

export async function restoreAccountBatch({ recovery, args, config, env, postgresImpl = postgres }) {
  if (env.CHIPS_LEDGER_ESCROW_RECOVERY_RESTORE_EXECUTE !== "1") {
    fail("restore requires CHIPS_LEDGER_ESCROW_RECOVERY_RESTORE_EXECUTE=1");
  }
  if (recovery.parsed.postgres_system_identifier !== STAGE_SYSTEM_IDENTIFIER
    || recovery.parsed.project_ref !== STAGE_PROJECT_REF) {
    fail("recovery object is not bound to canonical Stage");
  }
  const accounts = [...recovery.parsed.accounts].sort((left, right) => text(left.id).localeCompare(text(right.id)));
  const accountIds = accounts.map((item) => item.id);
  const tableIds = [...recovery.parsed.archive_batch.table_ids];
  const account = accounts.find((item) => item.id === text(args.goAccountId).toLowerCase());
  if (!account) fail("GO account ID is not present in the recovery object");
  for (const item of accounts) assertAccountShape(item);
  const pool = postgresImpl(config.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 0, max_lifetime: 0 });
  const sql = typeof pool.reserve === "function" ? await pool.reserve() : pool;
  let lockHeld = false;
  let lockBackendPid = null;
  try {
    const lockRows = await sql.unsafe("select pg_catalog.pg_backend_pid()::text as backend_pid, pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended($1, 0)) as acquired;", [STAGE_AUTOMATION_LOCK_KEY]);
    if (!(lockRows[0]?.acquired === true || lockRows[0]?.acquired === "t")) fail("restore could not acquire the Stage advisory lock");
    lockHeld = true;
    lockBackendPid = text(lockRows[0]?.backend_pid);
    await assertAdvisoryLock(sql, { backendPid: lockBackendPid }, {
      phase: "recovery",
      batchId: recovery.parsed.archive_batch.batch_id,
      attempt: 1,
      telemetry: false,
    });
    return await sql.begin(async (tx) => {
      await tx.unsafe("set transaction isolation level serializable;");
      const identityRows = await tx.unsafe("select system_identifier::text as system_identifier from pg_catalog.pg_control_system();");
      if (text(identityRows[0]?.system_identifier) !== STAGE_SYSTEM_IDENTIFIER) fail("restore database is not canonical Stage");
      const fenceRows = await tx.unsafe("select public.chips_table_fence_is_active() as active;");
      if (!(fenceRows[0]?.active === true || fenceRows[0]?.active === "t")) fail("restore requires the active TABLE fence");
      const tableRows = await tx.unsafe("select id::text as id from public.poker_tables where id = any($1::uuid[]) order by id;", [tableIds]);
      if (tableRows.length) fail("restore is blocked while the poker table exists");
      const entryRows = await tx.unsafe("select 1 from public.chips_entries where account_id = any($1::uuid[]) limit 1;", [accountIds]);
      const snapshotRows = await tx.unsafe("select 1 from public.chips_account_snapshot where account_id = any($1::uuid[]) limit 1;", [accountIds]);
      if (entryRows.length || snapshotRows.length) fail("restore is blocked by hot entries or an account snapshot");
      const registryRows = await tx.unsafe(ACCOUNT_RETIREMENT_REGISTRY_SQL, [recovery.parsed.archive_batch.batch_id, tableIds]);
      if (Number(registryRows[0]?.registry_count || 0) !== 0) fail("restore is blocked by surviving idempotency/table mappings");
      const existing = await tx.unsafe("select id::text as id, user_id::text as user_id, system_key, account_type::text as account_type, status::text as status, label, balance::text as balance, next_entry_seq::text as next_entry_seq, created_at::text as created_at, updated_at::text as updated_at from public.chips_accounts where id = any($1::uuid[]) order by id;", [accountIds]);
      const accountSet = classifyRecoveryAccountSet(existing, accounts);
      if (accountSet.state === "conflict") fail("existing account conflicts with recovery snapshot");
      if (accountSet.state === "identical") {
        return { state: "already_present", account_ids: accountIds, account_count: accountIds.length, repaired_existing_accounts: 0 };
      }
      const existingIds = new Set(existing.map((item) => text(item.id).toLowerCase()));
      const keyConflict = await tx.unsafe("select id::text as id from public.chips_accounts where system_key = any($1::text[]) and not (id = any($2::uuid[]));", [accounts.map((item) => item.system_key), accountIds]);
      if (keyConflict.length) fail("restore is blocked by an account with the same system key");
      for (const item of accounts) {
        if (existingIds.has(item.id)) continue;
        await tx.unsafe("insert into public.chips_accounts (id, user_id, system_key, account_type, status, label, balance, next_entry_seq, created_at, updated_at) values ($1::uuid, $2::uuid, $3::text, $4::public.chips_account_type, $5::public.chips_account_status, $6::text, $7::bigint, $8::bigint, $9::timestamptz, $10::timestamptz);", [
          item.id, item.user_id, item.system_key, item.account_type, item.status,
          item.label, item.balance, item.next_entry_seq, item.created_at, item.updated_at,
        ]);
      }
      const inserted = await tx.unsafe("select id::text as id, user_id::text as user_id, system_key, account_type::text as account_type, status::text as status, label, balance::text as balance, next_entry_seq::text as next_entry_seq, created_at::text as created_at, updated_at::text as updated_at from public.chips_accounts where id = any($1::uuid[]) order by id;", [accountIds]);
      const restoredSet = classifyRecoveryAccountSet(inserted, accounts);
      if (restoredSet.state !== "identical") fail("restored account set does not match recovery snapshot");
      return {
        state: "restored",
        account_ids: accountIds,
        account_count: accountIds.length,
        repaired_existing_accounts: accountSet.state === "partial" ? existing.length : 0,
      };
    });
  } finally {
    if (lockHeld) {
      try {
        await assertAdvisoryLock(sql, { backendPid: lockBackendPid }, {
          phase: "recovery",
          batchId: recovery.parsed.archive_batch.batch_id,
          attempt: 1,
          telemetry: false,
        });
        await sql.unsafe("select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1, 0));", [STAGE_AUTOMATION_LOCK_KEY]);
      } catch { /* session close below is authoritative */ }
    }
    if (sql !== pool && typeof sql.release === "function") {
      try { await sql.release(); } catch { /* pool close below is authoritative */ }
    }
    await pool.end({ timeout: 5 });
  }
}

export async function runRecoveryVerifier({ argv = process.argv.slice(2), env = process.env } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    return "Usage: node scripts/ops/chips-ledger-stage-escrow-account-recovery.mjs --file <path> [--object-path <content-addressed-path>] | --object-path <content-addressed-path> [--db-url <read-only-url>] [--restore --execute --go-account-id <uuid> --confirmation 'GO <uuid>']";
  }
  const recoverySource = await loadRecovery(args, env);
  const recovery = await verifyRecoveryObject({
    bytes: recoverySource.bytes,
    objectPath: recoverySource.objectPath,
  });
  let receipt = { state: "not_checked", reason: "read-only database URL was not supplied" };
  if (recoverySource.dbUrl) {
    const receiptSql = postgres(recoverySource.dbUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 0,
      max_lifetime: 0,
    });
    try {
      receipt = await verifyAccountRetirementReceipt({ sql: receiptSql, recovery });
    } finally {
      await receiptSql.end({ timeout: 5 });
    }
  } else if (args.restore) {
    fail("restore requires a read-only database URL to verify the retirement receipt");
  }
  const result = args.restore
    ? await restoreAccountBatch({ recovery, args, config: recoverySource.config || validateStageEnvironment(env, { requireCommitSha: true }), env })
    : {
      state: "verified",
      object_path: recovery.objectPath,
      account_ids: recovery.parsed.account_ids,
      account_snapshot_sha256: recovery.snapshotSha256,
      receipt_state: receipt.state,
      receipt_account_state: receipt.account_state || null,
      storage_read_only: true,
      database_read_only: recoverySource.dbUrl ? true : null,
    };
  process.stdout.write(`${JSON.stringify({ event: "chips_ledger_stage_escrow_account_recovery", ...result })}\n`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRecoveryVerifier().catch((error) => {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
