import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import postgres from "postgres";
import {
  LEGACY_STAGE_ALLOWLIST_CUTOFF,
  LEGACY_STAGE_ALLOWLIST_GENERATOR_SQL,
  LEGACY_STAGE_ALLOWLIST_POLICY_ID,
  LEGACY_STAGE_ALLOWLIST_SOURCE_RUN,
  LEGACY_STAGE_ALLOWLIST_TABLE_COUNT,
  LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT,
  BOT_ONLY_EXPORT_SCHEMA_VERSION,
  runExport,
  stringifyJson,
} from "./chips-ledger-archive-export.mjs";
import {
  buildRecoveryArchiveObjectPath,
  buildRecoveryManifestObjectPath,
  downloadPrivateArchiveObject,
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
  STAGE_AUTOMATION_LOCK_KEY,
  STAGE_PROJECT_REF,
  STAGE_SYSTEM_IDENTIFIER,
  persistDurableRecovery,
  validateStageEnvironment,
} from "./chips-ledger-stage-automation.mjs";
import { ensurePrivateDirectory, writeExclusiveFiles } from "./_shared/chips-ledger-archive-files.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;
const PLAN_OBJECT_PREFIX = `plan/v1/${LEGACY_STAGE_ALLOWLIST_POLICY_ID}`;

