import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import postgres from "postgres";

import {
  assertLegacyStageAllowlistEvidence,
  LEGACY_STAGE_ALLOWLIST_CUTOFF,
  LEGACY_STAGE_ALLOWLIST_POLICY_ID,
  LEGACY_STAGE_ALLOWLIST_SOURCE_RUN,
  LEGACY_STAGE_ALLOWLIST_TABLE_COUNT,
  LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT,
  maxBatchSizeForTarget,
  stringifyJson,
  timestampToMicros,
} from "./chips-ledger-archive-export.mjs";
import {
  buildRecoveryArchiveObjectPath,
  buildRecoveryManifestObjectPath,
  downloadPrivateArchiveObject,
  downloadPrivateObjectIfExists,
  resolveStorageTarget,
  verifyArchiveBucket,
  verifyArchiveBytes,
} from "./chips-ledger-archive-store.mjs";
import {
  buildPruneEvidence,
  buildRecoveryManifest,
  computeArchiveIdProofs,
} from "./chips-ledger-archive-prune.mjs";
import { buildLegacyPlan, loadFrozenLegacyAllowlist } from "./chips-ledger-legacy-stage-allowlist.mjs";
import {
  STAGE_PROJECT_REF,
  STAGE_SYSTEM_IDENTIFIER,
  validateStageEnvironment,
} from "./chips-ledger-stage-automation.mjs";
import {
  assertLegacyStageAllowlistRegistryRows,
  legacyStageAllowlistRegistryPredicate,
} from "./chips-ledger-legacy-stage-allowlist-registry.mjs";

export const LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13 = Object.freeze({
  batchId: "13",
  objectPath: "v1/sha256/a7ff21fef10b1d22b963793d3cf6efd667319a7211ee47c7e6f755f293155e60.jsonl.gz",
  compressedSha256: "a7ff21fef10b1d22b963793d3cf6efd667319a7211ee47c7e6f755f293155e60",
  masterAllowlistSha256: "611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05",
  batchTableIdsSha256: "ded0a77efe84f56d2f4a9706f9d454a09179f6328098ad60ecf45639b4b75895",
  cutoff: "2026-08-17T16:51:28.074Z",
  projectRef: STAGE_PROJECT_REF,
  systemIdentifier: STAGE_SYSTEM_IDENTIFIER,
  formatVersion: 2,
  transactionCount: 60,
  entryCount: 120,
  registryCount: 60,
  rawBytes: 158056,
  compressedBytes: 10476,
  rawSha256: "937e0b466bd67a71e2f191477fe15e919c5411b65aec1bc848c5a9062e7e0248",
  txIdsSha256: "23572e092abe6dee44e3537b8552cab3eb663e69370435c6205864c62f2bf9da",
  entryIdsSha256: "793e1993e45c198c476e1b5926c252542219c1cb7038e09ae96d440600d29a79",
  registryKeysSha256: "621e2d102ee65813e9554cbd3e2c4c79cc5ad1cbcc71c0c10cb8e948182ee81b",
  masterManifestSha256: "eb5593bdf5bd7f3c985373e6037a861d999413eae5076b923165c7f8147a79e7",
  batchManifestSha256: "6011e3ceb819d2c8f21ed9cdf0904831d408b4b6fd1262c0905c6eeb9b4f59f9",
  recoveryManifestSha256: "7fad2c5875053280ba464dfbb9aa3d3faeb9461b83923475300e0c81bf488c44",
  querySha256: "9bd27ff7a2749a879707e823982f708e6abf86beffcdf8f97c5deac05f00ca09",
  freezeRunId: "32771521144",
  diagnosticSourceRun: "32753223679",
  diagnosticSourceRunSha256: "aa82076e7e4d7fd1e027889be94868e5662652cc29ae2dc7b55a4196b260ed0e",
  txTypes: Object.freeze({ TABLE_BUY_IN: 30, TABLE_CASH_OUT: 30 }),
  credits: "6000",
  debits: "6000",
  net: "0",
});

export const LEGACY_STAGE_ALLOWLIST_AUDIT_MIGRATION = Object.freeze({
  version: "20260825100000",
  file: "supabase/migrations/20260825100000_chips_ledger_legacy_stage_allowlist_cleanup_hardening.sql",
});

export const LEGACY_STAGE_ALLOWLIST_AUDIT_MAX_WALL_CLOCK_MS = 150000;
export const LEGACY_STAGE_ALLOWLIST_AUDIT_STORAGE_TIMEOUT_MS = 20000;
export const LEGACY_STAGE_ALLOWLIST_AUDIT_STATEMENT_TIMEOUT = "120s";
export const LEGACY_STAGE_ALLOWLIST_AUDIT_READ_ONLY_TRANSACTION_SQL =
  "set transaction isolation level repeatable read, read only;";
export const LEGACY_STAGE_ALLOWLIST_AUDIT_PRUNER_SIGNATURE =
  "public.chips_prune_legacy_stage_allowlist_batch(text,uuid[],bigint[],uuid[],text,text,text[],boolean,bigint)";
export const LEGACY_STAGE_ALLOWLIST_AUDIT_OLD_PRUNER_SIGNATURE =
  "public.chips_prune_legacy_stage_allowlist_batch(text,uuid[],bigint[],uuid[],text,text,boolean,bigint)";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

