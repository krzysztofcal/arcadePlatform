import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import { createPruneStore } from "./chips-ledger-archive-prune.mjs";
import {
  STAGE_PROJECT_REF,
  STAGE_SYSTEM_IDENTIFIER,
} from "./chips-ledger-stage-automation.mjs";

export { STAGE_PROJECT_REF, STAGE_SYSTEM_IDENTIFIER };

export const RETIREMENT_POLICY_ID = "stage-ledger-auto-retention-30d-v1";
export const RETIREMENT_MAX_BATCH_SIZE = 5000;
export const RETIREMENT_KEY_FORMATS = Object.freeze([
  "managed-bot-seed-buyin",
  "bot-seed-buyin",
  "poker:bot-replacement-buyin:v1",
  "poker:bot-terminal-cashout:v1",
]);
export const RETIREMENT_FULL_REPLAY_TX_TYPES = Object.freeze([
  "BUY_IN",
  "CASH_OUT",
  "WELCOME_BONUS",
  "PROMO_BONUS",
  "ADMIN_ADJUST",
]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const INTEGER_RE = /^(0|[1-9][0-9]*)$/;
const MAX_BIGINT = 9223372036854775807n;
const PRODUCTION_ENV_RE = /^(?:SUPABASE_PROD_|PRODUCTION_)/;
const VALUE_FLAGS = new Set([
  "--target",
  "--mode",
  "--batch-id",
  "--registry-count",
  "--registry-sha256",
  "--confirmation",
]);

function fail(message, code = "CHIPS_RETIREMENT_INVALID_INPUT") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseBigintArgument(value, label, { max = MAX_BIGINT } = {}) {
  if (typeof value !== "string" || !INTEGER_RE.test(value)) {
    fail(`${label} must be a positive decimal integer`);
  }
  const parsed = BigInt(value);
  if (parsed < 1n || parsed > max) {
    fail(`${label} is outside the permitted range`);
  }
  return parsed.toString();
}

function nextValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value == null || value.startsWith("--")) fail(`${flag} requires a value`);
  return value;
}

export function parseRetirementArgs(argv = []) {
  const result = {
    help: false,
    target: null,
    mode: null,
    batchId: null,
    registryCount: null,
    registrySha256: null,
    confirmation: null,
  };
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      result.help = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) fail(`unknown argument: ${flag}`);
    if (seen.has(flag)) fail(`${flag} may be provided only once`);
    seen.add(flag);
    const value = nextValue(argv, index, flag);
    index += 1;
    if (flag === "--target") result.target = value;
    if (flag === "--mode") result.mode = value;
    if (flag === "--batch-id") result.batchId = parseBigintArgument(value, "--batch-id");
    if (flag === "--registry-count") {
      result.registryCount = parseBigintArgument(value, "--registry-count", { max: BigInt(RETIREMENT_MAX_BATCH_SIZE) });
    }
    if (flag === "--registry-sha256") result.registrySha256 = value;
    if (flag === "--confirmation") result.confirmation = value;
  }

  if (result.help) return result;
  if (result.target !== "stage") fail("--target stage is required; Production is forbidden");
  if (result.mode !== "audit" && result.mode !== "execute") fail("--mode must be audit or execute");
  if (result.registrySha256 != null && !SHA256_RE.test(result.registrySha256)) {
    fail("--registry-sha256 must be a lowercase 64-character SHA-256");
  }

  const executeOnlyFlags = [result.batchId, result.registryCount, result.registrySha256, result.confirmation];
  if (result.mode === "audit") {
    if (executeOnlyFlags.some((value) => value != null)) {
      fail("audit mode cannot carry execute-only batch or GO arguments");
    }
    return result;
  }

  if (result.batchId == null || result.registryCount == null || result.registrySha256 == null) {
    fail("execute mode requires batch id, registry count, and registry SHA-256");
  }
  if (result.confirmation !== `GO ${result.batchId}`) {
    fail("execute mode requires the exact confirmation GO <batch_id>");
  }
  return result;
}