function fail(message) {
  throw new Error(message);
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashCanonicalJson(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function hashCanonicalIds(ids) {
  return sha256(Buffer.from(`${ids.join("\n")}\n`, "utf8"));
}

function canonicalUuidList(values, label) {
  if (!Array.isArray(values)) fail(`${label} must be an array`);
  const ids = values.map((value) => text(value).toLowerCase());
  if (ids.some((id) => !UUID_RE.test(id))) fail(`${label} contains a non-canonical UUID`);
  const sorted = [...ids].sort();
  if (new Set(sorted).size !== sorted.length) fail(`${label} contains duplicate UUIDs`);
  if (ids.some((id, index) => id !== sorted[index])) fail(`${label} must be sorted canonically`);
  return sorted;
}

export function legacyAllowlistQuerySha256() {
  return sha256(Buffer.from(LEGACY_STAGE_ALLOWLIST_GENERATOR_SQL, "utf8"));
}

export function buildLegacyMasterManifest({
  tableIds,
  cutoff = LEGACY_STAGE_ALLOWLIST_CUTOFF,
  querySha256 = legacyAllowlistQuerySha256(),
  sourceRun = LEGACY_STAGE_ALLOWLIST_SOURCE_RUN,
  stageSystemIdentifier = STAGE_SYSTEM_IDENTIFIER,
  projectRef = STAGE_PROJECT_REF,
}) {
  const ids = canonicalUuidList(tableIds, "legacy master table IDs");
  if (ids.length !== LEGACY_STAGE_ALLOWLIST_TABLE_COUNT) {
    fail(`legacy master allowlist must contain exactly ${LEGACY_STAGE_ALLOWLIST_TABLE_COUNT} table IDs`);
  }
  if (projectRef !== STAGE_PROJECT_REF || stageSystemIdentifier !== STAGE_SYSTEM_IDENTIFIER) {
    fail("legacy master manifest is not canonical Stage evidence");
  }
  if (sourceRun !== LEGACY_STAGE_ALLOWLIST_SOURCE_RUN
    || querySha256 !== legacyAllowlistQuerySha256()) {
    fail("legacy master manifest source proof is invalid");
  }
  const manifest = {
    manifest_version: 1,
    archive_schema_version: BOT_ONLY_EXPORT_SCHEMA_VERSION,
    policy_id: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
    proof_basis: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
    target: "stage",
    project_ref: projectRef,
    stage_system_identifier: stageSystemIdentifier,
    source_run: sourceRun,
    query_sha256: querySha256,
    cutoff,
    table_count: ids.length,
    table_ids: ids,
    allowlist_sha256: hashCanonicalIds(ids),
  };
  return {
    ...manifest,
    manifest_sha256: hashCanonicalJson(manifest),
  };
}

export function buildLegacyBatchManifest(masterManifest, { batchNumber = 1 } = {}) {
  if (!masterManifest || masterManifest.policy_id !== LEGACY_STAGE_ALLOWLIST_POLICY_ID) {
    fail("legacy batch requires the canonical master manifest");
  }
  const masterIds = canonicalUuidList(masterManifest.table_ids, "legacy master table IDs");
  if (masterIds.length !== LEGACY_STAGE_ALLOWLIST_TABLE_COUNT) fail("legacy master manifest count is invalid");
  if (!Number.isSafeInteger(batchNumber) || batchNumber < 1) fail("legacy batch number is invalid");
  const start = (batchNumber - 1) * LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT;
  const tableIds = masterIds.slice(start, start + LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT);
  if (tableIds.length < 1 || (batchNumber === 1 && tableIds.length !== LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT)) {
    fail("legacy batch is outside the frozen master allowlist");
  }
  const manifest = {
    manifest_version: 1,
    archive_schema_version: BOT_ONLY_EXPORT_SCHEMA_VERSION,
    policy_id: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
    proof_basis: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
    target: "stage",
    project_ref: masterManifest.project_ref,
    stage_system_identifier: masterManifest.stage_system_identifier,
    source_run: masterManifest.source_run,
    query_sha256: masterManifest.query_sha256,
    cutoff: masterManifest.cutoff,
    batch_number: batchNumber,
    batch_table_count: tableIds.length,
    batch_table_ids: tableIds,
    batch_table_ids_sha256: hashCanonicalIds(tableIds),
    master_table_count: masterManifest.table_count,
    master_allowlist_sha256: masterManifest.allowlist_sha256,
    master_manifest_sha256: masterManifest.manifest_sha256,
  };
  return {
    ...manifest,
    manifest_sha256: hashCanonicalJson(manifest),
  };
}

export function buildLegacyPlan(masterManifest, batchManifest) {
  if (batchManifest.batch_number !== 1 || batchManifest.batch_table_count !== LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT) {
    fail("only deterministic legacy batch 1 is supported by this prepare-only workflow");
  }
  const masterTableIds = canonicalUuidList(masterManifest.table_ids, "legacy master table IDs");
  const batchTableIds = canonicalUuidList(batchManifest.batch_table_ids, "legacy batch table IDs");
  if (batchManifest.master_allowlist_sha256 !== masterManifest.allowlist_sha256
    || batchManifest.master_manifest_sha256 !== masterManifest.manifest_sha256
    || batchManifest.batch_table_ids_sha256 !== hashCanonicalIds(batchTableIds)) {
    fail("legacy batch manifest is not bound to the master manifest");
  }
  return {
    ...batchManifest,
    masterManifest,
    batchManifest,
    master_table_ids: masterTableIds,
    batch_table_ids: batchTableIds,
    master_table_count: masterManifest.table_count,
    allowlist_sha256: masterManifest.allowlist_sha256,
    batch_table_ids_sha256: batchManifest.batch_table_ids_sha256,
    sourceRun: masterManifest.source_run,
    querySha256: masterManifest.query_sha256,
    stageSystemIdentifier: masterManifest.stage_system_identifier,
    masterTableCount: masterManifest.table_count,
    batchNumber: batchManifest.batch_number,
    batchTableCount: batchManifest.batch_table_count,
    batchTableIds,
    batchTableIdsSha256: batchManifest.batch_table_ids_sha256,
    masterTableIds,
    allowlistSha256: masterManifest.allowlist_sha256,
    batchManifestSha256: batchManifest.manifest_sha256,
    masterManifestSha256: masterManifest.manifest_sha256,
    archiveManifest: {
      policy_id: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
      proof_basis: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
      allowlist_sha256: masterManifest.allowlist_sha256,
      batch_table_ids: batchTableIds,
      batch_table_ids_sha256: batchManifest.batch_table_ids_sha256,
      master_table_ids: masterTableIds,
      master_table_count: masterManifest.table_count,
      batch_number: batchManifest.batch_number,
      batch_table_count: batchManifest.batch_table_count,
      source_run: masterManifest.source_run,
      query_sha256: masterManifest.query_sha256,
      stage_system_identifier: masterManifest.stage_system_identifier,
      master_manifest_sha256: masterManifest.manifest_sha256,
      batch_manifest_sha256: batchManifest.manifest_sha256,
    },
  };
}

export async function readLegacyAllowlist(sql, {
  cutoff = LEGACY_STAGE_ALLOWLIST_CUTOFF,
  sourceRun = LEGACY_STAGE_ALLOWLIST_SOURCE_RUN,
  expectedProjectRef = STAGE_PROJECT_REF,
  expectedSystemIdentifier = STAGE_SYSTEM_IDENTIFIER,
} = {}) {
  if (!sql || typeof sql.begin !== "function") fail("PostgreSQL adapter is required");
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read, read only;");
    const identityRows = await tx.unsafe("select system_identifier::text as system_identifier from pg_catalog.pg_control_system();");
    const stageSystemIdentifier = text(identityRows[0]?.system_identifier);
    if (stageSystemIdentifier !== expectedSystemIdentifier) fail("legacy allowlist generator is not running on canonical Stage");
    const rows = await tx.unsafe(LEGACY_STAGE_ALLOWLIST_GENERATOR_SQL, [cutoff]);
    const tableIds = canonicalUuidList(rows.map((row) => row.table_id), "generated legacy table IDs");
    if (tableIds.length !== LEGACY_STAGE_ALLOWLIST_TABLE_COUNT) {
      fail(`legacy allowlist generator returned ${tableIds.length} tables; expected ${LEGACY_STAGE_ALLOWLIST_TABLE_COUNT}`);
    }
    const masterManifest = buildLegacyMasterManifest({
      tableIds,
      cutoff,
      querySha256: legacyAllowlistQuerySha256(),
      sourceRun,
      stageSystemIdentifier,
      projectRef: expectedProjectRef,
    });
    const batchManifest = buildLegacyBatchManifest(masterManifest, { batchNumber: 1 });
    return {
      masterManifest,
      batchManifest,
      querySha256: masterManifest.query_sha256,
      cutoff,
      sourceRun,
      stageSystemIdentifier,
      projectRef: expectedProjectRef,
      generatorRows: rows,
    };
  });
}

function jsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function idsBytes(ids) {
  return Buffer.from(`${ids.join("\n")}\n`, "utf8");
}

function gzipPlan(bytes) {
  return gzipSync(bytes, { level: 9, mtime: 0 });
}

export function writeLegacyPlanFiles(directory, plan) {
  ensurePrivateDirectory(directory);
  const files = [
    { name: "legacy-stage-allowlist-v1.master.ids", data: idsBytes(plan.masterTableIds) },
    { name: "legacy-stage-allowlist-v1.master.manifest.json", data: jsonBytes(plan.masterManifest) },
    { name: "legacy-stage-allowlist-v1.batch-001.ids", data: idsBytes(plan.batchTableIds) },
    { name: "legacy-stage-allowlist-v1.batch-001.manifest.json", data: jsonBytes(plan.batchManifest) },
  ];
  const paths = files.map(({ name }) => path.join(directory, name));
  writeExclusiveFiles(files.map(({ name, data }) => ({ path: path.join(directory, name), data })));
  return { paths, files };
}

function planStorageObjects(plan, files) {
  const base = `${PLAN_OBJECT_PREFIX}/${plan.allowlistSha256}/batch-001`;
  const byName = new Map(files.map((file) => [file.name, file.data]));
  return [
    { objectPath: `${base}/master.ids.gz`, bytes: gzipPlan(byName.get("legacy-stage-allowlist-v1.master.ids")) },
    { objectPath: `${base}/master.manifest.json.gz`, bytes: gzipPlan(byName.get("legacy-stage-allowlist-v1.master.manifest.json")) },
    { objectPath: `${base}/batch-001.ids.gz`, bytes: gzipPlan(byName.get("legacy-stage-allowlist-v1.batch-001.ids")) },
    { objectPath: `${base}/batch-001.manifest.json.gz`, bytes: gzipPlan(byName.get("legacy-stage-allowlist-v1.batch-001.manifest.json")) },
  ];
}

async function acquireLock(sql) {
  const rows = await sql.unsafe(
    "select pg_catalog.pg_backend_pid()::text as backend_pid, pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended($1, 0)) as acquired;",
    [STAGE_AUTOMATION_LOCK_KEY],
  );
  if (!(rows[0]?.acquired === true || rows[0]?.acquired === "t")) return null;
  return text(rows[0]?.backend_pid);
}

async function assertLock(sql, backendPid) {
  const rows = await sql.unsafe("select pg_catalog.pg_backend_pid()::text as backend_pid;");
  if (text(rows[0]?.backend_pid) !== backendPid) fail("Stage automation advisory lock session was lost");
}

async function releaseLock(sql) {
  await sql.unsafe("select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1, 0));", [STAGE_AUTOMATION_LOCK_KEY]);
}