export const LEGACY_STAGE_ALLOWLIST_AUDIT_SQL = Object.freeze({
  identity: "select system_identifier::text as system_identifier from pg_catalog.pg_control_system();",
  fence: "select public.chips_table_fence_is_active() as active;",
  enforcement: "select enforcement_active from public.chips_table_fence_control where control_id is true;",
  migration: `select
    (select count(*) from supabase_migrations.schema_migrations where version = $1)::text as applied_count,
    (select count(*) from supabase_migrations.schema_migration_files where version = $1)::text as hash_count,
    (select sha256 from supabase_migrations.schema_migration_files where version = $1 limit 1) as sha256;`,
  overloads: `with expected as (
    select
      pg_catalog.to_regprocedure('${LEGACY_STAGE_ALLOWLIST_AUDIT_PRUNER_SIGNATURE}')::oid::text as expected_oid,
      pg_catalog.to_regprocedure('${LEGACY_STAGE_ALLOWLIST_AUDIT_OLD_PRUNER_SIGNATURE}')::oid::text as legacy_oid
  ), observed as (
    select p.oid, pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_args
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'chips_prune_legacy_stage_allowlist_batch'
  )
  select expected.expected_oid::text as expected_oid,
    expected.legacy_oid::text as legacy_oid,
    count(observed.oid)::text as overload_count,
    count(observed.oid) filter (where observed.oid::text = expected.expected_oid)::text as expected_count,
    count(observed.oid) filter (where observed.oid::text = expected.legacy_oid)::text as legacy_count,
    coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'oid', observed.oid::text,
        'identity_args', observed.identity_args
      ) order by observed.oid
    ) filter (where observed.oid is not null), '[]'::jsonb) as overloads
    from expected
    left join observed on true
   group by expected.expected_oid, expected.legacy_oid;`,
  batch: `select
    object_path, batch_id::text as batch_id, project_ref,
    format_version::text as format_version, cutoff::text as cutoff,
    cursor_start_created_at::text as cursor_start_created_at, cursor_start_id::text as cursor_start_id,
    cursor_end_created_at::text as cursor_end_created_at, cursor_end_id::text as cursor_end_id,
    first_created_at::text as first_created_at, last_created_at::text as last_created_at,
    transaction_count::text as transaction_count, entry_count::text as entry_count,
    tx_types::text as tx_types, raw_bytes::text as raw_bytes, compressed_bytes::text as compressed_bytes,
    raw_sha256, compressed_sha256, credits::text as credits, debits::text as debits, net_amount::text as net_amount,
    status, committed_at::text as committed_at, source_policy_id,
    archived_transaction_ids_sha256, archived_entry_ids_sha256,
    archive_proof_verified_at::text as archive_proof_verified_at,
    pruned_at::text as pruned_at, registry_cleaned_at::text as registry_cleaned_at,
    legacy_allowlist_sha256, legacy_batch_table_ids_sha256, legacy_master_table_ids,
    legacy_master_table_count::text as legacy_master_table_count,
    legacy_batch_number::text as legacy_batch_number,
    legacy_batch_table_count::text as legacy_batch_table_count,
    legacy_source_run, legacy_query_sha256, legacy_stage_system_identifier,
    destructive_go_at::text as destructive_go_at, destructive_go_batch_id::text as destructive_go_batch_id,
    pruned_transaction_count::text as pruned_transaction_count,
    pruned_entry_count::text as pruned_entry_count,
    pruned_transaction_ids_sha256, pruned_entry_ids_sha256,
    registry_cleaned_key_count::text as registry_cleaned_key_count,
    registry_cleaned_keys_sha256
  from public.chips_ledger_archive_batches where batch_id = $1;`,
  proof: `select
    batch_id::text as batch_id, object_path, project_ref, source_policy_id, cutoff::text as cutoff,
    source_run, query_sha256, postgres_system_identifier,
    master_table_count::text as master_table_count, master_table_ids, master_table_ids_sha256,
    batch_number::text as batch_number, batch_table_count::text as batch_table_count,
    batch_table_ids, batch_table_ids_sha256
  from public.chips_legacy_stage_allowlist_proofs where batch_id = $1;`,
  duplicate: `select
    count(*) filter (where source_policy_id = $1 and legacy_allowlist_sha256 = $2
      and legacy_batch_table_ids_sha256 = $3)::text as same_plan_count,
    count(*) filter (where batch_id = $4)::text as target_batch_count
  from public.chips_ledger_archive_batches;`,
  transactions: `select
    id::text as id, sequence::text as sequence, tx_type::text as tx_type, idempotency_key,
    payload_hash, user_id::text as user_id, reference, description, metadata,
    created_by::text as created_by, created_at::text as created_at
  from public.chips_transactions where id = any($1::uuid[]) order by id;`,
  entries: `select
    id::text as id, transaction_id::text as transaction_id, account_id::text as account_id,
    entry_seq::text as entry_seq, amount::text as amount, metadata, created_at::text as created_at
  from public.chips_entries
  where transaction_id = any($1::uuid[]) order by id;`,
  registry: `select
    idempotency_key, transaction_id::text as transaction_id, table_id::text as table_id,
    payload_hash, tx_type::text as tx_type,
    user_id::text as user_id, transaction_created_at::text as transaction_created_at,
    archive_batch_id::text as archive_batch_id
  from public.chips_transaction_idempotency registry
  where ${legacyStageAllowlistRegistryPredicate("$1")}
  order by idempotency_key;`,
  entryShapes: `with selected as materialized (
    select transactions.*
      from public.chips_transactions transactions
     where transactions.id = any($1::uuid[])
  ), registry as materialized (
    select registry.*
      from public.chips_transaction_idempotency registry
     where registry.transaction_id = any($1::uuid[])
  )
  select selected.id::text as transaction_id,
    selected.tx_type::text as tx_type, selected.user_id::text as user_id,
    registry.table_id::text as table_id,
    count(entries.id)::text as entry_count,
    count(*) filter (where accounts.account_type::text = 'USER')::text as user_entry_count,
    count(*) filter (where accounts.account_type::text = 'SYSTEM')::text as system_entry_count,
    count(*) filter (where accounts.account_type::text = 'ESCROW')::text as escrow_entry_count,
    count(*) filter (where accounts.account_type::text = 'ESCROW'
                     and accounts.system_key = 'POKER_TABLE:' || registry.table_id::text)::text as matching_escrow_count,
    count(*) filter (where accounts.status::text = 'active')::text as active_entry_count,
    coalesce(sum(entries.amount), 0)::text as net_amount,
    coalesce(sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM'), 0)::text as system_amount,
    coalesce(sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW'), 0)::text as escrow_amount
    from selected
    join registry on registry.transaction_id = selected.id
    left join public.chips_entries entries on entries.transaction_id = selected.id
    left join public.chips_accounts accounts on accounts.id = entries.account_id
   group by selected.id, selected.tx_type, selected.user_id, registry.table_id
   order by selected.id;`,
  tables: `select
    tables.id::text as table_id, upper(tables.status) as status, tables.has_human_participant,
    tables.bot_only_proof_eligible,
    accounts.id::text as escrow_account_id, accounts.account_type::text as escrow_account_type,
    accounts.system_key as escrow_system_key, accounts.status::text as escrow_status,
    accounts.balance::text as escrow_balance, accounts.next_entry_seq::text as escrow_next_entry_seq
  from public.poker_tables tables
  left join public.chips_accounts accounts
    on accounts.account_type::text = 'ESCROW'
   and accounts.system_key = 'POKER_TABLE:' || tables.id::text
  where tables.id = any($1::uuid[]) order by tables.id;`,
  accounts: `select
    id::text as account_id, account_type::text as account_type, system_key,
    balance::text as balance, next_entry_seq::text as next_entry_seq, status::text as status
  from public.chips_accounts where id = any($1::uuid[]) order by id;`,
  conservation: `select count(*)::text as entry_count,
    coalesce(sum(amount) filter (where amount > 0), 0)::text as credits,
    coalesce(sum(-amount) filter (where amount < 0), 0)::text as debits,
    coalesce(sum(amount), 0)::text as net
  from public.chips_entries where transaction_id = any($1::uuid[]);`,
  prunedHotRows: `select
    (select count(*) from public.chips_transactions
      where id = any($1::uuid[]))::text as hot_transaction_count,
    (select count(*) from public.chips_entries
      where transaction_id = any($1::uuid[]) or id = any($2::bigint[]))::text as hot_entry_count,
    (select count(*) from public.chips_transaction_idempotency
      where idempotency_key = any($3::text[]))::text as hot_registry_count,
    (select count(*) from public.chips_transaction_idempotency
      where archive_batch_id = 13)::text as remaining_registry_count;`,
});

