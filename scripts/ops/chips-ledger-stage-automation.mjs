import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import postgres from "postgres";
import {
  runExport,
  STAGE_AUTOMATION_POLICY_ID,
  stringifyJson,
} from "./chips-ledger-archive-export.mjs";
import {
  buildRecoveryArchiveObjectPath,
  buildRecoveryManifestObjectPath,
  downloadPrivateArchiveObject,
  downloadPrivateObjectIfExists,
  ensureArchiveBucket,
  resolveStorageTarget,
  storeArchive,
  uploadOrVerifyPrivateObject,
  verifyArchiveBucket,
} from "./chips-ledger-archive-store.mjs";
import {
  buildRecoveryManifest,
  createPruneStore,
  pruneArchive,
} from "./chips-ledger-archive-prune.mjs";
import {
  ensurePrivateDirectory,
  writeExclusiveFiles,
} from "./_shared/chips-ledger-archive-files.mjs";

export const STAGE_PROJECT_REF = "krydukthwdvccggbyjfw";
export const STAGE_SYSTEM_IDENTIFIER = "7656985631720456337";
export const STAGE_MAX_BATCH_SIZE = 5000;
export const STAGE_RETENTION_DAYS = 30;
export const STAGE_AUTOMATION_LOCK_KEY = `chips-ledger-stage-automation-v1:${STAGE_PROJECT_REF}`;

const SHA256_RE = /^[0-9a-f]{64}$/;
const PRIVATE_FILE_MODE = 0o600;

function fail(message) {
  throw new Error(message);
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function redactedError(error) {
  const message = text(error?.message || error);
  return (message || "Stage automation failed")
    .replace(/postgres(?:ql)?:\/\/[^\s"'`<>]+/gi, "[redacted-db-url]")
    .replace(/\bBearer\s+[^\s,;)}\]"']+/gi, "Bearer [redacted]")
    .replace(/\bsb_secret_[a-zA-Z0-9_-]+/gi, "[redacted-supabase-secret]")
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, "[redacted-token]")
    .replace(/\b(?:password|passwd|secret|token|api[_-]?key|service[-_ ]?role[-_ ]?key)\s*[:=]\s*[^\s,;)}\]"']+/gi, "[redacted-secret]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted-record-id]")
    .replace(/\b(?:entry|transaction|account|table)[-_ ]?\d+\b/gi, "[redacted-record]");
}

function aggregatePayload(result) {
  const base = {
    event: "chips_ledger_stage_automation",
    target: "stage",
    project_ref: STAGE_PROJECT_REF,
    source_policy_id: STAGE_AUTOMATION_POLICY_ID,
    state: result.state,
  };
  if (result.state === "error") {
    return {
      ...base,
      reason: redactedError(result.reason),
    };
  }
  return {
    ...base,
    mode: result.mode || null,
    transactions: result.transactions ?? null,
    entries: result.entries ?? null,
    tx_types: result.txTypes || null,
    amounts: result.amounts || null,
    raw_bytes: result.rawBytes ?? null,
    compressed_bytes: result.compressedBytes ?? null,
    compressed_sha256: result.compressedSha256 || null,
    recovery_archive_sha256: result.recoveryArchiveSha256 || null,
    recovery_manifest_sha256: result.recoveryManifestSha256 || null,
    proof: result.proof || null,
    receipt: result.receipt || null,
    mappings: result.mappings ?? null,
    reason: result.reason || null,
  };
}

function writeAggregateSummary(result) {
  const safe = stringifyJson(aggregatePayload(result));
  process.stdout.write(`${safe}\n`);
  const summaryPath = text(process.env.GITHUB_STEP_SUMMARY);
  if (summaryPath) {
    try {
      fs.appendFileSync(summaryPath, `\n\`\`\`json\n${safe}\n\`\`\`\n`, { mode: PRIVATE_FILE_MODE });
    } catch {
      // Job Summary is best-effort; stdout remains the authoritative report.
    }
  }
  return safe;
}

function emitAggregateError(error) {
  try {
    writeAggregateSummary({ state: "error", reason: redactedError(error) });
  } catch {
    // Preserve the original orchestration error if reporting itself fails.
  }
}