export function validateDbOnlyStageEnvironment(env = process.env) {
  const productionVariables = Object.keys(env).filter((name) => PRODUCTION_ENV_RE.test(name));
  if (productionVariables.length > 0) {
    fail(`Production credential variables are forbidden: ${productionVariables.join(", ")}`);
  }
  const dbUrl = env.SUPABASE_STAGE_DB_URL;
  if (!dbUrl) fail("SUPABASE_STAGE_DB_URL is required");

  let parsed;
  try {
    parsed = new URL(dbUrl);
  } catch {
    fail("SUPABASE_STAGE_DB_URL is invalid");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    fail("SUPABASE_STAGE_DB_URL must be PostgreSQL");
  }
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(parsed.hostname);
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(parsed.hostname);
  const username = decodeURIComponent(parsed.username || "");
  const poolerUser = /^postgres\.([a-z0-9]{20})$/i.exec(username);
  const projectRef = (direct?.[1] || (pooler ? poolerUser?.[1] : ""))?.toLowerCase();
  if (projectRef !== STAGE_PROJECT_REF) {
    fail("SUPABASE_STAGE_DB_URL does not match the canonical Stage project ref");
  }
  return Object.freeze({
    dbUrl,
    projectRef: STAGE_PROJECT_REF,
    systemIdentifier: STAGE_SYSTEM_IDENTIFIER,
  });
}

export function klog(event, payload = {}, write = process.stdout.write.bind(process.stdout)) {
  write(`[klog] ${event} ${JSON.stringify(payload)}\n`);
}

function rowValue(row, key) {
  return row?.[key] == null ? null : String(row[key]);
}

const INVENTORY_SQL = `
select
  count(*)::text as registry_count,
  count(*) filter (where registry.archive_batch_id is not null)::text as mapped_count,
  count(*) filter (where registry.archive_batch_id is null)::text as unmapped_count,
  count(*) filter (where registry.table_id is not null)::text as parsed_table_id_count,
  count(*) filter (where registry.table_id is null)::text as unmapped_table_id_count,
  count(*) filter (where registry.key_format_version = 1)::text as version_one_count,
  count(*) filter (where registry.user_id is not null)::text as user_identity_count,
  count(*) filter (where registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT'))::text as table_transaction_count,
  count(*) filter (where registry.tx_type::text not in ('TABLE_BUY_IN', 'TABLE_CASH_OUT'))::text as full_replay_or_other_count,
  count(*) filter (where exists (
    select 1 from public.chips_transactions transactions
     where transactions.id = registry.transaction_id
  ))::text as hot_transaction_count,
  count(*) filter (where exists (
    select 1 from public.chips_entries entries
     where entries.transaction_id = registry.transaction_id
  ))::text as hot_entry_count,
  coalesce(sum(pg_catalog.pg_column_size(registry)), 0)::text as registry_bytes
from public.chips_transaction_idempotency registry;
`;