function fail(code, detail = code) {
  const error = new Error(`legacy Stage batch 13 audit failed: ${detail}`);
  error.code = code;
  throw error;
}

function text(value) { return value == null ? "" : String(value).trim(); }
function isTrue(value) { return value === true || value === "t"; }

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function hashCanonicalLines(values) { return sha256(Buffer.from(`${values.join("\n")}\n`, "utf8")); }

function sameTimestamp(left, right) {
  try { return timestampToMicros(left) === timestampToMicros(right); } catch { return false; }
}

function sameJson(left, right) {
  const normalize = (value) => {
    if (typeof value !== "string") return value ?? null;
    try { return JSON.parse(value); } catch { return value; }
  };
  return canonicalJson(normalize(left)) === canonicalJson(normalize(right));
}

function normalizeIdList(values, code) {
  if (!Array.isArray(values)) fail(code);
  const normalized = values.map((value) => text(value).toLowerCase());
  if (normalized.some((value) => !UUID_RE.test(value)) || new Set(normalized).size !== normalized.length) fail(code);
  return normalized;
}

function sameIdList(actual, expected, code) {
  if (canonicalJson(normalizeIdList(actual, code)) !== canonicalJson(expected)) fail(code);
}

function numberValue(value, code) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail(code);
  return parsed;
}

function integerValue(value, code) {
  const normalized = text(value);
  if (!/^-?[0-9]+$/.test(normalized)) fail(code);
  try { return BigInt(normalized); } catch { fail(code); }
}

function countValue(value, code) {
  const parsed = integerValue(value, code);
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) fail(code);
  return Number(parsed);
}

function parseJsonb(value, code) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { fail(code); }
}

export function assertPrunerOverloads(rowInput) {
  const row = rowInput || {};
  const expectedOid = text(row.expected_oid);
  const overloads = parseJsonb(row.overloads, "pruner_overload");
  if (!/^[1-9][0-9]*$/.test(expectedOid)
    || row.legacy_oid !== null
    || countValue(row.overload_count, "pruner_overload") !== 1
    || countValue(row.expected_count, "pruner_overload") !== 1
    || countValue(row.legacy_count, "pruner_overload") !== 0
    || !Array.isArray(overloads)
    || overloads.length !== 1) {
    fail("pruner_overload");
  }
  const observed = overloads[0];
  if (text(observed?.oid) !== expectedOid || typeof observed?.identity_args !== "string" || !observed.identity_args.trim()) {
    fail("pruner_overload");
  }
  return {
    expectedOid,
    legacyOid: row.legacy_oid,
    overloadCount: countValue(row.overload_count, "pruner_overload"),
    overloads,
  };
}

function parseBatchRow(row) {
  if (!row) fail("batch_missing");
  return {
    ...row,
    format_version: numberValue(row.format_version, "batch_format_version"),
    transaction_count: numberValue(row.transaction_count, "transaction_count"),
    entry_count: numberValue(row.entry_count, "entry_count"),
    tx_types: parseJsonb(row.tx_types, "tx_types"),
    raw_bytes: numberValue(row.raw_bytes, "raw_bytes"),
    compressed_bytes: numberValue(row.compressed_bytes, "compressed_bytes"),
    credits: text(row.credits), debits: text(row.debits), net_amount: text(row.net_amount),
    legacy_master_table_count: numberValue(row.legacy_master_table_count, "legacy_master_table_count"),
    legacy_batch_number: numberValue(row.legacy_batch_number, "legacy_batch_number"),
    legacy_batch_table_count: numberValue(row.legacy_batch_table_count, "legacy_batch_table_count"),
    pruned_transaction_count: row.pruned_transaction_count === null
      ? null : numberValue(row.pruned_transaction_count, "pruned_transaction_count"),
    pruned_entry_count: row.pruned_entry_count === null
      ? null : numberValue(row.pruned_entry_count, "pruned_entry_count"),
    registry_cleaned_key_count: row.registry_cleaned_key_count === null
      ? null : numberValue(row.registry_cleaned_key_count, "registry_cleaned_key_count"),
  };
}

function parseProofRow(row) {
  if (!row) fail("proof_missing");
  return {
    ...row,
    master_table_count: numberValue(row.master_table_count, "proof_master_table_count"),
    batch_number: numberValue(row.batch_number, "proof_batch_number"),
    batch_table_count: numberValue(row.batch_table_count, "proof_batch_table_count"),
  };
}

function assertValue(actual, expected, code) { if (actual !== expected) fail(code); }
function assertTimestamp(actual, expected, code) { if (!sameTimestamp(actual, expected)) fail(code); }

export function assertLegacyStageAuditPlan(plan) {
  const expected = LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13;
  if (!plan || plan.policy_id !== LEGACY_STAGE_ALLOWLIST_POLICY_ID) fail("plan_policy");
  assertValue(plan.proof_basis, LEGACY_STAGE_ALLOWLIST_POLICY_ID, "plan_proof_basis");
  assertValue(plan.allowlistSha256, expected.masterAllowlistSha256, "plan_master_hash");
  assertValue(plan.batchTableIdsSha256, expected.batchTableIdsSha256, "plan_batch_hash");
  assertValue(plan.sourceRun, LEGACY_STAGE_ALLOWLIST_SOURCE_RUN, "plan_source_run");
  assertValue(plan.querySha256, expected.querySha256, "plan_query_hash");
  assertValue(plan.stageSystemIdentifier, STAGE_SYSTEM_IDENTIFIER, "plan_system_identifier");
  assertValue(plan.masterTableCount, LEGACY_STAGE_ALLOWLIST_TABLE_COUNT, "plan_master_count");
  assertValue(plan.batchNumber, 1, "plan_batch_number");
  assertValue(plan.batchTableCount, LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT, "plan_batch_count");
  assertTimestamp(plan.cutoff, expected.cutoff, "plan_cutoff");
  const masterIds = normalizeIdList(plan.masterTableIds, "plan_master_ids");
  const batchIds = normalizeIdList(plan.batchTableIds, "plan_batch_ids");
  if (masterIds.length !== LEGACY_STAGE_ALLOWLIST_TABLE_COUNT) fail("plan_master_count");
  if (batchIds.length !== LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT) fail("plan_batch_count");
  if (hashCanonicalLines(masterIds) !== expected.masterAllowlistSha256) fail("plan_master_hash");
  if (hashCanonicalLines(batchIds) !== expected.batchTableIdsSha256) fail("plan_batch_hash");
  if (batchIds.some((id) => !masterIds.includes(id))) fail("plan_batch_membership");
  assertValue(plan.masterManifestSha256, expected.masterManifestSha256, "plan_master_manifest_hash");
  assertValue(plan.batchManifestSha256, expected.batchManifestSha256, "plan_batch_manifest_hash");
  const evidence = plan.archiveManifest;
  if (!evidence || typeof evidence !== "object") fail("plan_archive_evidence");
  assertLegacyStageAllowlistEvidence(evidence, evidence);
  assertValue(evidence.policy_id, LEGACY_STAGE_ALLOWLIST_POLICY_ID, "plan_policy");
  assertValue(evidence.proof_basis, LEGACY_STAGE_ALLOWLIST_POLICY_ID, "plan_proof_basis");
  assertValue(evidence.allowlist_sha256, expected.masterAllowlistSha256, "plan_master_hash");
  assertValue(evidence.batch_table_ids_sha256, expected.batchTableIdsSha256, "plan_batch_hash");
  assertValue(evidence.source_run, LEGACY_STAGE_ALLOWLIST_SOURCE_RUN, "plan_source_run");
  assertValue(evidence.query_sha256, expected.querySha256, "plan_query_hash");
  assertValue(evidence.generator_sha256, expected.querySha256, "plan_generator_hash");
  assertValue(evidence.stage_system_identifier, STAGE_SYSTEM_IDENTIFIER, "plan_system_identifier");
  assertValue(evidence.master_table_count, LEGACY_STAGE_ALLOWLIST_TABLE_COUNT, "plan_master_count");
  assertValue(evidence.batch_number, 1, "plan_batch_number");
  assertValue(evidence.batch_table_count, LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT, "plan_batch_count");
  assertValue(evidence.master_manifest_sha256, expected.masterManifestSha256, "plan_master_manifest_hash");
  assertValue(evidence.batch_manifest_sha256, expected.batchManifestSha256, "plan_batch_manifest_hash");
  sameIdList(evidence.master_table_ids, masterIds, "plan_archive_master_ids");
  sameIdList(evidence.batch_table_ids, batchIds, "plan_archive_batch_ids");
  assertValue(evidence.freeze_run_id, expected.freezeRunId, "plan_freeze_run");
  assertValue(evidence.diagnostic_source_run, expected.diagnosticSourceRun, "plan_diagnostic_run");
  assertValue(evidence.diagnostic_source_run_sha256, expected.diagnosticSourceRunSha256, "plan_diagnostic_hash");
  return { masterIds, batchIds };
}

