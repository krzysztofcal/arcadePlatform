import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  acquireRetentionAdvisoryLock,
  assertRetentionAdvisoryLock,
  releaseRetentionAdvisoryLock,
} from "./_shared/chips-ledger-retention-cycle.mjs";
import { validateRetentionEnvironment } from "./_shared/chips-ledger-retention-profile.mjs";
import {
  buildRecoveryArchiveObjectPath,
  buildRecoveryManifestObjectPath,
  deletePrivateObjectIfExists,
  resolveStorageTarget,
  verifyArchiveBucket,
} from "./chips-ledger-archive-store.mjs";

// #1157: 12-month cap for settled user-linked history. Expires old ledger
// archive objects (DELETE only, never a download) and runs the bounded SQL
// cleanup of small user-linked tables. Dark unless the DB control is enabled
// or an exact archive canary is confirmed.

export const SETTLED_RETENTION_MODES = Object.freeze(["diagnostic", "canary", "automatic"]);
export const AUTOMATIC_BATCH_LIMIT = 10;
export const TABLE_ROW_LIMIT = 5000;
const OWNER = "krzysztofcal";

function text(value) {
  return value == null ? "" : String(value).trim();
}

function fail(message) {
  throw new Error(message);
}

function klog(event, data) {
  process.stdout.write(`${JSON.stringify({ event, ...data })}\n`);
}

// Same selection as public.chips_expire_archive_batch, which rechecks it under
// the row lock; only metadata rows are read.
const CANDIDATES_SQL = `select b.batch_id::text as batch_id, b.object_path, b.compressed_sha256,
    b.account_retirement_recovery_object_path
  from public.chips_ledger_archive_batches b
  where b.project_ref = $1 and b.status = 'committed' and b.pruned_at is not null and b.objects_expired_at is null
    and b.last_created_at < public.chips_settled_retention_cutoff($2::timestamptz)
    and not (b.bot_only_table_id is not null and b.account_retirement_at is null)
    and not (b.source_policy_id in ('stage-ledger-closed-human-table-retention-30d-v1', 'production-ledger-closed-human-table-retention-30d-v1')
      and exists (select 1 from public.chips_transaction_idempotency r join public.poker_tables t on t.id = r.table_id
        where r.archive_batch_id = b.batch_id))
    and ($3::bigint is null or b.batch_id = $3::bigint)
  order by b.last_created_at, b.batch_id
  limit $4;`;