export async function readOnlyStagePreflight(sql) {
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read, read only;");
    const identityRows = await tx.unsafe("select system_identifier::text as system_identifier from pg_catalog.pg_control_system();");
    const activeRows = await tx.unsafe("select public.chips_table_fence_is_active() as active;");
    const controlRows = await tx.unsafe("select enforcement_active from public.chips_table_fence_control where control_id is true;");
    const systemIdentifier = text(identityRows[0]?.system_identifier);
    const active = activeRows[0]?.active === true || activeRows[0]?.active === "t";
    const enforcementActive = controlRows[0]?.enforcement_active === true || controlRows[0]?.enforcement_active === "t";
    if (systemIdentifier !== STAGE_SYSTEM_IDENTIFIER || !active || !enforcementActive) {
      fail("legacy Stage allowlist requires canonical Stage with the active TABLE fence");
    }
    return {
      projectRef: STAGE_PROJECT_REF,
      systemIdentifier,
      fenceActive: active,
      enforcementActive,
      readOnly: true,
    };
  });
}

function assertCommit(env) {
  const sha = text(env.DEPLOYED_COMMIT_SHA || env.GITHUB_SHA).toLowerCase();
  if (!COMMIT_SHA_RE.test(sha)) fail("DEPLOYED_COMMIT_SHA/GITHUB_SHA must be the checked-out commit SHA");
  return sha;
}