export function assertLegacyStageAuditBatchState(row) {
  const expected = LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13;
  const noGo = row.destructive_go_at === null && row.destructive_go_batch_id === null;
  const exactGo = row.destructive_go_at !== null
    && Boolean(row.destructive_go_at)
    && row.destructive_go_batch_id === expected.batchId;
  if (!noGo && !exactGo) fail("destructive_go");

  const unpruned = row.pruned_at === null && row.registry_cleaned_at === null;
  const pruned = row.pruned_at !== null && row.registry_cleaned_at !== null;
  if (!unpruned && !pruned) fail("cleanup_receipts");

  const receiptFields = [
    row.pruned_transaction_count,
    row.pruned_entry_count,
    row.pruned_transaction_ids_sha256,
    row.pruned_entry_ids_sha256,
    row.registry_cleaned_key_count,
    row.registry_cleaned_keys_sha256,
  ];
  if (unpruned) {
    if (receiptFields.some((value) => value !== null)) fail("cleanup_receipts");
    return {
      cleanupState: "authorized-but-unpruned",
      authorizationState: exactGo ? "exact-batch-13-go" : "no-go",
      exactGo,
    };
  }

  if (!exactGo) fail("pruned_destructive_go");
  if (!row.pruned_at || !sameTimestamp(row.pruned_at, row.pruned_at)
    || !row.registry_cleaned_at || !sameTimestamp(row.registry_cleaned_at, row.registry_cleaned_at)) {
    fail("pruned_receipt_timestamps");
  }
  for (const [field, expectedValue] of Object.entries({
    pruned_transaction_count: expected.transactionCount,
    pruned_entry_count: expected.entryCount,
    pruned_transaction_ids_sha256: expected.txIdsSha256,
    pruned_entry_ids_sha256: expected.entryIdsSha256,
    registry_cleaned_key_count: expected.registryCount,
    registry_cleaned_keys_sha256: expected.registryKeysSha256,
  })) {
    if (text(row[field]) !== String(expectedValue)) fail(`pruned_receipt_${field}`);
  }
  return {
    cleanupState: "pruned-and-cleaned",
    authorizationState: "exact-batch-13-go",
    exactGo,
  };
}

export function assertLegacyStageAuditBatchRow(rowInput, plan) {
  const row = parseBatchRow(rowInput);
  const expected = LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13;
  assertValue(row.object_path, expected.objectPath, "batch_object_path");
  assertValue(row.batch_id, expected.batchId, "batch_id");
  assertValue(row.project_ref, expected.projectRef, "batch_project_ref");
  assertValue(row.format_version, expected.formatVersion, "batch_format_version");
  assertTimestamp(row.cutoff, expected.cutoff, "batch_cutoff");
  assertValue(row.transaction_count, expected.transactionCount, "transaction_count");
  assertValue(row.entry_count, expected.entryCount, "entry_count");
  if (canonicalJson(row.tx_types) !== canonicalJson(expected.txTypes)) fail("tx_types");
  assertValue(row.raw_bytes, expected.rawBytes, "raw_bytes");
  assertValue(row.compressed_bytes, expected.compressedBytes, "compressed_bytes");
  assertValue(row.raw_sha256, expected.rawSha256, "raw_sha256");
  assertValue(row.compressed_sha256, expected.compressedSha256, "compressed_sha256");
  assertValue(row.archived_transaction_ids_sha256, expected.txIdsSha256, "batch_transaction_ids_hash");
  assertValue(row.archived_entry_ids_sha256, expected.entryIdsSha256, "batch_entry_ids_hash");
  assertValue(row.credits, expected.credits, "credits");
  assertValue(row.debits, expected.debits, "debits");
  assertValue(row.net_amount, expected.net, "net_amount");
  assertValue(row.status, "committed", "batch_status");
  if (!row.committed_at) fail("batch_committed_at");
  if (!row.archive_proof_verified_at) fail("archive_proof_verified_at");
  assertValue(row.source_policy_id, LEGACY_STAGE_ALLOWLIST_POLICY_ID, "batch_policy");
  assertValue(row.legacy_allowlist_sha256, expected.masterAllowlistSha256, "batch_master_hash");
  assertValue(row.legacy_batch_table_ids_sha256, expected.batchTableIdsSha256, "batch_table_hash");
  assertValue(row.legacy_master_table_count, LEGACY_STAGE_ALLOWLIST_TABLE_COUNT, "batch_master_count");
  assertValue(row.legacy_batch_number, 1, "batch_number");
  assertValue(row.legacy_batch_table_count, LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT, "batch_table_count");
  assertValue(row.legacy_source_run, LEGACY_STAGE_ALLOWLIST_SOURCE_RUN, "batch_source_run");
  assertValue(row.legacy_query_sha256, expected.querySha256, "batch_query_hash");
  assertValue(row.legacy_stage_system_identifier, STAGE_SYSTEM_IDENTIFIER, "batch_system_identifier");
  const { masterIds, batchIds } = assertLegacyStageAuditPlan(plan);
  sameIdList(row.legacy_master_table_ids, masterIds, "batch_master_ids");
  if (batchIds.length !== LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT) fail("batch_table_count");
  return { ...row, ...assertLegacyStageAuditBatchState(row) };
}

