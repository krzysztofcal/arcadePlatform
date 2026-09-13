import crypto from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { assertProfileIdentity } from "./chips-ledger-retention-profile.mjs";
import {
  ARCHIVE_MAX_BYTES,
  ARCHIVE_MIME_TYPE,
  readPrivateObjectIfExists,
  uploadOrVerifyPrivateObject,
} from "../chips-ledger-archive-store.mjs";

export const PRODUCTION_ESCROW_POLICY_ID = "production-ledger-escrow-account-retention-v1";
export const PRODUCTION_ESCROW_MAX_ACCOUNTS = 2;
export const RETRYABLE_ESCROW_SQLSTATES = Object.freeze(["40001", "55P03"]);
export const ACCOUNT_RECOVERY_SCHEMA_VERSION = 1;
export const ACCOUNT_RECOVERY_MIME_TYPE = ARCHIVE_MIME_TYPE;
export const ACCOUNT_RECOVERY_MAX_BYTES = ARCHIVE_MAX_BYTES;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const RECOVERY_PATH_RE = /^account-recovery\/v1\/sha256\/([0-9a-f]{64})\.json\.gz$/;

function text(value) {
  return value == null ? "" : String(value).trim();
}

function fail(message) {
  throw new Error(message);
}

function canonicalUuid(value, label) {
  const normalized = text(value).toLowerCase();
  if (!UUID_RE.test(normalized)) fail(`${label} is not a canonical UUID`);
  return normalized;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalJsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

export function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function accountSnapshot(account) {
  return {
    id: canonicalUuid(account.id, "account ID"),
    user_id: account.user_id == null ? null : canonicalUuid(account.user_id, "account user ID"),
    system_key: text(account.system_key),
    account_type: text(account.account_type),
    status: text(account.status),
    label: account.label == null ? null : String(account.label),
    balance: text(account.balance),
    next_entry_seq: text(account.next_entry_seq),
    created_at: text(account.created_at),
    updated_at: text(account.updated_at),
  };
}

function targetName(profile) {
  return profile?.target === "production" ? "prod" : "stage";
}

function productionOrStagePolicy(profile) {
  return profile?.policies?.botOnly7d || (profile?.target === "production"
    ? "production-ledger-bot-only-retention-7d-v1"
    : "stage-ledger-bot-only-retention-7d-v1");
}

export function buildAccountRecoverySnapshot({ profile, batch, accounts, tableIds } = {}) {
  assertProfileIdentity(profile);
  const sourcePolicyId = productionOrStagePolicy(profile);
  const normalizedAccounts = (accounts || []).map(accountSnapshot).sort((left, right) => left.id.localeCompare(right.id));
  const accountIds = canonicalAccountIds(normalizedAccounts.map((account) => account.id));
  const normalizedTableIds = [...new Set((tableIds || []).map((id) => canonicalUuid(id, "table ID")))].sort();
  if (!batch || text(batch.project_ref) !== profile.projectRef
    || text(batch.source_policy_id) !== sourcePolicyId
    || Number(batch.format_version) !== 2
    || !SHA256_RE.test(text(batch.compressed_sha256))
    || text(batch.object_path) !== `v1/sha256/${text(batch.compressed_sha256)}.jsonl.gz`) {
    fail(`account recovery requires a canonical ${profile.label} bot-only archive batch`);
  }
  if (normalizedAccounts.length !== normalizedTableIds.length) fail("account recovery account/table cardinality differs");
  const bindings = normalizedTableIds.map((tableId) => {
    const account = normalizedAccounts.find((candidate) => candidate.system_key === `POKER_TABLE:${tableId}`);
    if (!account) fail(`account recovery has no account for table ${tableId}`);
    return { table_id: tableId, account_id: account.id };
  });
  return {
    recovery_schema_version: ACCOUNT_RECOVERY_SCHEMA_VERSION,
    artifact_type: "chips_ledger_escrow_account_recovery",
    target: targetName(profile),
    project_ref: profile.projectRef,
    postgres_system_identifier: profile.systemIdentifier,
    archive_batch: {
      batch_id: text(batch.batch_id),
      source_policy_id: text(batch.source_policy_id),
      object_path: text(batch.object_path),
      compressed_sha256: text(batch.compressed_sha256),
      raw_sha256: text(batch.raw_sha256),
      format_version: Number(batch.format_version),
      cutoff: text(batch.cutoff),
      transaction_count: text(batch.transaction_count),
      entry_count: text(batch.entry_count),
      table_ids: normalizedTableIds,
      archive_proof: {
        transaction_ids_sha256: text(batch.archived_transaction_ids_sha256),
        entry_ids_sha256: text(batch.archived_entry_ids_sha256),
        verified_at: text(batch.archive_proof_verified_at),
      },
      prune_receipt: {
        at: text(batch.pruned_at),
        transaction_count: text(batch.pruned_transaction_count),
        entry_count: text(batch.pruned_entry_count),
        transaction_ids_sha256: text(batch.pruned_transaction_ids_sha256),
        entry_ids_sha256: text(batch.pruned_entry_ids_sha256),
      },
      registry_cleanup_receipt: {
        at: text(batch.registry_cleaned_at),
        key_count: text(batch.registry_cleaned_key_count),
        keys_sha256: text(batch.registry_cleaned_keys_sha256),
      },
      destructive_go: {
        at: text(batch.destructive_go_at),
        batch_id: text(batch.destructive_go_batch_id),
      },
      bot_only_proof: {
        table_id: canonicalUuid(batch.bot_only_table_id, "bot-only table ID"),
        table_count: Number(batch.bot_only_table_count),
        newest_created_at: text(batch.bot_only_newest_created_at),
        registry_keys_sha256: text(batch.bot_only_registry_keys_sha256),
        out_of_scope_keys_sha256: text(batch.bot_only_out_of_scope_keys_sha256),
        identity_count: Number(batch.bot_only_identity_count),
        eligible_count: Number(batch.bot_only_eligible_count),
        table_exists: batch.bot_only_table_exists == null
          ? null
          : batch.bot_only_table_exists === true || batch.bot_only_table_exists === "t",
        retention_complete_at: batch.bot_only_retention_complete_at == null
          ? null
          : text(batch.bot_only_retention_complete_at),
      },
    },
    account_ids: accountIds,
    account_table_bindings: bindings,
    accounts: normalizedAccounts,
  };
}

export function serializeAccountRecovery(snapshot) {
  const canonicalBytes = canonicalJsonBytes(snapshot);
  const snapshotSha256 = sha256Hex(canonicalBytes);
  const compressedBytes = gzipSync(canonicalBytes, { level: 9, mtime: 0 });
  const compressedSha256 = sha256Hex(compressedBytes);
  return {
    snapshot,
    canonicalBytes,
    compressedBytes,
    snapshotSha256,
    compressedSha256,
    objectPath: `account-recovery/v1/sha256/${compressedSha256}.json.gz`,
    mimeType: ACCOUNT_RECOVERY_MIME_TYPE,
  };
}

export function verifyAccountRecoveryBytes({ profile, bytes, objectPath, mimeType = ACCOUNT_RECOVERY_MIME_TYPE, expectedSnapshot = null, expectedSnapshotSha256 = null, expectedAccountIds = null } = {}) {
  assertProfileIdentity(profile);
  const input = Buffer.from(bytes || []);
  const pathMatch = RECOVERY_PATH_RE.exec(text(objectPath));
  if (mimeType !== ACCOUNT_RECOVERY_MIME_TYPE || input.length < 1 || input.length > ACCOUNT_RECOVERY_MAX_BYTES
    || !pathMatch || pathMatch[1] !== sha256Hex(input)) fail("account recovery object identity is invalid");
  let decoded;
  try { decoded = gunzipSync(input); } catch { fail("account recovery object is not valid gzip"); }
  let parsed;
  try { parsed = JSON.parse(decoded.toString("utf8")); } catch { fail("account recovery object is not valid JSON"); }
  if (!parsed || parsed.recovery_schema_version !== ACCOUNT_RECOVERY_SCHEMA_VERSION
    || parsed.artifact_type !== "chips_ledger_escrow_account_recovery"
    || parsed.target !== targetName(profile)
    || parsed.project_ref !== profile.projectRef
    || parsed.postgres_system_identifier !== profile.systemIdentifier
    || !Buffer.from(canonicalJsonBytes(parsed)).equals(decoded)) fail("account recovery schema is not canonical or target-bound");
  const snapshotSha256 = sha256Hex(decoded);
  if (expectedSnapshotSha256 != null && text(expectedSnapshotSha256) !== snapshotSha256) fail("account recovery snapshot SHA-256 differs");
  if (expectedSnapshot != null && canonicalJson(parsed) !== canonicalJson(expectedSnapshot)) fail("account recovery snapshot differs");
  const ids = canonicalAccountIds(parsed.account_ids);
  if (!Array.isArray(parsed.accounts) || parsed.accounts.length !== ids.length) fail("account recovery account set is invalid");
  if (expectedAccountIds != null && accountIdsSha256(expectedAccountIds) !== accountIdsSha256(ids)) fail("account recovery account ID set differs");
  if (canonicalJson(parsed.accounts.map((account) => account.id)) !== canonicalJson(ids)) fail("account recovery account IDs are not canonical");
  const archive = parsed.archive_batch;
  if (!archive || !Array.isArray(archive.table_ids) || archive.source_policy_id !== productionOrStagePolicy(profile)
    || archive.table_ids.length !== ids.length
    || text(archive.object_path) !== `v1/sha256/${text(archive.compressed_sha256)}.jsonl.gz`
    || !SHA256_RE.test(text(archive.compressed_sha256))
    || !SHA256_RE.test(text(archive.raw_sha256))) fail("account recovery archive binding is invalid");
  const tableIds = [...new Set(archive.table_ids.map((id) => canonicalUuid(id, "recovery table ID")))].sort();
  if (canonicalJson(tableIds) !== canonicalJson(archive.table_ids) || tableIds.length !== ids.length) fail("account recovery table set is invalid");
  if (tableIds.length !== 1 || canonicalUuid(archive.bot_only_proof?.table_id, "bot-only recovery table ID") !== tableIds[0]
    || Number(archive.bot_only_proof?.table_count) !== 1
    || !SHA256_RE.test(text(archive.bot_only_proof?.registry_keys_sha256))) fail("account recovery bot-only proof is invalid");
  const normalizedAccounts = parsed.accounts.map((account) => {
    const normalized = accountSnapshot(account);
    if (canonicalJson(normalized) !== canonicalJson(account) || normalized.account_type !== "ESCROW"
      || normalized.user_id !== null || normalized.status !== "active" || normalized.balance !== "0") {
      fail("account recovery contains a non-retirable account");
    }
    const tableId = accountTableIdFromSystemKey(normalized.system_key);
    if (!tableId || !tableIds.includes(tableId) || !/^[0-9]+$/.test(normalized.next_entry_seq)) fail("account recovery account binding is invalid");
    return normalized;
  });
  if (canonicalJson(parsed.account_table_bindings) !== canonicalJson(tableIds.map((tableId) => ({
    table_id: tableId,
    account_id: normalizedAccounts.find((account) => accountTableIdFromSystemKey(account.system_key) === tableId)?.id || null,
  })))) fail("account recovery table/account bindings are invalid");
  return { parsed, bytes: input, decoded, size: input.length, sha256: pathMatch[1], snapshotSha256, objectPath, mimeType };
}

export async function ensureAccountRecoveryObject({ profile, storageTarget, recovery, deps = {}, expectedSnapshot = null, expectedAccountIds = null, allowCreate = true } = {}) {
  const read = deps.readPrivateObject || readPrivateObjectIfExists;
  const upload = deps.uploadPrivateObject || uploadOrVerifyPrivateObject;
  let object = await read(storageTarget, recovery.objectPath, deps);
  let uploaded = false;
  if (object) {
    verifyAccountRecoveryBytes({ profile, bytes: object.bytes, objectPath: recovery.objectPath, mimeType: object.mimeType, expectedSnapshot, expectedSnapshotSha256: recovery.snapshotSha256, expectedAccountIds });
  } else {
    if (!allowCreate) fail(`account recovery object is absent: ${recovery.objectPath}`);
    const result = await upload({ storageTarget, objectPath: recovery.objectPath, bytes: recovery.compressedBytes, mimeType: ACCOUNT_RECOVERY_MIME_TYPE, deps });
    uploaded = result?.uploaded === true;
  }
  object = await read(storageTarget, recovery.objectPath, deps);
  if (!object) fail(`account recovery object is not visible after write: ${recovery.objectPath}`);
  const verified = verifyAccountRecoveryBytes({ profile, bytes: object.bytes, objectPath: recovery.objectPath, mimeType: object.mimeType, expectedSnapshot, expectedSnapshotSha256: recovery.snapshotSha256, expectedAccountIds });
  return { ...recovery, object: verified, uploaded, storageState: "complete", storageWrites: uploaded ? 1 : 0 };
}

export function canonicalAccountIds(ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(id)))) fail("escrow account IDs must be a non-empty UUID list");
  const normalized = ids.map((id) => text(id).toLowerCase());
  if (new Set(normalized).size !== normalized.length || normalized.some((id, index) => index > 0 && normalized[index - 1] >= id)) fail("escrow account IDs must be sorted and unique");
  return normalized;
}