export function validateStageEnvironment(env = process.env) {
  for (const key of Object.keys(env)) {
    if (/^SUPABASE_PROD_|^PRODUCTION_/.test(key)) fail("Production credentials are not accepted by the Stage orchestrator");
  }
  const dbUrl = text(env.SUPABASE_STAGE_DB_URL);
  const apiUrl = text(env.SUPABASE_STAGE_URL);
  const serviceKey = text(env.SUPABASE_STAGE_SERVICE_ROLE_KEY);
  if (!dbUrl || !apiUrl || !serviceKey) fail("Stage DB URL, Supabase URL and service key are required");
  let parsedDb;
  let parsedApi;
  try {
    parsedDb = new URL(dbUrl);
    parsedApi = new URL(apiUrl);
  } catch {
    fail("Stage connection configuration is invalid");
  }
  if (parsedDb.protocol !== "postgres:" && parsedDb.protocol !== "postgresql:") fail("Stage DB URL must be PostgreSQL");
  if (parsedApi.protocol !== "https:" || parsedApi.pathname !== "/" || parsedApi.search || parsedApi.hash) {
    fail("Stage Supabase URL must be an HTTPS origin");
  }
  if (parsedApi.hostname.toLowerCase() !== `${STAGE_PROJECT_REF}.supabase.co`) {
    fail("Stage Supabase URL does not match the canonical Stage project ref");
  }
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(parsedDb.hostname);
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(parsedDb.hostname);
  const user = /^postgres\.([a-z0-9]{20})$/i.exec(decodeURIComponent(parsedDb.username || ""));
  const dbProjectRef = (direct?.[1] || (pooler ? user?.[1] : ""))?.toLowerCase();
  if (dbProjectRef !== STAGE_PROJECT_REF) fail("Stage DB URL does not match the canonical Stage project ref");
  return {
    dbUrl,
    apiUrl: parsedApi.origin,
    serviceKey,
    moduleEnv: {
      EXPECTED_SUPABASE_STAGE_PROJECT_REF: STAGE_PROJECT_REF,
      SUPABASE_STAGE_DB_URL: dbUrl,
      SUPABASE_URL: parsedApi.origin,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    },
  };
}

async function acquireAdvisoryLock(sql) {
  const rows = await sql.unsafe(
    "select pg_catalog.pg_backend_pid()::text as backend_pid, pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended($1, 0)) as acquired;",
    [STAGE_AUTOMATION_LOCK_KEY],
  );
  if (!(rows[0]?.acquired === true || rows[0]?.acquired === "t")) return null;
  const backendPid = text(rows[0]?.backend_pid);
  if (!backendPid) fail("Stage advisory lock session identity is unavailable");
  return { backendPid };
}

async function assertAdvisoryLock(sql, lockSession) {
  const rows = await sql.unsafe("select pg_catalog.pg_backend_pid()::text as backend_pid;");
  if (text(rows[0]?.backend_pid) !== lockSession?.backendPid) {
    fail("Stage advisory lock session was lost; aborting the cycle");
  }
}

async function releaseAdvisoryLock(sql) {
  await sql.unsafe(
    "select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1, 0));",
    [STAGE_AUTOMATION_LOCK_KEY],
  );
}

async function assertIdentity(sql) {
  const rows = await sql.unsafe("select system_identifier::text as system_identifier from pg_catalog.pg_control_system();");
  const identity = text(rows[0]?.system_identifier);
  if (identity !== STAGE_SYSTEM_IDENTIFIER) fail("database is not canonical Stage");
  return identity;
}

async function loadOwnBatches(sql) {
  return sql.unsafe(`select
    object_path,
    project_ref,
    source_policy_id,
    status,
    committed_at::text as committed_at,
    archive_proof_verified_at::text as archive_proof_verified_at,
    archived_transaction_ids_sha256,
    archived_entry_ids_sha256,
    pruned_at::text as pruned_at,
    pruned_transaction_count::text as pruned_transaction_count,
    pruned_entry_count::text as pruned_entry_count,
    pruned_transaction_ids_sha256,
    pruned_entry_ids_sha256,
    compressed_sha256
  from public.chips_ledger_archive_batches
  where project_ref = $1
    and source_policy_id = $2
  order by created_at desc, object_path desc;`, [STAGE_PROJECT_REF, STAGE_AUTOMATION_POLICY_ID]);
}