export function assertLegacyStageAuditProofRow(rowInput, plan) {
  const row = parseProofRow(rowInput);
  const expected = LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13;
  assertValue(row.batch_id, expected.batchId, "proof_batch_id");
  assertValue(row.object_path, expected.objectPath, "proof_object_path");
  assertValue(row.project_ref, expected.projectRef, "proof_project_ref");
  assertValue(row.source_policy_id, LEGACY_STAGE_ALLOWLIST_POLICY_ID, "proof_policy");
  assertTimestamp(row.cutoff, expected.cutoff, "proof_cutoff");
  assertValue(row.source_run, expected.diagnosticSourceRun, "proof_source_run");
  assertValue(row.query_sha256, expected.querySha256, "proof_query_hash");
  assertValue(row.postgres_system_identifier, STAGE_SYSTEM_IDENTIFIER, "proof_system_identifier");
  assertValue(row.master_table_count, LEGACY_STAGE_ALLOWLIST_TABLE_COUNT, "proof_master_count");
  const { masterIds, batchIds } = assertLegacyStageAuditPlan(plan);
  sameIdList(row.master_table_ids, masterIds, "proof_master_ids");
  assertValue(row.master_table_ids_sha256, expected.masterAllowlistSha256, "proof_master_hash");
  assertValue(row.batch_number, 1, "proof_batch_number");
  assertValue(row.batch_table_count, LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT, "proof_batch_count");
  sameIdList(row.batch_table_ids, batchIds, "proof_batch_ids");
  assertValue(row.batch_table_ids_sha256, expected.batchTableIdsSha256, "proof_batch_hash");
  return row;
}

function buildAuditManifest(row, plan) {
  const cursorStart = row.cursor_start_created_at
    ? { created_at: row.cursor_start_created_at, id: text(row.cursor_start_id).toLowerCase() }
    : null;
  const cursorEnd = row.cursor_end_created_at
    ? { created_at: row.cursor_end_created_at, id: text(row.cursor_end_id).toLowerCase() }
    : null;
  return {
    schema_version: row.format_version,
    artifact_type: "chips_ledger_archive",
    format: "jsonl.gz",
    target: "stage",
    cutoff: { created_at: row.cutoff, rule: "transaction.created_at < cutoff" },
    batch: {
      limit: maxBatchSizeForTarget("stage"),
      transactions: row.transaction_count,
      entries: row.entry_count,
      tx_types: parseJsonb(row.tx_types, "manifest_tx_types"),
    },
    amounts: { credits: row.credits, debits: row.debits, net: row.net_amount },
    time_range: { first_created_at: row.first_created_at, last_created_at: row.last_created_at },
    cursor: {
      order: ["transaction.created_at ASC", "transaction.id ASC"],
      start: cursorStart,
      end: cursorEnd,
      next: cursorEnd,
    },
    bytes: {
      raw: row.raw_bytes,
      compressed: row.compressed_bytes,
      compression_ratio_compressed_over_raw: row.raw_bytes === 0 ? null : Number((row.compressed_bytes / row.raw_bytes).toFixed(6)),
    },
    sha256: { raw_jsonl: row.raw_sha256, compressed_artifact: row.compressed_sha256 },
    artifact: path.basename(row.object_path),
    source_policy_id: row.source_policy_id,
    legacy_stage_allowlist: structuredClone(plan.archiveManifest),
  };
}

function assertNoSecondBatch(row) {
  if (numberValue(row.same_plan_count, "duplicate_query") !== 1) fail("duplicate_legacy_batch");
  if (numberValue(row.target_batch_count, "duplicate_query") !== 1) fail("duplicate_batch_id");
}

function archiveProofsInArchiveOrder(records) {
  return computeArchiveIdProofs(records, { maxBatchSize: maxBatchSizeForTarget("stage") });
}

export function assertExactTransactionRows(rows, records) {
  if (rows.length !== records.length) fail("transaction_rows_count");
  const expected = new Map(records.map((record) => [text(record.transaction.id).toLowerCase(), record.transaction]));
  for (const row of rows) {
    const transaction = expected.get(text(row.id).toLowerCase());
    if (!transaction) fail("transaction_id_set");
    for (const field of ["sequence", "tx_type", "idempotency_key", "payload_hash", "user_id", "reference", "description", "created_by"]) {
      if (text(row[field] ?? null) !== text(transaction[field] ?? null)) fail(`transaction_${field}`);
    }
    if (!sameJson(row.metadata, transaction.metadata)) fail("transaction_metadata");
    if (!sameTimestamp(row.created_at, transaction.created_at)) fail("transaction_created_at");
  }
  return archiveProofsInArchiveOrder(records).transactionIdsSha256;
}

export function assertExactEntryRows(rows, records) {
  const expected = new Map(records.flatMap((record) => record.entries).map((entry) => [text(entry.id), entry]));
  if (rows.length !== expected.size) fail("entry_rows_count");
  for (const row of rows) {
    const entry = expected.get(text(row.id));
    if (!entry) fail("entry_id_set");
    for (const field of ["transaction_id", "account_id", "entry_seq", "amount"]) {
      if (text(row[field]) !== text(entry[field])) fail(`entry_${field}`);
    }
    if (!sameJson(row.metadata, entry.metadata)) fail("entry_metadata");
    if (!sameTimestamp(row.created_at, entry.created_at)) fail("entry_created_at");
  }
  return archiveProofsInArchiveOrder(records).entryIdsSha256;
}

export function assertExactRegistryRows(rows, records, batchIds) {
  const expected = new Map(records.map((record) => [record.transaction.idempotency_key, {
    transaction: record.transaction,
    tableId: text(record.table_context?.table_id).toLowerCase(),
  }]));
  const expectedTableIds = new Set([...expected.values()].map((value) => value.tableId));
  const allowedTableIds = new Set((batchIds || []).map((value) => text(value).toLowerCase()));
  if (expectedTableIds.size !== allowedTableIds.size || [...expectedTableIds].some((id) => !allowedTableIds.has(id))) {
    fail("registry_table_id_set");
  }
  assertLegacyStageAllowlistRegistryRows(rows, {
    tableIds: [...allowedTableIds],
    expectedCount: expected.size,
    expectedKeysSha256: hashCanonicalLines([...expected.keys()].sort()),
    fail: (code) => fail(code),
  });
  for (const row of rows) {
    const expectedRow = expected.get(row.idempotency_key);
    if (!expectedRow) fail("registry_key_set");
    const transaction = expectedRow.transaction;
    const tableId = text(row.table_id).toLowerCase();
    if (!allowedTableIds.has(tableId)) fail("registry_table_id_set");
    if (tableId !== expectedRow.tableId) fail("registry_table_id");
    if (text(row.transaction_id).toLowerCase() !== text(transaction.id).toLowerCase()) fail("registry_transaction_id");
    if (row.payload_hash !== transaction.payload_hash) fail("registry_payload_hash");
    if (row.tx_type !== transaction.tx_type) fail("registry_tx_type");
    if (row.user_id !== null) fail("registry_user_id");
    if (row.archive_batch_id !== null) fail("registry_archive_batch_id");
    if (!sameTimestamp(row.transaction_created_at, transaction.created_at)) fail("registry_created_at");
  }
  return hashCanonicalLines([...expected.keys()].sort());
}