export function parseSettledRetentionArgs(argv = process.argv.slice(2)) {
  const args = {};
  const valueArgs = new Map([
    ["--target", "target"],
    ["--mode", "mode"],
    ["--batch-id", "batchId"],
    ["--confirmation", "confirmation"],
    ["--cutoff", "cutoff"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = valueArgs.get(argv[index]);
    if (!key || args[key] !== undefined) fail(`unknown or repeated argument: ${argv[index]}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${argv[index]} requires a value`);
    args[key] = value;
    index += 1;
  }
  if (args.target !== "stage" && args.target !== "production") fail("--target must be stage or production");
  if (!SETTLED_RETENTION_MODES.includes(args.mode)) fail("--mode must be diagnostic, canary or automatic");
  return args;
}

export function requireSettledRetentionAuthorization({ target, mode, batchId = null, confirmation = null, cutoff = null, env }) {
  if (cutoff != null && (target !== "stage" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(cutoff))) {
    fail("a cutoff override is a Stage-only UTC ISO timestamp");
  }
  if (mode === "canary") {
    if (!/^[1-9][0-9]*$/.test(text(batchId)) || confirmation !== `EXPIRE ARCHIVE ${batchId}`) {
      fail("canary requires --batch-id and --confirmation 'EXPIRE ARCHIVE <batch-id>'");
    }
  } else if (batchId != null || confirmation != null) {
    fail("--batch-id and --confirmation are canary-only");
  }
  if (mode === "diagnostic") return;
  const ownerWorkflow = {
    GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: `${OWNER}/arcadePlatform`,
    GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY_OWNER: OWNER, GITHUB_ACTOR: OWNER, GITHUB_TRIGGERING_ACTOR: OWNER,
  };
  for (const [key, expected] of Object.entries(ownerWorkflow)) {
    if (text(env[key]) !== expected) fail(`settled retention ${mode} requires the owner workflow on main (${key})`);
  }
}

function storageTargetFor(profile, env) {
  if (profile.target === "production") return resolveStorageTarget("prod", env, { singleTarget: true });
  return resolveStorageTarget("stage", {
    EXPECTED_SUPABASE_STAGE_PROJECT_REF: profile.projectRef,
    SUPABASE_URL: profile.apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: profile.serviceRoleKey,
  }, { singleTarget: true });
}

export function archiveObjectPaths(row) {
  const paths = [
    row.object_path,
    buildRecoveryArchiveObjectPath(row.compressed_sha256),
    buildRecoveryManifestObjectPath(row.compressed_sha256),
  ];
  if (row.account_retirement_recovery_object_path) paths.push(row.account_retirement_recovery_object_path);
  if (paths[0] !== `v1/sha256/${row.compressed_sha256}.jsonl.gz`) fail(`archive batch ${row.batch_id} object path does not match its SHA-256`);
  return paths;
}

async function expireCall(sql, profile, batchId, cutoff, execute, confirmation) {
  const rows = await sql.unsafe("select public.chips_expire_archive_batch($1, $2::bigint, $3::timestamptz, $4, $5) as result;",
    [profile.projectRef, batchId, cutoff, execute, confirmation]);
  return rows[0]?.result || {};
}

async function readControlEnabled(sql) {
  const rows = await sql.unsafe("select enabled from public.chips_settled_retention_control where control_id;");
  if (rows.length !== 1) fail("settled retention control is missing");
  return rows[0].enabled === true;
}

// Per batch: recheck under lock, DELETE every known object (lock checked before
// each), then mark and drop its archived registry rows in one DB call. Any
// failure stops the run with the batch unmarked; a retry is idempotent.
async function expireBatch({ sql, lockSession, profile, storageTarget, row, cutoff, confirmation, requireControl, deps }) {
  const deleteObject = deps.deleteObject || deletePrivateObjectIfExists;
  const dry = await expireCall(sql, profile, row.batch_id, cutoff, false, null);
  if (dry.state !== "eligible") fail(`archive batch ${row.batch_id} is no longer eligible: ${dry.state || "unknown"}`);
  const objects = { deleted: 0, missing: 0 };
  for (const objectPath of archiveObjectPaths(row)) {
    await assertRetentionAdvisoryLock(sql, lockSession);
    // Storage DELETE cannot be rolled back: stop the moment the owner turns automatic off.
    if (requireControl && !(await readControlEnabled(sql))) fail(`settled retention control was disabled during batch ${row.batch_id}`);
    const outcome = await deleteObject(storageTarget, objectPath, deps);
    if (outcome !== "deleted" && outcome !== "missing") fail(`archive object delete returned ${outcome}`);
    objects[outcome] += 1;
  }
  await assertRetentionAdvisoryLock(sql, lockSession);
  const done = await expireCall(sql, profile, row.batch_id, cutoff, true, confirmation);
  if (done.state !== "expired") fail(`archive batch ${row.batch_id} expiry did not commit: ${done.state || "unknown"}`);
  return { batchId: row.batch_id, objectsDeleted: objects.deleted, objectsMissing: objects.missing, registryDeleted: Number(done.registry_deleted) };
}

export async function runSettledRetention({ env = process.env, deps = {}, target, mode, batchId = null, confirmation = null, cutoff = null } = {}) {
  requireSettledRetentionAuthorization({ target, mode, batchId, confirmation, cutoff, env });
  const profile = deps.profile || validateRetentionEnvironment(target, env, { requireCommitSha: true });
  if (mode === "automatic" && !profile.automationEnabled) return { state: "disabled", target, mode, reason: "automation_env_disabled" };
  const sql = deps.sql || postgres(profile.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 0, max_lifetime: 0 });
  let lockSession = null;
  try {
    lockSession = await acquireRetentionAdvisoryLock(sql, profile);
    if (!lockSession) return { state: "no-op", target, mode, reason: "advisory_lock_busy" };
    const identity = await sql.unsafe("select system_identifier::text as system_identifier from pg_catalog.pg_control_system();");
    if (text(identity[0]?.system_identifier) !== profile.systemIdentifier) fail(`database is not canonical ${profile.label}`);
    const controlEnabled = await readControlEnabled(sql);
    if (mode === "automatic" && !controlEnabled) return { state: "disabled", target, mode, reason: "settled_retention_control_disabled" };
    const limit = mode === "canary" ? 1 : AUTOMATIC_BATCH_LIMIT;
    const candidates = await sql.unsafe(CANDIDATES_SQL, [profile.projectRef, cutoff, mode === "canary" ? batchId : null, limit]);

    if (mode === "diagnostic") {
      const totals = await sql.unsafe(`select count(*)::int as batches, coalesce(sum(compressed_bytes), 0)::text as compressed_bytes
        from public.chips_ledger_archive_batches where batch_id = any($1::bigint[]);`, [candidates.map((row) => row.batch_id)]);
      const tables = (await sql.unsafe("select public.chips_settled_retention_12m_run($1, $2::timestamptz, false) as result;", [TABLE_ROW_LIMIT, cutoff]))[0]?.result;
      return { state: "diagnosed", target, mode, controlEnabled, archiveBatches: totals[0].batches,
        archiveBatchesCapped: candidates.length === limit, archiveCompressedBytes: totals[0].compressed_bytes, tables };
    }

    if (mode === "canary" && candidates.length !== 1) fail(`archive batch ${batchId} is not an eligible canary`);
    const storageTarget = deps.storageTarget || storageTargetFor(profile, env);
    await (deps.verifyBucket || verifyArchiveBucket)(storageTarget, deps);
    const expired = [];
    for (const row of candidates) {
      if (mode === "automatic" && !(await readControlEnabled(sql))) break;
      expired.push(await expireBatch({ sql, lockSession, profile, storageTarget, row, cutoff,
        confirmation: mode === "canary" ? confirmation : null, requireControl: mode === "automatic", deps }));
    }
    let tables = null;
    if (mode === "automatic" && await readControlEnabled(sql)) {
      await assertRetentionAdvisoryLock(sql, lockSession);
      tables = (await sql.unsafe("select public.chips_settled_retention_12m_run($1, $2::timestamptz, true) as result;", [TABLE_ROW_LIMIT, cutoff]))[0]?.result;
    }
    return { state: "complete", target, mode, expired, tables };
  } finally {
    if (lockSession) await releaseRetentionAdvisoryLock(sql, lockSession);
    if (!deps.sql) await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseSettledRetentionArgs();
  runSettledRetention({ ...args })
    .then((result) => klog("chips_ledger_settled_retention", result))
    .catch((error) => {
      process.stderr.write(`chips-ledger-settled-retention failed: ${error?.message || error}\n`);
      process.exitCode = 1;
    });
}