function receiptFieldCount(row) {
  return [
    row.pruned_at,
    row.pruned_transaction_count,
    row.pruned_entry_count,
    row.pruned_transaction_ids_sha256,
    row.pruned_entry_ids_sha256,
  ].filter((value) => value != null).length;
}

function proofFieldCount(row) {
  return [
    row.archive_proof_verified_at,
    row.archived_transaction_ids_sha256,
    row.archived_entry_ids_sha256,
  ].filter((value) => value != null).length;
}

export function findOwnCycle(rows) {
  const active = rows.filter((row) => row.status === "pending"
    || (row.status === "committed" && receiptFieldCount(row) !== 5));
  if (active.length > 1) fail("multiple incomplete Stage automation manifests; refusing to choose one");
  if (active[0]?.status === "pending") fail("Stage automation manifest is pending; refusing a blind resume");
  if (active[0] && active[0].source_policy_id !== STAGE_AUTOMATION_POLICY_ID) {
    fail("Stage automation manifest policy mismatch");
  }
  for (const row of rows) {
    if (row.status !== "pending" && row.status !== "committed") fail("Stage automation manifest has an invalid state");
    if (row.source_policy_id !== STAGE_AUTOMATION_POLICY_ID) fail("Stage automation manifest policy mismatch");
    if (receiptFieldCount(row) !== 0 && receiptFieldCount(row) !== 5) fail("Stage automation receipt is partial");
    if (proofFieldCount(row) !== 0 && proofFieldCount(row) !== 3) fail("Stage automation proof is partial");
  }
  return {
    active: active[0] || null,
    latestCompleted: rows.find((row) => row.status === "committed" && receiptFieldCount(row) === 5) || null,
  };
}

function assertRecoveryManifestMatches(actual, expected) {
  if (canonicalJson(actual) !== canonicalJson(expected)) fail("durable recovery manifest differs from verified evidence");
}

export function assertResumeRecoveryState(row, durable) {
  if (row.pruned_at && !durable) fail("pruned Stage automation cycle has no durable recovery copies");
  if (row.archive_proof_verified_at && !row.pruned_at && !durable) {
    fail("proven Stage automation cycle has no durable recovery; refusing a blind Storage retry");
  }
  if (!row.archive_proof_verified_at && durable) {
    fail("Stage automation recovery exists without an immutable proof; refusing an ambiguous resume");
  }
  return true;
}

async function inspectDurableRecovery(storageTarget, row, deps = {}) {
  const archivePath = buildRecoveryArchiveObjectPath(row.compressed_sha256);
  const manifestPath = buildRecoveryManifestObjectPath(row.compressed_sha256);
  const [archiveBytes, manifestGzipBytes] = await Promise.all([
    downloadPrivateObjectIfExists(storageTarget, archivePath, deps),
    downloadPrivateObjectIfExists(storageTarget, manifestPath, deps),
  ]);
  if (archiveBytes == null && manifestGzipBytes == null) return null;
  if (archiveBytes == null || manifestGzipBytes == null) fail("durable recovery copy is partial");
  if (!SHA256_RE.test(row.compressed_sha256) || sha256(archiveBytes) !== row.compressed_sha256) {
    fail("durable recovery archive copy checksum differs");
  }
  let manifestBytes;
  try {
    manifestBytes = gunzipSync(manifestGzipBytes);
  } catch {
    fail("durable recovery manifest is not valid gzip");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    fail("durable recovery manifest is invalid JSON");
  }
  return {
    archivePath,
    manifestPath,
    archiveBytes,
    manifestGzipBytes,
    manifestBytes,
    manifest,
    archiveSha256: sha256(archiveBytes),
    manifestSha256: sha256(manifestGzipBytes),
  };
}