export function assertEntryShapeRows(rows, records) {
  if (rows.length !== records.length) fail("entry_shape_rows_count");
  const expected = new Map(records.map((record) => [
    text(record.transaction.id).toLowerCase(), record,
  ]));
  for (const row of rows) {
    const record = expected.get(text(row.transaction_id).toLowerCase());
    if (!record) fail("entry_shape_transaction_id");
    const transaction = record.transaction;
    const tableId = text(record.table_context?.table_id).toLowerCase();
    if (text(row.tx_type) !== text(transaction.tx_type)
      || row.user_id !== null
      || text(row.table_id).toLowerCase() !== tableId) {
      fail("entry_shape_identity");
    }
    if (countValue(row.entry_count, "entry_shape_entry_count") !== 2
      || countValue(row.user_entry_count, "entry_shape_user_entry_count") !== 0
      || countValue(row.system_entry_count, "entry_shape_system_entry_count") !== 1
      || countValue(row.escrow_entry_count, "entry_shape_escrow_entry_count") !== 1
      || countValue(row.matching_escrow_count, "entry_shape_matching_escrow_count") !== 1
      || countValue(row.active_entry_count, "entry_shape_active_entry_count") !== 2
      || integerValue(row.net_amount, "entry_shape_net_amount") !== 0n) {
      fail("entry_shape");
    }
    const systemAmount = integerValue(row.system_amount, "entry_shape_system_amount");
    const escrowAmount = integerValue(row.escrow_amount, "entry_shape_escrow_amount");
    if ((transaction.tx_type === "TABLE_BUY_IN" && (systemAmount >= 0n || escrowAmount <= 0n))
      || (transaction.tx_type === "TABLE_CASH_OUT" && (escrowAmount >= 0n || systemAmount <= 0n))) {
      fail("entry_shape_direction");
    }
  }
}

export function assertTableRows(rows, batchIds) {
  if (rows.length !== batchIds.length) fail("table_rows_count");
  const normalizedIds = batchIds.map((id) => text(id).toLowerCase());
  const byId = new Map(rows.map((row) => [text(row.table_id).toLowerCase(), row]));
  if (byId.size !== normalizedIds.length) fail("table_id_set");
  for (const tableId of normalizedIds) {
    const row = byId.get(tableId);
    if (!row) fail("table_id_set");
    if (row.status !== "CLOSED") fail("table_status");
    if (row.has_human_participant !== false) fail("table_human_participant");
    if (row.bot_only_proof_eligible !== false) fail("table_bot_only_proof_eligible");
    if (!row.escrow_account_id) fail("escrow_missing");
    if (row.escrow_account_type !== "ESCROW") fail("escrow_account_type");
    if (row.escrow_system_key !== `POKER_TABLE:${tableId}`) fail("escrow_system_key");
    if (row.escrow_status !== "active") fail("escrow_status");
    if (text(row.escrow_balance) !== "0") fail("escrow_balance");
  }
  return rows.map((row) => ({
    tableId: text(row.table_id).toLowerCase(), status: row.status,
    hasHumanParticipant: row.has_human_participant,
    escrowAccountId: text(row.escrow_account_id).toLowerCase(),
    escrowStatus: row.escrow_status, escrowBalance: text(row.escrow_balance),
    escrowNextEntrySeq: text(row.escrow_next_entry_seq),
  })).sort((left, right) => left.tableId.localeCompare(right.tableId));
}

export function assertAccountRows(rows, accountIds, records = null) {
  if (rows.length !== accountIds.length) fail("account_snapshot_count");
  const expected = new Set(accountIds.map((id) => id.toLowerCase()));
  const evidence = new Map();
  if (records) {
    for (const entry of records.flatMap((record) => record.entries)) {
      const account = entry.account;
      const accountId = text(account?.id || entry.account_id).toLowerCase();
      if (!accountId || !account) fail("account_snapshot_evidence");
      const projection = {
        userId: text(account.user_id), accountType: text(account.account_type),
        systemKey: text(account.system_key), status: text(account.status),
      };
      const previous = evidence.get(accountId);
      if (previous && canonicalJson(previous) !== canonicalJson(projection)) fail("account_snapshot_evidence");
      evidence.set(accountId, projection);
    }
  }
  const snapshot = rows.map((row) => {
    const accountId = text(row.account_id).toLowerCase();
    if (!expected.has(accountId)) fail("account_snapshot_set");
    const expectedAccount = evidence.get(accountId);
    if (records && !expectedAccount) fail("account_snapshot_evidence");
    if (expectedAccount) {
      if (text(row.user_id) !== expectedAccount.userId) fail("account_snapshot_user_id");
      if (text(row.account_type) !== expectedAccount.accountType) fail("account_snapshot_account_type");
      if (text(row.system_key) !== expectedAccount.systemKey) fail("account_snapshot_system_key");
      if (text(row.status) !== expectedAccount.status) fail("account_snapshot_status");
    }
    return {
      accountId, userId: text(row.user_id), accountType: row.account_type, systemKey: row.system_key, status: row.status,
      balance: text(row.balance), nextEntrySeq: text(row.next_entry_seq),
    };
  }).sort((left, right) => left.accountId.localeCompare(right.accountId));
  if (new Set(snapshot.map((row) => row.accountId)).size !== expected.size) fail("account_snapshot_set");
  return snapshot;
}

function assertConservation(row) {
  const expected = LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13;
  if (numberValue(row.entry_count, "conservation_entry_count") !== expected.entryCount
    || text(row.credits) !== expected.credits || text(row.debits) !== expected.debits || text(row.net) !== expected.net) {
    fail("conservation");
  }
  return {
    entryCount: numberValue(row.entry_count, "conservation_entry_count"),
    credits: text(row.credits), debits: text(row.debits), net: text(row.net), everyTransactionConserved: true,
  };
}

export function assertReadOnlyStorageRequest(init = {}) {
  const method = text(init.method || "GET").toUpperCase();
  if (method !== "GET") fail("storage_method");
  return method;
}

function boundedFetch(fetchImpl) {
  return async (url, init = {}) => {
    assertReadOnlyStorageRequest(init);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LEGACY_STAGE_ALLOWLIST_AUDIT_STORAGE_TIMEOUT_MS);
    try { return await fetchImpl(url, { ...init, method: "GET", signal: controller.signal }); }
    finally { clearTimeout(timeout); }
  };
}

function expectedMigrationSha256(cwd) {
  const migrationPath = path.join(cwd, LEGACY_STAGE_ALLOWLIST_AUDIT_MIGRATION.file);
  if (!fs.statSync(migrationPath).isFile()) fail("migration_file");
  return sha256(fs.readFileSync(migrationPath));
}

