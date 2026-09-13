import crypto from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { assertProfileIdentity, validateRetentionEnvironment } from "./chips-ledger-retention-profile.mjs";
import {
  buildRecoveryArchiveObjectPath,
  buildRecoveryManifestObjectPath,
  readPrivateObjectIfExists,
  uploadOrVerifyPrivateObject,
} from "../chips-ledger-archive-store.mjs";
import { buildRecoveryManifest } from "../chips-ledger-archive-prune.mjs";

export const RETENTION_CYCLE_STATES = Object.freeze({
  COMPLETE: "complete",
  NO_OP: "no-op",
  BUSY: "busy",
  DISABLED: "disabled",
  BLOCKED: "blocked",
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

function text(value) {
  return value == null ? "" : String(value).trim();
}

function fail(message, code = null) {
  const error = new Error(message);
  if (code) error.code = code;
  throw error;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function assertRecoveryManifestShape(manifest, row, profile, evidence = null) {
  if (!manifest || manifest.artifact_type !== "chips_ledger_archive_prune_recovery"
    || manifest.target !== (profile.target === "production" ? "prod" : "stage")
    || manifest.project_ref !== profile.projectRef
    || manifest.postgres_system_identifier !== profile.systemIdentifier
    || manifest.object_path !== row.object_path
    || manifest.source_policy_id !== (row.source_policy_id || null)) {
    fail("durable recovery manifest identity differs from the active cycle", "recovery_mismatch");
  }
  if (manifest.archive?.compressed_sha256 !== row.compressed_sha256
    || manifest.archive?.raw_sha256 !== row.raw_sha256
    || String(manifest.archive?.transaction_count) !== String(row.transaction_count)
    || String(manifest.archive?.entry_count) !== String(row.entry_count)
    || manifest.id_proof?.transaction_ids_sha256 !== row.archived_transaction_ids_sha256
    || manifest.id_proof?.entry_ids_sha256 !== row.archived_entry_ids_sha256) {
    fail("durable recovery manifest proof differs from the committed manifest", "recovery_mismatch");
  }
  if (evidence) {
    const expected = buildRecoveryManifest(
      row,
      profile.systemIdentifier,
      evidence,
      { target: profile.target === "production" ? "prod" : "stage" },
    );
    if (canonicalJson(manifest) !== canonicalJson(expected)) {
      fail("durable recovery manifest differs from the immutable evidence", "recovery_mismatch");
    }
  }
  return manifest;
}

export async function inspectDurableRecoveryState(storageTarget, row, profile, evidence = null, deps = {}) {
  const read = deps.readPrivateObjectIfExists || readPrivateObjectIfExists;
  const archivePath = buildRecoveryArchiveObjectPath(row.compressed_sha256);
  const manifestPath = buildRecoveryManifestObjectPath(row.compressed_sha256);
  const [archive, manifest] = await Promise.all([
    read(storageTarget, archivePath, deps),
    read(storageTarget, manifestPath, deps),
  ]);
  if (!archive && !manifest) return { state: "both_missing", durable: null };
  if (!archive || !manifest) return { state: "partial", durable: null };
  if (archive.sha256 !== row.compressed_sha256) return { state: "mismatch", durable: null };
  let manifestBytes;
  try {
    manifestBytes = gunzipSync(manifest.bytes);
  } catch {
    return { state: "mismatch", durable: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    return { state: "mismatch", durable: null };
  }
  assertRecoveryManifestShape(parsed, row, profile, evidence);
  return {
    state: "complete",
    durable: {
      state: "complete",
      archivePath,
      manifestPath,
      archiveBytes: archive.bytes,
      manifestGzipBytes: manifest.bytes,
      manifestBytes,
      manifest: parsed,
      archiveSha256: archive.sha256,
      manifestSha256: sha256(manifest.bytes),
      archive: { objectPath: row.object_path, sha256: row.compressed_sha256 },
      projectRef: profile.projectRef,
      systemIdentifier: profile.systemIdentifier,
      sourcePolicyId: row.source_policy_id,
      batchId: row.batch_id,
      transactionIdsSha256: row.archived_transaction_ids_sha256,
      entryIdsSha256: row.archived_entry_ids_sha256,
      recoveryArchive: { objectPath: archivePath, sha256: archive.sha256 },
      recoveryManifest: { objectPath: manifestPath, sha256: sha256(manifest.bytes) },
    },
  };
}

export async function inspectDurableRecovery(storageTarget, row, profile, evidence = null, deps = {}) {
  const inspected = await inspectDurableRecoveryState(storageTarget, row, profile, evidence, deps);
  if (inspected.state === "both_missing") return null;
  if (inspected.state !== "complete") fail(`durable recovery state is ${inspected.state}`, "recovery_incomplete");
  return inspected.durable;
}

export async function persistDurableRecovery(storageTarget, row, profile, evidence, archiveBytes, deps = {}) {
  if (sha256(archiveBytes) !== row.compressed_sha256) fail("verified archive checksum differs before recovery copy");
  const target = { target: profile.target === "production" ? "prod" : "stage" };
  const manifest = buildRecoveryManifest(row, profile.systemIdentifier, evidence, target);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
  const manifestGzipBytes = gzipSync(manifestBytes, { level: 9, mtime: 0 });
  const existing = await inspectDurableRecoveryState(storageTarget, row, profile, evidence, deps);
  if (existing.state === "complete") return existing.durable;
  if (existing.state !== "both_missing") fail(`durable recovery state is ${existing.state}`, "recovery_incomplete");
  const recoveryArchive = await (deps.uploadOrVerifyPrivateObject || uploadOrVerifyPrivateObject)({
    storageTarget,
    objectPath: buildRecoveryArchiveObjectPath(row.compressed_sha256),
    bytes: archiveBytes,
    deps,
  });
  const recoveryManifest = await (deps.uploadOrVerifyPrivateObject || uploadOrVerifyPrivateObject)({
    storageTarget,
    objectPath: buildRecoveryManifestObjectPath(row.compressed_sha256),
    bytes: manifestGzipBytes,
    deps,
  });
  const durable = await inspectDurableRecovery(storageTarget, row, profile, evidence, deps);
  return {
    ...durable,
    recoveryArchive,
    recoveryManifest,
  };
}

export function findOwnCycle(rows = [], sourcePolicyId, { activeStates = ["pending", "committed"] } = {}) {
  if (!sourcePolicyId) fail("retention cycle policy is required");
  const own = rows.filter((row) => row?.source_policy_id === sourcePolicyId);
  const active = own.filter((row) => activeStates.includes(row.status) && row.pruned_at == null);
  if (active.length > 1) fail(`retention cycle has ambiguous durable state for ${sourcePolicyId}`, "retention_ambiguous_cycle");
  const completed = own
    .filter((row) => row.pruned_at != null)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
  return { active: active[0] || null, latestCompleted: completed[0] || null, ownRows: own };
}

export function assertDurableRecoveryReady(durable) {
  if (!durable || durable.state !== "complete") fail("durable recovery is not complete", "recovery_incomplete");
  if (!durable.archive || !durable.recoveryArchive || !durable.recoveryManifest) fail("durable recovery copies are incomplete", "recovery_incomplete");
  for (const [label, value] of Object.entries({
    archive: durable.archive.sha256,
    recoveryArchive: durable.recoveryArchive.sha256,
    recoveryManifest: durable.recoveryManifest.sha256,
  })) {
    if (!SHA256_RE.test(text(value))) fail(`${label} recovery hash is invalid`, "recovery_mismatch");
  }
  return durable;
}

export function assertDurableRecoveryForEvidence({ durable, identity, projectRef, sourcePolicyId, batchId, transactionIdsSha256, entryIdsSha256 }) {
  assertDurableRecoveryReady(durable);
  if (durable.projectRef !== projectRef || durable.systemIdentifier !== identity || durable.sourcePolicyId !== sourcePolicyId) {
    fail("durable recovery identity or policy does not match the active cycle", "recovery_mismatch");
  }
  if (text(durable.batchId) !== text(batchId)) fail("durable recovery batch does not match the active cycle", "recovery_mismatch");
  if (transactionIdsSha256 && durable.transactionIdsSha256 !== transactionIdsSha256) fail("durable recovery transaction proof differs", "recovery_mismatch");
  if (entryIdsSha256 && durable.entryIdsSha256 !== entryIdsSha256) fail("durable recovery entry proof differs", "recovery_mismatch");
  return durable;
}

export function assertResumeRecoveryState(row, durable, profile) {
  assertProfileIdentity(profile, { projectRef: row?.project_ref, systemIdentifier: durable?.systemIdentifier });
  if (!row || !text(row.batch_id) || !row.object_path || row.status !== "committed") fail("resume requires one committed durable archive batch", "resume_blocked");
  return assertDurableRecoveryForEvidence({
    durable,
    identity: profile.systemIdentifier,
    projectRef: profile.projectRef,
    sourcePolicyId: row.source_policy_id,
    batchId: row.batch_id,
    transactionIdsSha256: row.archived_transaction_ids_sha256,
    entryIdsSha256: row.archived_entry_ids_sha256,
  });
}

function hashLockKey(lockKey) {
  return crypto.createHash("sha256").update(lockKey).digest("hex");
}

export async function acquireRetentionAdvisoryLock(sql, profile, { sleep = null } = {}) {
  if (!sql || typeof sql.unsafe !== "function") fail("retention PostgreSQL session is required");
  assertProfileIdentity(profile);
  const lockHash = hashLockKey(profile.lockKey);
  const rows = await sql.unsafe(`select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired, pg_backend_pid()::text as backend_pid;`, [profile.lockKey]);
  const acquired = rows[0]?.acquired === true || rows[0]?.acquired === "t";
  if (!acquired) return null;
  return { backendPid: text(rows[0]?.backend_pid), lockKey: profile.lockKey, lockHash, sleep };
}

export async function assertRetentionAdvisoryLock(sql, lockSession) {
  if (!lockSession?.backendPid) fail("retention advisory lock session is missing", "lock_missing");
  const rows = await sql.unsafe("select pg_backend_pid()::text as backend_pid;");
  if (text(rows[0]?.backend_pid) !== lockSession.backendPid) fail("retention advisory lock session changed", "lock_lost");
  return true;
}

export async function releaseRetentionAdvisoryLock(sql, lockSession) {
  if (!lockSession?.lockKey) return false;
  const rows = await sql.unsafe("select pg_advisory_unlock(hashtextextended($1, 0)) as released;", [lockSession.lockKey]);
  return rows[0]?.released === true || rows[0]?.released === "t";
}

export async function runRetentionCycle({
  target,
  env = process.env,
  mode = "diagnostic",
  policyId,
  deps = {},
  automatic = false,
} = {}) {
  const profile = deps.profile || validateRetentionEnvironment(target, env, { requireCommitSha: true });
  if (automatic && !profile.automationEnabled) return { state: RETENTION_CYCLE_STATES.DISABLED, profile: profile.target, policyId, processed: 0 };
  if (typeof deps.read !== "function") return { state: RETENTION_CYCLE_STATES.NO_OP, profile: profile.target, policyId, processed: 0 };
  const identity = await deps.read({ profile, mode, policyId });
  if (identity?.projectRef && identity.projectRef !== profile.projectRef) fail("retention cycle read returned the wrong project", "identity_mismatch");
  if (identity?.systemIdentifier && identity.systemIdentifier !== profile.systemIdentifier) fail("retention cycle read returned the wrong database", "identity_mismatch");
  if (!Number.isSafeInteger(profile.maxCanaryBatchSize) || profile.maxCanaryBatchSize < 1) fail("retention cycle has no valid batch bound");
  if (mode === "diagnostic") return { state: "diagnosed", profile: profile.target, policyId, identity, processed: 0 };
  if (mode === "prepare") {
    if (typeof deps.prepare !== "function") return { state: "prepared", profile: profile.target, policyId, identity, processed: 0 };
    return deps.prepare({ profile, mode, policyId, identity, maxTransactions: profile.maxCanaryBatchSize });
  }
  if (mode !== "canary" && mode !== "automatic") fail(`unsupported retention cycle mode: ${mode}`);
  if (typeof deps.execute !== "function") fail("retention cycle execute adapter is required", "execute_unavailable");
  return deps.execute({ profile, mode, policyId, identity, maxTransactions: profile.maxCanaryBatchSize });
}

export function assertExactCanaryArgs({ batchId, confirmation, maxTransactions = 2, transactionCount = null }) {
  if (!/^[1-9][0-9]*$/.test(text(batchId)) || confirmation !== `GO ${batchId}`) fail("exact canary batch and GO confirmation are required", "canary_authorization_missing");
  if (transactionCount != null && (!Number.isSafeInteger(transactionCount) || transactionCount < 1 || transactionCount > maxTransactions)) fail("canary transaction count exceeds the target bound", "canary_bound_exceeded");
  return String(batchId);
}

export function assertUuidList(ids, label = "IDs") {
  if (!Array.isArray(ids) || ids.length < 1 || ids.some((id) => !UUID_RE.test(text(id)))) fail(`${label} must be a non-empty UUID list`);
  const normalized = ids.map((id) => text(id).toLowerCase());
  if (new Set(normalized).size !== normalized.length || normalized.some((id, index) => index > 0 && normalized[index - 1] >= id)) fail(`${label} must be unique and sorted`);
  return normalized;
}