export function accountIdsSha256(ids) {
  const canonical = canonicalAccountIds(ids);
  return crypto.createHash("sha256").update(`${canonical.join("\n")}\n`, "utf8").digest("hex");
}

export function accountTableIdFromSystemKey(systemKey) {
  const match = /^POKER_TABLE:([0-9a-f-]{36})$/i.exec(text(systemKey));
  return match ? match[1].toLowerCase() : null;
}

export function classifyEscrowAccount(account, { expectedTableIds = new Set(), referencedAccountIds = new Set() } = {}) {
  const id = text(account?.id).toLowerCase();
  const systemKey = text(account?.system_key);
  const match = /^POKER_TABLE:([0-9a-f-]{36})$/i.exec(systemKey);
  if (account?.account_type !== "ESCROW" || !match) return { eligible: false, reason: "not_poker_table_escrow" };
  if (account.balance !== 0 && String(account.balance) !== "0") return { eligible: false, reason: "non_zero_balance" };
  if (referencedAccountIds.has(id)) return { eligible: false, reason: "hot_reference" };
  if (expectedTableIds.size && !expectedTableIds.has(match[1].toLowerCase())) return { eligible: false, reason: "foreign_table" };
  return { eligible: true, accountId: id, tableId: match[1].toLowerCase() };
}