async function auditDatabase(tx, { plan, storageTarget, fetchImpl, cwd }) {
  await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_READ_ONLY_TRANSACTION_SQL);
  await tx.unsafe("set local lock_timeout = '5s';");
  await tx.unsafe(`set local statement_timeout = '${LEGACY_STAGE_ALLOWLIST_AUDIT_STATEMENT_TIMEOUT}';`);
  const identity = text((await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.identity))[0]?.system_identifier);
  if (identity !== STAGE_SYSTEM_IDENTIFIER) fail("system_identifier");
  if (storageTarget.projectRef !== STAGE_PROJECT_REF) fail("project_ref");
  const fenceActive = isTrue((await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.fence))[0]?.active);
  if (!fenceActive) fail("fence_inactive");
  const enforcementRows = await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.enforcement);
  if (enforcementRows.length !== 1 || !isTrue(enforcementRows[0]?.enforcement_active)) fail("enforcement_inactive");

  const migration = (await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.migration, [LEGACY_STAGE_ALLOWLIST_AUDIT_MIGRATION.version]))[0];
  if (text(migration?.applied_count) !== "1" || text(migration?.hash_count) !== "1"
    || migration.sha256 !== expectedMigrationSha256(cwd)) fail("migration");
  const overloads = assertPrunerOverloads(
    (await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.overloads))[0],
  );

  const batchRows = await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.batch, [LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.batchId]);
  if (batchRows.length !== 1) fail(batchRows.length === 0 ? "batch_missing" : "batch_duplicate");
  const row = assertLegacyStageAuditBatchRow(batchRows[0], plan);
  const proofRows = await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.proof, [LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.batchId]);
  if (proofRows.length !== 1) fail(proofRows.length === 0 ? "proof_missing" : "proof_duplicate");
  const proof = assertLegacyStageAuditProofRow(proofRows[0], plan);
  const duplicate = (await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.duplicate, [
    LEGACY_STAGE_ALLOWLIST_POLICY_ID,
    LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.masterAllowlistSha256,
    LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.batchTableIdsSha256,
    LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.batchId,
  ]))[0];
  assertNoSecondBatch(duplicate);

  const manifest = buildAuditManifest(row, plan);
  const bucket = await verifyArchiveBucket(storageTarget, { fetch: fetchImpl });
  const archiveObject = await downloadPrivateArchiveObject(storageTarget, row.object_path, { fetch: fetchImpl });
  const recoveryArchiveBytes = await downloadPrivateArchiveObject(storageTarget, buildRecoveryArchiveObjectPath(row.compressed_sha256), { fetch: fetchImpl });
  const recoveryManifestBytes = await downloadPrivateObjectIfExists(storageTarget, buildRecoveryManifestObjectPath(row.compressed_sha256), { fetch: fetchImpl });
  if (!recoveryManifestBytes) fail("recovery_manifest_missing");
  const expected = LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13;
  if (archiveObject.bytes.length !== expected.compressedBytes || sha256(archiveObject.bytes) !== expected.compressedSha256) fail("archive_bytes");
  if (!recoveryArchiveBytes.bytes.equals(archiveObject.bytes)) fail("recovery_archive_bytes");
  if (recoveryArchiveBytes.bytes.length !== expected.compressedBytes || sha256(recoveryArchiveBytes.bytes) !== expected.compressedSha256) fail("recovery_archive_hash");
  if (sha256(recoveryManifestBytes) !== expected.recoveryManifestSha256) fail("recovery_manifest_hash");

  const localArchive = verifyArchiveBytes({
    compressedBytes: archiveObject.bytes, manifest, target: { target: "stage" },
    artifactName: path.basename(row.object_path), expectedLegacyStageAllowlistEvidence: plan.archiveManifest,
  });
  const evidence = buildPruneEvidence(localArchive, { maxBatchSize: maxBatchSizeForTarget("stage") });
  if (evidence.transactionCount !== expected.transactionCount || evidence.entryCount !== expected.entryCount
    || evidence.registryKeysSha256 !== expected.registryKeysSha256 || evidence.transactionIdsSha256 !== expected.txIdsSha256
    || evidence.entryIdsSha256 !== expected.entryIdsSha256 || evidence.legacyTableIdsSha256 !== expected.batchTableIdsSha256) fail("archive_evidence_hash");
  const { batchIds: planIds } = assertLegacyStageAuditPlan(plan);
  sameIdList(evidence.legacyTableIds, planIds, "archive_table_ids");

  const recoveryManifest = JSON.parse(gunzipSync(recoveryManifestBytes).toString("utf8"));
  const expectedRecoveryManifest = buildRecoveryManifest(row, identity, evidence, { target: "stage" });
  if (canonicalJson(recoveryManifest) !== canonicalJson(expectedRecoveryManifest)) fail("recovery_manifest_evidence");
  let txIdsSha256 = evidence.transactionIdsSha256;
  let entryIdsSha256 = evidence.entryIdsSha256;
  let registryKeysSha256 = evidence.registryKeysSha256;
  let hotRows;
  let conservation;
  if (row.cleanupState === "authorized-but-unpruned") {
    const txRows = await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.transactions, [evidence.transactionIds]);
    txIdsSha256 = assertExactTransactionRows(txRows, localArchive.records);
    if (txIdsSha256 !== evidence.transactionIdsSha256) fail("transaction_ids_hash");
    const entryRows = await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.entries, [evidence.transactionIds]);
    entryIdsSha256 = assertExactEntryRows(entryRows, localArchive.records);
    if (entryIdsSha256 !== evidence.entryIdsSha256) fail("entry_ids_hash");
    assertEntryShapeRows(
      await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.entryShapes, [evidence.transactionIds]),
      localArchive.records,
    );
    const registryRows = await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.registry, [planIds]);
    registryKeysSha256 = assertExactRegistryRows(registryRows, localArchive.records, planIds);
    if (registryRows.length !== expected.registryCount || registryKeysSha256 !== evidence.registryKeysSha256) {
      fail("registry_keys_hash");
    }
    hotRows = {
      transactions: txRows.length,
      entries: entryRows.length,
      registryRows: registryRows.length,
    };
    conservation = assertConservation(
      (await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.conservation, [evidence.transactionIds]))[0],
    );
  } else if (row.cleanupState === "pruned-and-cleaned") {
    const hot = (await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.prunedHotRows, [
      evidence.transactionIds,
      evidence.entryIds,
      evidence.registryKeys,
    ]))[0] || {};
    for (const field of ["hot_transaction_count", "hot_entry_count", "hot_registry_count", "remaining_registry_count"]) {
      if (text(hot[field]) !== "0") fail(`pruned_${field}`);
    }
    hotRows = { transactions: 0, entries: 0, registryRows: 0 };
    conservation = assertConservation({
      entry_count: row.entry_count,
      credits: row.credits,
      debits: row.debits,
      net: row.net_amount,
    });
  } else {
    fail("cleanup_state");
  }
  const tableSnapshot = assertTableRows(await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.tables, [planIds]), planIds);
  const accountIds = [...new Set(localArchive.records.flatMap((record) => record.entries.map((entry) => text(entry.account_id).toLowerCase())))];
  const accountSnapshot = assertAccountRows(
    await tx.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.accounts, [accountIds]),
    accountIds,
    localArchive.records,
  );
  return {
    identity, projectRef: storageTarget.projectRef, fenceActive, enforcementActive: true,
    migration: { ...LEGACY_STAGE_ALLOWLIST_AUDIT_MIGRATION, sha256: migration.sha256 },
    overloads,
    row, proof, planIds, manifest, manifestSha256: sha256(Buffer.from(canonicalJson(manifest), "utf8")),
    bucket, archiveObject, recoveryArchiveBytes, recoveryManifestBytes, recoveryManifest,
    localArchive, evidence, tableSnapshot, accountSnapshot, conservation, txIdsSha256, entryIdsSha256,
    registryKeysSha256, batchState: row.cleanupState, authorizationState: row.authorizationState, hotRows,
  };
}