const CLASSIFICATION_SQL = `
with classified as (
  select
    case
      when registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
        and registry.user_id is not null then 'human-table'
      when registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
        and registry.user_id is null
        and registry.replay_transaction is null
        and registry.replay_entries is null
        and registry.replay_completed_at is null
        and registry.key_format_version = 1
        and registry.key_format = any($1::text[]) then 'bot-internal-table'
      when registry.tx_type::text = any($2::text[])
        and registry.replay_transaction is not null
        and registry.replay_entries is not null
        and registry.replay_completed_at is not null then 'complete-full-replay'
      else 'legacy-or-unknown'
    end as identity_class,
    registry.tx_type::text as tx_type,
    coalesce(registry.key_format, '<null>') as key_format,
    coalesce(registry.key_format_version::text, '<null>') as key_format_version,
    case when registry.user_id is null then 'bot-or-system-owned' else 'user-owned' end as ownership,
    case
      when transactions.id is null then 'transaction-absent'
      when transactions.created_by is null then 'producer-null'
      else 'producer-present'
    end as producer_state,
    case
      when registry.replay_transaction is null
       and registry.replay_entries is null
       and registry.replay_completed_at is null then 'no-full-replay'
      when registry.replay_transaction is not null
       and registry.replay_entries is not null
       and registry.replay_completed_at is not null then 'complete-full-replay'
      else 'incomplete-full-replay'
    end as replay_state,
    case when registry.archive_batch_id is null then 'unmapped' else 'mapped' end as archive_state,
    coalesce(batches.source_policy_id, '<unmapped>') as source_policy_id,
    case
      when batches.batch_id is null then 'unmapped'
      when batches.pruned_at is not null then 'pruned'
      else 'not-pruned'
    end as prune_state,
    case
      when registry.transaction_created_at < timezone('utc', now()) - interval '30 days' then 'older-than-30d'
      else 'within-30d'
    end as age_band,
    registry.transaction_created_at,
    pg_catalog.pg_column_size(registry) as registry_bytes,
    transactions.id as hot_transaction_id,
    exists (
      select 1 from public.chips_entries entries
       where entries.transaction_id = registry.transaction_id
    ) as has_hot_entry
  from public.chips_transaction_idempotency registry
  left join public.chips_ledger_archive_batches batches
    on batches.batch_id = registry.archive_batch_id
  left join public.chips_transactions transactions
    on transactions.id = registry.transaction_id
)
select
  identity_class,
  tx_type,
  key_format,
  key_format_version,
  ownership,
  producer_state,
  replay_state,
  archive_state,
  source_policy_id,
  prune_state,
  age_band,
  count(*)::text as row_count,
  count(*) filter (where archive_state = 'mapped')::text as mapped_count,
  count(*) filter (where archive_state = 'unmapped')::text as unmapped_count,
  count(*) filter (where hot_transaction_id is not null)::text as hot_transaction_count,
  count(*) filter (where has_hot_entry)::text as hot_entry_count,
  count(*) filter (where hot_transaction_id is not null or has_hot_entry)::text as hot_identity_count,
  min(transaction_created_at)::text as oldest_created_at,
  max(transaction_created_at)::text as newest_created_at,
  round((count(*) filter (where transaction_created_at >= timezone('utc', now()) - interval '30 days'))::numeric / 30, 2) as rows_per_day,
  round((coalesce(sum(registry_bytes) filter (where transaction_created_at >= timezone('utc', now()) - interval '30 days'), 0))::numeric / 30, 2) as bytes_per_day,
  round((count(*) filter (where (hot_transaction_id is not null or has_hot_entry)
      and transaction_created_at >= timezone('utc', now()) - interval '30 days'))::numeric / 30, 2) as hot_rows_per_day,
  round((coalesce(sum(registry_bytes) filter (where (hot_transaction_id is not null or has_hot_entry)
      and transaction_created_at >= timezone('utc', now()) - interval '30 days'), 0))::numeric / 30, 2) as hot_bytes_per_day,
  count(*) filter (where transaction_created_at >= timezone('utc', now()) - interval '30 days')::text as rows_last_30d,
  coalesce(sum(registry_bytes) filter (where transaction_created_at >= timezone('utc', now()) - interval '30 days'), 0)::text as bytes_last_30d,
  count(*) filter (where (hot_transaction_id is not null or has_hot_entry)
    and transaction_created_at >= timezone('utc', now()) - interval '30 days')::text as hot_rows_last_30d,
  coalesce(sum(registry_bytes) filter (where (hot_transaction_id is not null or has_hot_entry)
    and transaction_created_at >= timezone('utc', now()) - interval '30 days'), 0)::text as hot_bytes_last_30d
from classified
group by identity_class, tx_type, key_format, key_format_version, ownership,
         producer_state, replay_state, archive_state, source_policy_id,
         prune_state, age_band
order by identity_class, tx_type, key_format, key_format_version,
         ownership, producer_state, replay_state, archive_state,
         source_policy_id, prune_state, age_band;
`;