export function limitEscrowCandidates(candidates, { maxBatches = 1, maxAccounts = PRODUCTION_ESCROW_MAX_ACCOUNTS } = {}) {
  const selected = [];
  let accountCount = 0;
  for (const candidate of candidates || []) {
    const accountIds = canonicalAccountIds(candidate.accountIds || []);
    if (selected.length >= maxBatches || accountCount + accountIds.length > maxAccounts) break;
    selected.push({ ...candidate, accountIds });
    accountCount += accountIds.length;
  }
  return selected;
}

export function assertProductionEscrowProfile(profile) {
  assertProfileIdentity(profile, { projectRef: "otbqfijerkieoxwpxjnm", systemIdentifier: "7575202818581710058" });
  if (profile.policies?.escrow !== PRODUCTION_ESCROW_POLICY_ID || profile.maxEscrowAccounts !== PRODUCTION_ESCROW_MAX_ACCOUNTS) fail("Production escrow profile is not bounded to the approved contract");
  return profile;
}

export async function runWithEscrowRetry({
  execute,
  revalidate,
  maxAttempts = 3,
  sleep = async () => {},
  onAttempt = null,
  onRetry = null,
  getSqlState = (error) => text(error?.code || error?.sqlstate),
  retryableStates = RETRYABLE_ESCROW_SQLSTATES,
} = {}) {
  if (typeof execute !== "function") fail("escrow execute callback is required");
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) fail("escrow retry limit is invalid");
  const retryLimit = Math.min(maxAttempts, 3);
  const sqlstates = [];
  let retryCount = 0;
  for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
    if (typeof onAttempt === "function") await onAttempt({ attempt, retryCount, sqlstates: [...sqlstates] });
    try {
      const result = await execute({ attempt, retryCount, sqlstates: [...sqlstates] });
      return { result, attempts: attempt, retryCount, sqlstates };
    } catch (error) {
      const sqlstate = text(getSqlState(error));
      sqlstates.push(sqlstate || null);
      Object.assign(error, {
        executeAttempts: attempt,
        executeRetryCount: retryCount,
        executeSqlstates: [...sqlstates],
      });
      if (!retryableStates.includes(sqlstate) || attempt === retryLimit) throw error;
      retryCount += 1;
      try {
        if (typeof onRetry === "function") await onRetry({
          attempt,
          nextAttempt: attempt + 1,
          retryCount,
          sqlstate,
          sqlstates: [...sqlstates],
        });
        if (typeof revalidate === "function") await revalidate({
          attempt,
          nextAttempt: attempt + 1,
          retryCount,
          sqlstate,
          sqlstates: [...sqlstates],
        });
        await sleep(attempt);
      } catch (revalidationError) {
        Object.assign(revalidationError, {
          executeAttempts: attempt,
          executeRetryCount: retryCount,
          executeSqlstates: [...sqlstates],
          retryCauseSqlstate: sqlstate,
          attempt: attempt + 1,
        });
        throw revalidationError;
      }
    }
  }
  fail("escrow retry budget was exhausted");
}