function auditResult(snapshot, deployedCommitSha) {
  const expected = LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13;
  const { row, proof, archiveObject, recoveryArchiveBytes, recoveryManifestBytes } = snapshot;
  return {
    state: "ready", mode: "audit-read-only", sourcePolicyId: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
    deployedCommitSha, projectRef: snapshot.projectRef, systemIdentifier: snapshot.identity,
    batchId: expected.batchId, objectPath: expected.objectPath, cutoff: row.cutoff,
    plan: {
      masterAllowlistSha256: expected.masterAllowlistSha256, batchTableIdsSha256: expected.batchTableIdsSha256,
      masterManifestSha256: expected.masterManifestSha256, batchManifestSha256: expected.batchManifestSha256,
      masterTableCount: LEGACY_STAGE_ALLOWLIST_TABLE_COUNT, batchTableCount: LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT,
      tableIds: snapshot.planIds,
    },
    transactions: row.transaction_count, entries: row.entry_count, registryRows: snapshot.evidence.registryKeys.length,
    batchState: snapshot.batchState,
    authorization: {
      state: snapshot.authorizationState,
      destructiveGoAt: row.destructive_go_at,
      destructiveGoBatchId: row.destructive_go_batch_id,
    },
    hotRows: snapshot.hotRows,
    proof: {
      status: "committed", objectPath: proof.object_path, sourceRun: proof.source_run, querySha256: proof.query_sha256,
      masterTableIdsSha256: proof.master_table_ids_sha256, batchTableIdsSha256: proof.batch_table_ids_sha256,
      transactionIdsSha256: snapshot.txIdsSha256, entryIdsSha256: snapshot.entryIdsSha256, registryKeysSha256: snapshot.registryKeysSha256,
    },
    archive: {
      objectPath: row.object_path, bytes: archiveObject.bytes.length, sha256: sha256(archiveObject.bytes),
      rawBytes: row.raw_bytes, rawSha256: row.raw_sha256, manifestSha256: snapshot.manifestSha256,
    },
    manifest: {
      source: "chips_ledger_archive_batches",
      objectPath: row.object_path,
      cutoff: row.cutoff,
      rawBytes: row.raw_bytes,
      compressedBytes: row.compressed_bytes,
      rawSha256: row.raw_sha256,
      compressedSha256: row.compressed_sha256,
      canonicalSha256: snapshot.manifestSha256,
    },
    recovery: {
      archiveObjectPath: buildRecoveryArchiveObjectPath(expected.compressedSha256), archiveBytes: recoveryArchiveBytes.bytes.length,
      archiveSha256: sha256(recoveryArchiveBytes.bytes), manifestObjectPath: buildRecoveryManifestObjectPath(expected.compressedSha256),
      manifestBytes: recoveryManifestBytes.length, manifestSha256: sha256(recoveryManifestBytes),
    },
    receipt: snapshot.batchState === "pruned-and-cleaned" ? {
      prunedAt: row.pruned_at,
      registryCleanedAt: row.registry_cleaned_at,
      prunedTransactionCount: row.pruned_transaction_count,
      prunedEntryCount: row.pruned_entry_count,
      registryCleanedKeyCount: row.registry_cleaned_key_count,
      transactionIdsSha256: row.pruned_transaction_ids_sha256,
      entryIdsSha256: row.pruned_entry_ids_sha256,
      registryKeysSha256: row.registry_cleaned_keys_sha256,
      remainingRegistryCount: 0,
    } : null,
    dryRun: {
      state: "ready", batchState: snapshot.batchState, readOnly: true,
      destructiveGoAt: row.destructive_go_at, prunedAt: row.pruned_at, registryCleanedAt: row.registry_cleaned_at,
    },
    snapshot: {
      balances: snapshot.accountSnapshot,
      nextEntrySeq: snapshot.accountSnapshot.map((account) => ({ accountId: account.accountId, nextEntrySeq: account.nextEntrySeq })),
      conservation: snapshot.conservation, tables: snapshot.tableSnapshot, hotRows: snapshot.hotRows,
    },
    preflight: {
      projectRef: snapshot.projectRef, systemIdentifier: snapshot.identity, fence: snapshot.fenceActive,
      enforcementActive: snapshot.enforcementActive, migration: snapshot.migration,
      prunerOverloads: snapshot.overloads, readOnly: true,
    },
    writes: { database: false, storage: false, storageMethods: ["GET"], archive: false, proofRegistration: false, prune: false },
  };
}

export async function runLegacyStageAllowlistAudit({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), deps = {} } = {}) {
  if (argv.length !== 0) fail("arguments_not_allowed");
  const config = validateStageEnvironment(env, { requireCommitSha: true });
  if (!COMMIT_SHA_RE.test(config.deployedCommitSha)) fail("deployed_commit_sha");
  const frozen = loadFrozenLegacyAllowlist({ cwd });
  const plan = buildLegacyPlan(frozen.masterManifest, frozen.batchManifest);
  assertLegacyStageAuditPlan(plan);
  const storageTarget = deps.storageTarget || resolveStorageTarget("stage", config.moduleEnv, { singleTarget: true });
  if (storageTarget.projectRef !== STAGE_PROJECT_REF) fail("project_ref");
  const sql = deps.sql || postgres(config.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 0 });
  const fetchImpl = boundedFetch(deps.fetch || fetch);
  let timeout;
  try {
    const auditPromise = sql.begin((tx) => auditDatabase(tx, { plan, storageTarget, fetchImpl, cwd }));
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("legacy Stage batch 13 audit wall-clock timeout")), LEGACY_STAGE_ALLOWLIST_AUDIT_MAX_WALL_CLOCK_MS);
    });
    const snapshot = await Promise.race([auditPromise, timeoutPromise]);
    const result = auditResult(snapshot, config.deployedCommitSha);
    if (deps.emit !== false) process.stdout.write(`${stringifyJson(result)}\n`);
    return result;
  } finally {
    clearTimeout(timeout);
    if (!deps.sql) await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLegacyStageAllowlistAudit().catch((error) => {
    process.stderr.write(`chips-ledger-legacy-stage-allowlist-audit failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