export async function persistDurableRecovery(storageTarget, row, identity, evidence, archiveBytes, deps = {}) {
  if (sha256(archiveBytes) !== row.compressed_sha256) fail("verified archive checksum differs before recovery copy");
  const manifest = buildRecoveryManifest(row, identity, evidence, { target: "stage" });
  const manifestBytes = Buffer.from(`${stringifyJson(manifest)}\n`, "utf8");
  const manifestGzipBytes = gzipSync(manifestBytes, { level: 9, mtime: 0 });
  const recoveryArchive = await uploadOrVerifyPrivateObject({
    storageTarget,
    objectPath: buildRecoveryArchiveObjectPath(row.compressed_sha256),
    bytes: archiveBytes,
    deps,
  });
  const recoveryManifest = await uploadOrVerifyPrivateObject({
    storageTarget,
    objectPath: buildRecoveryManifestObjectPath(row.compressed_sha256),
    bytes: manifestGzipBytes,
    deps,
  });
  const verified = await inspectDurableRecovery(storageTarget, row, deps);
  if (!verified) fail("durable recovery copies disappeared after upload");
  assertRecoveryManifestMatches(verified.manifest, manifest);
  return {
    ...verified,
    recoveryArchive,
    recoveryManifest,
  };
}

function restoreLocalRecovery(directory, durable) {
  ensurePrivateDirectory(directory);
  const base = `chips-ledger-${sha256(durable.archiveBytes)}`;
  const artifactPath = path.join(directory, `${base}.jsonl.gz`);
  const manifestPath = path.join(directory, `${base}.recovery.json`);
  writeExclusiveFiles([
    { path: artifactPath, data: durable.archiveBytes },
    { path: manifestPath, data: durable.manifestBytes },
  ]);
  return { directory, artifactPath, manifestPath };
}

export function assertDurableRecoveryReady(durable) {
  if (!durable?.archiveBytes || !durable?.manifestGzipBytes || !durable?.manifestBytes) {
    fail("execute requires both durable recovery copies");
  }
  return true;
}

function pruneArgs(row, mode, recoveryDir = null) {
  const args = [
    "--target", "stage",
    "--object-path", row.object_path,
    "--confirm-sha", row.compressed_sha256,
  ];
  if (mode === "register-proof") args.push("--register-proof");
  if (mode === "execute") args.push("--execute", "--recovery-dir", recoveryDir);
  return args;
}

async function runPruneStep({ row, mode, env, cwd, sql, pruneStore, storageTarget, downloadArchive = null, recoveryDir = null, verifyBucket = null, storageDeps = {} }) {
  const deps = {
    ...storageDeps,
    sql,
    pruneStore,
    storageTarget,
    emit: false,
  };
  if (downloadArchive) deps.downloadArchive = downloadArchive;
  if (verifyBucket) deps.verifyBucket = verifyBucket;
  const pruneRunner = storageDeps.pruneArchive || pruneArchive;
  return pruneRunner({
    argv: pruneArgs(row, mode, mode === "execute" ? recoveryDir : null),
    env,
    cwd,
    deps,
  });
}

async function verifyCompletedCycle({ row, identity, env, tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps = {} }) {
  const durable = await inspectDurableRecovery(storageTarget, row, storageDeps);
  assertResumeRecoveryState(row, durable);
  if (!durable) fail("completed Stage automation cycle has no durable recovery copies");
  const dry = await runPruneStep({
    row,
    mode: "dry-run",
    env,
    cwd: tempRoot,
    sql,
    pruneStore,
    storageTarget,
    verifyBucket,
    storageDeps,
    downloadArchive: async () => ({ bytes: durable.archiveBytes, downloadMs: 0 }),
  });
  if (dry.state !== "already_pruned") fail(`completed Stage automation cycle did not revalidate as already_pruned: ${dry.state}`);
  assertRecoveryManifestMatches(
    durable.manifest,
    buildRecoveryManifest(row, identity, dry.evidence, { target: "stage" }),
  );
  return { durable, dry };
}

async function refreshRow(pruneStore, objectPath) {
  const row = await pruneStore.getManifest(objectPath);
  if (!row || row.source_policy_id !== STAGE_AUTOMATION_POLICY_ID) fail("Stage automation manifest policy mismatch");
  return row;
}

async function executeVerifiedCycle({ row, identity, durable, env, tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps = {} }) {
  assertDurableRecoveryReady(durable);
  const recoveryDir = path.join(tempRoot, "recovery");
  restoreLocalRecovery(recoveryDir, durable);
  const result = await runPruneStep({
    row,
    mode: "execute",
    env,
    cwd: tempRoot,
    sql,
    pruneStore,
    storageTarget,
    verifyBucket,
    storageDeps,
    recoveryDir,
    downloadArchive: async () => ({ bytes: durable.archiveBytes, downloadMs: 0 }),
  });
  if (result.state !== "pruned" && result.state !== "already_pruned") {
    fail(`unexpected prune state: ${result.state}`);
  }
  return result;
}