const CANDIDATE_SQL = `
with candidate_rows as (
  select
    batches.batch_id,
    batches.project_ref,
    batches.source_policy_id,
    batches.format_version,
    batches.status,
    batches.transaction_count,
    batches.entry_count,
    batches.archive_proof_verified_at,
    batches.pruned_at,
    count(registry.idempotency_key)::bigint as registry_count,
    pg_catalog.array_agg(registry.idempotency_key order by registry.idempotency_key) as registry_keys
  from public.chips_ledger_archive_batches batches
  join public.chips_transaction_idempotency registry
    on registry.archive_batch_id = batches.batch_id
  where batches.project_ref = 'krydukthwdvccggbyjfw'
    and batches.source_policy_id = 'stage-ledger-auto-retention-30d-v1'
    and batches.format_version = 1
    and batches.status = 'committed'
    and batches.committed_at is not null
  group by batches.batch_id, batches.project_ref, batches.source_policy_id,
           batches.format_version, batches.status, batches.transaction_count,
           batches.entry_count, batches.archive_proof_verified_at, batches.pruned_at
)
select
  candidate_rows.batch_id::text as batch_id,
  candidate_rows.project_ref,
  candidate_rows.source_policy_id,
  candidate_rows.format_version::text as format_version,
  candidate_rows.status,
  candidate_rows.transaction_count::text as transaction_count,
  candidate_rows.entry_count::text as entry_count,
  candidate_rows.registry_count::text as registry_count,
  candidate_rows.archive_proof_verified_at,
  candidate_rows.pruned_at,
  public.chips_archive_text_ids_sha256(candidate_rows.registry_keys) as registry_keys_sha256
from candidate_rows
order by candidate_rows.batch_id::bigint;
`;

const EXACT_BATCH_SQL = `
select
  batches.batch_id::text as batch_id,
  batches.project_ref,
  batches.source_policy_id,
  batches.format_version::text as format_version,
  batches.status,
  batches.transaction_count::text as transaction_count,
  batches.entry_count::text as entry_count,
  case
    when batches.registry_cleaned_at is null then count(registry.idempotency_key)::text
    else batches.registry_cleaned_key_count::text
  end as registry_count,
  case
    when batches.registry_cleaned_at is null then public.chips_archive_text_ids_sha256(
      coalesce(
        pg_catalog.array_agg(registry.idempotency_key order by registry.idempotency_key),
        array[]::text[]
      )
    )
    else batches.registry_cleaned_keys_sha256
  end as registry_keys_sha256
from public.chips_ledger_archive_batches batches
left join public.chips_transaction_idempotency registry
  on registry.archive_batch_id = batches.batch_id
where batches.batch_id = $1::bigint
group by batches.batch_id, batches.project_ref, batches.source_policy_id,
         batches.format_version, batches.status, batches.transaction_count,
         batches.entry_count, batches.registry_cleaned_at,
         batches.registry_cleaned_key_count, batches.registry_cleaned_keys_sha256;
`;

async function assertArchivePruneStage(sql, pruneStore = null) {
  let identity = STAGE_SYSTEM_IDENTIFIER;
  if (pruneStore) {
    identity = String(await pruneStore.getIdentity());
    if (identity !== STAGE_SYSTEM_IDENTIFIER) {
      fail("database identity is not canonical Stage", "CHIPS_RETIREMENT_STAGE_IDENTITY");
    }
  }
  const rows = await sql.unsafe("select public.chips_assert_archive_prune_stage() as system_identifier;");
  if (rowValue(rows[0], "system_identifier") !== STAGE_SYSTEM_IDENTIFIER) {
    fail("chips_assert_archive_prune_stage did not confirm canonical Stage", "CHIPS_RETIREMENT_STAGE_IDENTITY");
  }
  return identity;
}