export async function runLegacyStagePrepareOnly({ env = process.env, cwd = process.cwd(), deps = {} } = {}) {
  if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    && process.argv.slice(2).length !== 0) fail("legacy Stage allowlist runner accepts no arguments");
  const config = validateStageEnvironment(env, { requireCommitSha: true });
  const deployedCommitSha = assertCommit(env);
  let sql = deps.sql || postgres(config.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 0 });
  const ownsSql = !deps.sql;
  const tempRoot = deps.tempRoot || fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-stage-legacy-allowlist-"));
  ensurePrivateDirectory(tempRoot);
  const moduleEnv = config.moduleEnv;
  const storageTarget = deps.storageTarget || resolveStorageTarget("stage", moduleEnv, { singleTarget: true });
  const pruneStore = deps.pruneStore || createPruneStore(sql);
  let lockPid = null;
  try {
    const preflight = await (deps.preflight || readOnlyStagePreflight)(sql);
    lockPid = await acquireLock(sql);
    if (!lockPid) return { state: "no-op", reason: "advisory_lock_busy", deployedCommitSha, preflight };
    await assertLock(sql, lockPid);
    await (deps.verifyBucket || verifyArchiveBucket)(storageTarget, deps);
    const generated = await (deps.readAllowlist || readLegacyAllowlist)(sql, {
      cutoff: LEGACY_STAGE_ALLOWLIST_CUTOFF,
      sourceRun: LEGACY_STAGE_ALLOWLIST_SOURCE_RUN,
      expectedProjectRef: STAGE_PROJECT_REF,
      expectedSystemIdentifier: STAGE_SYSTEM_IDENTIFIER,
    });
    const plan = buildLegacyPlan(
      generated.masterManifest,
      generated.batchManifest,
    );
    plan.masterManifest = generated.masterManifest;
    plan.batchManifest = generated.batchManifest;
    const localPlan = writeLegacyPlanFiles(tempRoot, plan);
    await assertLock(sql, lockPid);

    const artifactPath = path.join(tempRoot, "legacy-stage-batch-001.archive.jsonl.gz");
    const manifestPath = path.join(tempRoot, "legacy-stage-batch-001.archive.manifest.json");
    const exported = await (deps.exportArchive || runExport)({
      argv: [
        "--target", "stage", "--cutoff", plan.cutoff,
        "--batch-size", "5000", "--output", artifactPath, "--manifest", manifestPath,
      ],
      env: moduleEnv,
      cwd: tempRoot,
      deps: {
        sql,
        selector: "legacy-stage-allowlist-v1",
        schemaVersion: BOT_ONLY_EXPORT_SCHEMA_VERSION,
        sourcePolicyId: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
        legacyStageAllowlist: plan.archiveManifest,
        targetOptions: { singleTarget: true },
        noCandidateIfEmpty: true,
        emit: false,
      },
    });
    if (exported.noCandidate) {
      return {
        state: "no-op",
        reason: "legacy_batch_changed",
        deployedCommitSha,
        preflight,
        cutoff: plan.cutoff,
        sourceRun: plan.sourceRun,
        querySha256: plan.querySha256,
        allowlistSha256: plan.allowlistSha256,
        batchTableIdsSha256: plan.batchTableIdsSha256,
        masterManifestSha256: plan.masterManifestSha256,
        batchManifestSha256: plan.batchManifestSha256,
      };
    }
    await (deps.ensureBucket || ensureArchiveBucket)(storageTarget, deps);
    const planObjects = [];
    for (const object of planStorageObjects(plan, localPlan.files)) {
      planObjects.push(await (deps.uploadPlan || uploadOrVerifyPrivateObject)({
        storageTarget,
        objectPath: object.objectPath,
        bytes: object.bytes,
        deps,
      }));
    }
    await assertLock(sql, lockPid);
    const stored = await (deps.storeArchive || storeArchive)({
      argv: ["--target", "stage", "--artifact", artifactPath, "--manifest", manifestPath],
      env: moduleEnv,
      cwd: tempRoot,
      deps: { ...deps, sql, storageTarget, targetOptions: { singleTarget: true }, emit: false },
    });
    let row = await pruneStore.getManifest(stored.objectPath);
    const registered = await (deps.pruneArchive || pruneArchive)({
      argv: ["--target", "stage", "--object-path", row.object_path, "--confirm-sha", row.compressed_sha256, "--register-proof"],
      env: moduleEnv,
      cwd: tempRoot,
      deps: { ...deps, sql, pruneStore, storageTarget, verifyBucket: deps.verifyBucket, emit: false },
    });
    row = await pruneStore.getManifest(row.object_path);
    const dryRun = await (deps.pruneArchive || pruneArchive)({
      argv: ["--target", "stage", "--object-path", row.object_path, "--confirm-sha", row.compressed_sha256],
      env: moduleEnv,
      cwd: tempRoot,
      deps: { ...deps, sql, pruneStore, storageTarget, verifyBucket: deps.verifyBucket, emit: false },
    });
    if (dryRun.state !== "ready") fail(`legacy Stage allowlist dry-run returned ${dryRun.state}`);
    const main = await (deps.downloadArchive || downloadPrivateArchiveObject)(storageTarget, row.object_path, deps);
    const durable = await persistDurableRecovery(storageTarget, row, preflight.systemIdentifier, dryRun.evidence, main.bytes, deps);
    return {
      state: "prepared",
      mode: "prepare-only",
      reason: "legacy_batch_ready_for_human_go",
      deployedCommitSha,
      preflight,
      sourceRun: plan.sourceRun,
      cutoff: plan.cutoff,
      querySha256: plan.querySha256,
      allowlistSha256: plan.allowlistSha256,
      batchTableIdsSha256: plan.batchTableIdsSha256,
      masterManifestSha256: plan.masterManifestSha256,
      batchManifestSha256: plan.batchManifestSha256,
      masterTableCount: plan.masterTableCount,
      batchNumber: plan.batchNumber,
      batchTableIds: plan.batchTableIds,
      batchTableCount: plan.batchTableCount,
      batchId: row.batch_id,
      objectPath: row.object_path,
      tableCount: dryRun.evidence.legacyTableIds?.length || plan.batchTableCount,
      transactions: dryRun.evidence.transactionCount,
      entries: dryRun.evidence.entryCount,
      rawBytes: Number(row.raw_bytes),
      compressedBytes: Number(row.compressed_bytes),
      rawSha256: row.raw_sha256,
      compressedSha256: row.compressed_sha256,
      proof: registered,
      dryRun,
      planObjects,
      recovery: {
        archivePath: buildRecoveryArchiveObjectPath(row.compressed_sha256),
        manifestPath: buildRecoveryManifestObjectPath(row.compressed_sha256),
        archiveSha256: durable.recoveryArchive.sha256,
        manifestSha256: durable.recoveryManifest.sha256,
      },
      humanGo: {
        function: "public.chips_authorize_legacy_stage_allowlist_batch(bigint,text,text)",
        confirmation: `GO ${row.batch_id}`,
        allowlistSha256: plan.allowlistSha256,
        executeAfterAuthorization: "node scripts/ops/chips-ledger-archive-prune.mjs --target stage --object-path <exact object_path> --confirm-sha <exact compressed_sha256> --execute --approved-batch-id <exact batch_id> --recovery-dir <private dir>",
      },
    };
  } finally {
    if (lockPid) {
      try { await releaseLock(sql); } catch { /* connection close releases the advisory lock */ }
    }
    if (ownsSql) await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLegacyStagePrepareOnly().then((result) => {
    process.stdout.write(`${stringifyJson({ event: "chips_ledger_legacy_stage_allowlist", ...result })}\n`);
  }).catch((error) => {
    process.stderr.write(`chips-ledger-legacy-stage-allowlist failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