async function resumeOwnCycle({ row, identity, env, tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps = {} }) {
  const durableBefore = await inspectDurableRecovery(storageTarget, row, storageDeps);
  assertResumeRecoveryState(row, durableBefore);
  if (!row.archive_proof_verified_at) {
    await runPruneStep({ row, mode: "register-proof", env, cwd: tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps, downloadArchive: durableBefore ? async () => ({ bytes: durableBefore.archiveBytes, downloadMs: 0 }) : null });
    row = await refreshRow(pruneStore, row.object_path);
  }
  const dry = await runPruneStep({
    row,
    mode: "dry-run",
    env,
    cwd: tempRoot,
    sql,
    pruneStore,
    storageTarget,
    verifyBucket,
    storageDeps,
    downloadArchive: durableBefore ? async () => ({ bytes: durableBefore.archiveBytes, downloadMs: 0 }) : null,
  });
  if (durableBefore) {
    assertRecoveryManifestMatches(
      durableBefore.manifest,
      buildRecoveryManifest(row, identity, dry.evidence, { target: "stage" }),
    );
  }
  if (dry.state === "already_pruned") {
    return executeVerifiedCycle({ row, identity, durable: durableBefore, env, tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps });
  }
  if (dry.state !== "ready") fail(`Stage automation dry-run did not become ready: ${dry.state}`);
  let durable = durableBefore;
  if (!durable) {
    const main = await downloadPrivateArchiveObject(storageTarget, row.object_path, storageDeps);
    durable = await persistDurableRecovery(storageTarget, row, identity, dry.evidence, main.bytes, storageDeps);
  }
  return executeVerifiedCycle({ row, identity, durable, env, tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps });
}