async function savepointCall(tx, name, operation) {
  await tx.unsafe(`savepoint ${name};`);
  try {
    return await operation();
  } catch (error) {
    await tx.unsafe(`rollback to savepoint ${name};`);
    await tx.unsafe(`release savepoint ${name};`);
    return { state: "rejected", reason: error.message, code: error.code || null };
  }
}

async function validateCandidate(tx, candidate) {
  return savepointCall(tx, "chips_retirement_candidate", async () => {
    const rows = await tx.unsafe(`
      select public.chips_retire_missing_table_bot_registry_batch(
        $1::bigint, $2::bigint, $3::text, false, null
      ) as result;
    `, [candidate.batch_id, candidate.registry_count, candidate.registry_keys_sha256]);
    return rows[0]?.result || { state: "rejected", reason: "missing retirement result" };
  });
}

function normalizeCandidate(candidate, validation) {
  return {
    batch_id: rowValue(candidate, "batch_id"),
    project_ref: rowValue(candidate, "project_ref"),
    source_policy_id: rowValue(candidate, "source_policy_id"),
    format_version: rowValue(candidate, "format_version"),
    status: rowValue(candidate, "status"),
    transaction_count: rowValue(candidate, "transaction_count"),
    entry_count: rowValue(candidate, "entry_count"),
    registry_count: rowValue(candidate, "registry_count"),
    registry_keys_sha256: rowValue(candidate, "registry_keys_sha256"),
    archive_proof_verified: Boolean(candidate.archive_proof_verified_at),
    prune_complete: Boolean(candidate.pruned_at),
    validation_state: validation?.state || "rejected",
    validation_reason: validation?.reason || null,
  };
}

export function buildResidualHorizonReport({
  inventory,
  classes = [],
  historical = null,
  beforeCanary = null,
  afterCanary = null,
  canaryEvidence = null,
} = {}) {
  const recordedAfterCanary = afterCanary || canaryEvidence;
  const projectRate = (row, field, days) => ({
    identity_class: row.identity_class,
    [field]: row[field] == null ? null : Number(row[field]),
    projected_value: row[field] == null ? null : Number(row[field]) * days,
  });
  return {
    horizon: "historical-missing-table-bot-retirement",
    inventory,
    classes,
    evidence: {
      historical: historical || {
        source: "issue-978-research-2026-09-11",
        status: "historical_reference_only",
        live_values_recorded: false,
      },
      before_canary: beforeCanary || {
        source: "current_read_only_audit",
        status: "current_before_canary",
        live_values_recorded: true,
      },
      after_canary: recordedAfterCanary || {
        source: "owner_authorized_stage_canary",
        status: "pending_owner_authorized_stage_canary",
        live_values_recorded: false,
      },
    },
    projection: {
      rows_per_day_30d: classes.map((row) => ({ identity_class: row.identity_class, rows_per_day: row.rows_per_day })),
      bytes_per_day_30d: classes.map((row) => ({ identity_class: row.identity_class, bytes_per_day: row.bytes_per_day })),
      hot_rows_per_day_30d: classes.map((row) => projectRate(row, "hot_rows_per_day", 30)),
      hot_bytes_per_day_30d: classes.map((row) => projectRate(row, "hot_bytes_per_day", 30)),
      horizon_30d: classes.map((row) => ({ identity_class: row.identity_class, rows: row.rows_per_day == null ? null : Number(row.rows_per_day) * 30 })),
      horizon_1y: classes.map((row) => ({ identity_class: row.identity_class, rows: row.rows_per_day == null ? null : Number(row.rows_per_day) * 365 })),
      hot_horizon_30d: classes.map((row) => projectRate(row, "hot_rows_per_day", 30)),
      hot_horizon_1y: classes.map((row) => projectRate(row, "hot_rows_per_day", 365)),
    },
    canary: recordedAfterCanary || {
      status: "pending_owner_authorized_stage_canary",
      live_values_recorded: false,
    },
  };
}

export function buildPostCanaryEvidenceTemplate() {
  return {
    status: "pending_owner_authorized_stage_canary",
    live_values_recorded: false,
    target: "stage",
    project_ref: STAGE_PROJECT_REF,
    system_identifier: STAGE_SYSTEM_IDENTIFIER,
    batch_ids: [],
    registry_key_count: null,
    registry_keys_sha256: null,
    receipt_status: null,
    rows_per_day: null,
    bytes_per_day: null,
    horizon_30d: null,
    horizon_1y: null,
    residual_rows_per_day_by_class: null,
    residual_bytes_per_day_by_class: null,
    projection_30d_by_class: null,
    projection_1y_by_class: null,
    balances: null,
    next_entry_seq: null,
    ledger_rows: null,
    provenance_rows: null,
    retired_key_replay_result: null,
    abort_or_blocking_reason: null,
  };
}

async function runAudit(tx, { writeKlog = klog } = {}) {
  const inventoryRows = await tx.unsafe(INVENTORY_SQL);
  const classRows = await tx.unsafe(CLASSIFICATION_SQL, [
    RETIREMENT_KEY_FORMATS,
    RETIREMENT_FULL_REPLAY_TX_TYPES,
  ]);
  const candidates = await tx.unsafe(CANDIDATE_SQL);
  const normalizedClasses = classRows.map((row) => ({
    identity_class: rowValue(row, "identity_class"),
    tx_type: rowValue(row, "tx_type"),
    key_format: rowValue(row, "key_format"),
    key_format_version: rowValue(row, "key_format_version"),
    ownership: rowValue(row, "ownership"),
    producer_state: rowValue(row, "producer_state"),
    replay_state: rowValue(row, "replay_state"),
    archive_state: rowValue(row, "archive_state"),
    source_policy_id: rowValue(row, "source_policy_id"),
    prune_state: rowValue(row, "prune_state"),
    age_band: rowValue(row, "age_band"),
    row_count: rowValue(row, "row_count"),
    mapped_count: rowValue(row, "mapped_count"),
    unmapped_count: rowValue(row, "unmapped_count"),
    hot_transaction_count: rowValue(row, "hot_transaction_count"),
    hot_entry_count: rowValue(row, "hot_entry_count"),
    hot_identity_count: rowValue(row, "hot_identity_count"),
    oldest_created_at: rowValue(row, "oldest_created_at"),
    newest_created_at: rowValue(row, "newest_created_at"),
    rows_per_day: rowValue(row, "rows_per_day"),
    bytes_per_day: rowValue(row, "bytes_per_day"),
    hot_rows_per_day: rowValue(row, "hot_rows_per_day"),
    hot_bytes_per_day: rowValue(row, "hot_bytes_per_day"),
    rows_last_30d: rowValue(row, "rows_last_30d"),
    bytes_last_30d: rowValue(row, "bytes_last_30d"),
    hot_rows_last_30d: rowValue(row, "hot_rows_last_30d"),
    hot_bytes_last_30d: rowValue(row, "hot_bytes_last_30d"),
  }));
  const validatedCandidates = [];
  for (const candidate of candidates) {
    const validation = await validateCandidate(tx, candidate);
    validatedCandidates.push(normalizeCandidate(candidate, validation));
  }
  const inventory = Object.fromEntries(Object.entries(inventoryRows[0] || {}).map(([key, value]) => [key, rowValue(inventoryRows[0], key)]));
  const report = buildResidualHorizonReport({
    inventory,
    classes: normalizedClasses,
  });
  writeKlog("chips_ledger_missing_table_bot_retirement_audit", {
    target: "stage",
    mode: "audit",
    source_policy_id: RETIREMENT_POLICY_ID,
    inventory,
    classes: normalizedClasses,
    candidates: validatedCandidates,
    residual_report: report,
  });
  return { inventory, classes: normalizedClasses, candidates: validatedCandidates, residualReport: report };
}