export async function runStageAutomation({ env = process.env, now = new Date(), deps = {} } = {}) {
  let sql = null;
  let lockSession = null;
  let tempRoot = null;
  let ownsSql = false;
  let result = null;
  let failed = false;
  let failure = null;

  try {
    const config = validateStageEnvironment(env);
    const moduleEnv = config.moduleEnv;
    const providedSql = deps.sql;
    if (providedSql) {
      sql = providedSql;
    } else {
      sql = postgres(config.dbUrl, {
        max: 1,
        prepare: false,
        connect_timeout: 10,
        idle_timeout: 0,
      });
      ownsSql = true;
    }
    tempRoot = deps.tempRoot || fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-stage-automation-"));
    ensurePrivateDirectory(tempRoot);
    const storageTarget = deps.storageTarget || resolveStorageTarget("stage", moduleEnv, { singleTarget: true });
    const pruneStore = deps.pruneStore || createPruneStore(sql);
    const verifyBucket = deps.verifyBucket || ((target) => verifyArchiveBucket(target, deps));

    lockSession = await acquireAdvisoryLock(sql);
    if (!lockSession) {
      result = { state: "no-op", reason: "advisory_lock_busy" };
    } else {
      const identity = await assertIdentity(sql);
      await assertAdvisoryLock(sql, lockSession);
      await verifyBucket(storageTarget);
      const ownRows = await loadOwnBatches(sql);
      await assertAdvisoryLock(sql, lockSession);
      const ownCycle = findOwnCycle(ownRows);
      if (ownCycle.active) {
        const resumed = await resumeOwnCycle({ row: await refreshRow(pruneStore, ownCycle.active.object_path), identity, env: moduleEnv, tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps: deps });
        await assertAdvisoryLock(sql, lockSession);
        result = {
          state: resumed.state,
          mode: "resume",
          transactions: resumed.evidence.transactionCount,
          entries: resumed.evidence.entryCount,
          txTypes: resumed.evidence.txTypes,
          amounts: { credits: resumed.evidence.credits, debits: resumed.evidence.debits, net: resumed.evidence.net },
          compressedSha256: ownCycle.active.compressed_sha256,
        };
      } else {
        if (ownCycle.latestCompleted) {
          await verifyCompletedCycle({
            row: await refreshRow(pruneStore, ownCycle.latestCompleted.object_path),
            identity,
            env: moduleEnv,
            tempRoot,
            sql,
            pruneStore,
            storageTarget,
            verifyBucket,
            storageDeps: deps,
          });
          await assertAdvisoryLock(sql, lockSession);
        }

        const artifactPath = path.join(tempRoot, "archive.jsonl.gz");
        const manifestPath = path.join(tempRoot, "archive.manifest.json");
        const exportArchive = deps.exportArchive || runExport;
        const exported = await exportArchive({
          argv: [
            "--target", "stage",
            "--cutoff-days", String(STAGE_RETENTION_DAYS),
            "--batch-size", String(STAGE_MAX_BATCH_SIZE),
            "--output", artifactPath,
            "--manifest", manifestPath,
          ],
          env: moduleEnv,
          cwd: tempRoot,
          now,
          deps: {
            sql,
            selector: "prunable",
            sourcePolicyId: STAGE_AUTOMATION_POLICY_ID,
            targetOptions: { singleTarget: true },
            noCandidateIfEmpty: true,
            emit: false,
          },
        });
        await assertAdvisoryLock(sql, lockSession);
        if (exported.noCandidate) {
          result = { state: "no-op", reason: "no_eligible_candidate" };
        } else {
          const ensureBucket = deps.ensureArchiveBucket || ensureArchiveBucket;
          await ensureBucket(storageTarget, deps);
          await assertAdvisoryLock(sql, lockSession);
          const store = deps.storeArchive || storeArchive;
          const stored = await store({
            argv: ["--target", "stage", "--artifact", artifactPath, "--manifest", manifestPath],
            env: moduleEnv,
            cwd: tempRoot,
            deps: { ...deps, sql, storageTarget, targetOptions: { singleTarget: true }, emit: false },
          });
          let row = await refreshRow(pruneStore, stored.objectPath);
          await assertAdvisoryLock(sql, lockSession);
          await runPruneStep({ row, mode: "register-proof", env: moduleEnv, cwd: tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps: deps });
          row = await refreshRow(pruneStore, row.object_path);
          await assertAdvisoryLock(sql, lockSession);
          const dry = await runPruneStep({ row, mode: "dry-run", env: moduleEnv, cwd: tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps: deps });
          if (dry.state !== "ready") fail(`Stage automation dry-run did not become ready: ${dry.state}`);
          await assertAdvisoryLock(sql, lockSession);
          const downloadMain = deps.downloadPrivateArchive || downloadPrivateArchiveObject;
          const main = await downloadMain(storageTarget, row.object_path, deps);
          const durable = await persistDurableRecovery(storageTarget, row, identity, dry.evidence, main.bytes, deps);
          await assertAdvisoryLock(sql, lockSession);
          const executed = await executeVerifiedCycle({ row, identity, durable, env: moduleEnv, tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps: deps });
          await assertAdvisoryLock(sql, lockSession);
          result = {
            state: executed.state,
            mode: "new",
            transactions: executed.evidence.transactionCount,
            entries: executed.evidence.entryCount,
            txTypes: executed.evidence.txTypes,
            amounts: { credits: executed.evidence.credits, debits: executed.evidence.debits, net: executed.evidence.net },
            rawBytes: exported.bytes?.raw || null,
            compressedBytes: row.compressed_bytes,
            compressedSha256: row.compressed_sha256,
            recoveryArchiveSha256: durable.recoveryArchive.sha256,
            recoveryManifestSha256: durable.recoveryManifest.sha256,
            proof: executed.state === "pruned" ? "verified" : null,
            receipt: executed.state,
            mappings: executed.evidence.transactionCount,
          };
        }
      }
    }
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    if (lockSession && sql) {
      try {
        await releaseAdvisoryLock(sql);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
    if (sql && ownsSql) {
      try {
        await sql.end({ timeout: 5 });
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  }
  if (failed) {
    emitAggregateError(failure);
    throw failure;
  }
  writeAggregateSummary(result);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).length !== 0) {
    process.stderr.write("chips-ledger-stage-automation accepts no command-line options\n");
    process.exitCode = 1;
  } else {
    runStageAutomation().catch(() => {
      process.exitCode = 1;
    });
  }
}