async function runExecute(tx, config, { writeKlog = klog } = {}) {
  const exactRows = await tx.unsafe(EXACT_BATCH_SQL, [config.batchId]);
  if (exactRows.length !== 1) fail("exact missing-table retirement batch was not found", "CHIPS_RETIREMENT_BATCH_NOT_FOUND");
  const candidate = exactRows[0];
  if (rowValue(candidate, "registry_count") !== config.registryCount
      || rowValue(candidate, "registry_keys_sha256") !== config.registrySha256) {
    fail("execute evidence does not match the current exact batch", "CHIPS_RETIREMENT_RECEIPT_MISMATCH");
  }
  const readyRows = await tx.unsafe(`
    select public.chips_retire_missing_table_bot_registry_batch(
      $1::bigint, $2::bigint, $3::text, false, null
    ) as result;
  `, [config.batchId, config.registryCount, config.registrySha256]);
  if (readyRows[0]?.result?.state !== "ready" && readyRows[0]?.result?.state !== "already_retired") {
    fail("exact batch did not pass prepare-only validation", "CHIPS_RETIREMENT_NOT_READY");
  }
  const executeRows = await tx.unsafe(`
    select public.chips_retire_missing_table_bot_registry_batch(
      $1::bigint, $2::bigint, $3::text, true, $4::text
    ) as result;
  `, [config.batchId, config.registryCount, config.registrySha256, config.confirmation]);
  const result = executeRows[0]?.result;
  if (result?.state !== "retired" && result?.state !== "already_retired") {
    fail("exact missing-table retirement did not return a terminal result", "CHIPS_RETIREMENT_FAILED");
  }
  writeKlog("chips_ledger_missing_table_bot_retirement_execute", {
    target: "stage",
    mode: "execute",
    source_policy_id: RETIREMENT_POLICY_ID,
    batch_id: config.batchId,
    registry_key_count: config.registryCount,
    registry_keys_sha256: config.registrySha256,
    result,
  });
  return result;
}

export async function runMissingTableBotRetirement({
  argv = process.argv.slice(2),
  env = process.env,
  deps = {},
} = {}) {
  const config = parseRetirementArgs(argv);
  if (config.help) {
    return {
      state: "help",
      usage: "node scripts/ops/chips-ledger-missing-table-bot-retirement.mjs --target stage --mode audit|execute",
    };
  }
  const environment = validateDbOnlyStageEnvironment(env);
  const createSql = deps.postgres || postgres;
  const sql = deps.sql || createSql(environment.dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 30,
  });
  const pruneStore = deps.pruneStore || createPruneStore(sql);
  const writeKlog = deps.writeKlog || klog;
  const ownsSql = !deps.sql;
  try {
    await assertArchivePruneStage(sql, pruneStore);
    if (config.mode === "audit") {
      return await sql.begin(async (tx) => {
        await tx.unsafe("set transaction isolation level repeatable read, read only;");
        await tx.unsafe("set local lock_timeout = '5s';");
        await tx.unsafe("set local statement_timeout = '120s';");
        await assertArchivePruneStage(tx);
        return runAudit(tx, { writeKlog });
      });
    }
    return await sql.begin(async (tx) => {
      await tx.unsafe("set transaction isolation level serializable;");
      await tx.unsafe("set local lock_timeout = '5s';");
      await tx.unsafe("set local statement_timeout = '120s';");
      await assertArchivePruneStage(tx);
      return runExecute(tx, config, { writeKlog });
    });
  } finally {
    if (ownsSql) await sql.end({ timeout: 5 });
  }
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  try {
    const result = await runMissingTableBotRetirement();
    if (result?.state === "help") {
      process.stdout.write(`${result.usage}\n`);
    }
  } catch (error) {
    klog("chips_ledger_missing_table_bot_retirement_error", {
      event: "chips_ledger_missing_table_bot_retirement_error",
      code: error.code || "CHIPS_RETIREMENT_FAILED",
      message: error.message,
    }, process.stderr.write.bind(process.stderr));
    process.exitCode = 1;
  }
}
