import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import postgres from "postgres";
import { writeExclusiveFiles } from "./_shared/chips-ledger-archive-files.mjs";

export const EXPORT_SCHEMA_VERSION = 1;
export const DEFAULT_CUTOFF_DAYS = 30;
export const DEFAULT_BATCH_SIZE = 5000;
export const MAX_BATCH_SIZE = 5000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTEGER_RE = /^-?(?:0|[1-9][0-9]*)$/;
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;

// Keep these bindings in sync with scripts/ops/ch-economy-network-maintenance.sh.
const TARGETS = Object.freeze({
  stage: Object.freeze({
    label: "Stage",
    dbEnv: "SUPABASE_STAGE_DB_URL",
    expectedRefEnv: "EXPECTED_SUPABASE_STAGE_PROJECT_REF",
    legacyRefEnv: "SUPABASE_STAGE_PROJECT_REF",
    canonicalRef: "krydukthwdvccggbyjfw",
  }),
  prod: Object.freeze({
    label: "Production",
    dbEnv: "SUPABASE_PROD_DB_URL",
    expectedRefEnv: "EXPECTED_SUPABASE_PROD_PROJECT_REF",
    legacyRefEnv: "SUPABASE_PROD_PROJECT_REF",
    canonicalRef: "otbqfijerkieoxwpxjnm",
  }),
});

const CANDIDATE_SQL = `
with base as (
  select t.*
  from public.chips_transactions t
  where t.created_at < $1::timestamptz
    and (
      $3::timestamptz is null
      or t.created_at > $3::timestamptz
      or (t.created_at = $3::timestamptz and t.id > $4::uuid)
    )
), markers as (
  select b.id as transaction_id,
         lower(nullif(btrim(b.metadata->>'tableId'), '')) as table_id
  from base b
  where nullif(btrim(b.metadata->>'tableId'), '') is not null

  union all

  select b.id,
         case
           when lower(b.reference) like 'table:%' then lower(nullif(btrim(split_part(b.reference, ':', 2)), ''))
           when lower(b.reference) like 'poker-rebuy:%' then lower(nullif(btrim(split_part(b.reference, ':', 2)), ''))
           else null
         end
  from base b
  where lower(b.reference) like 'table:%'
     or lower(b.reference) like 'poker-rebuy:%'

  union all

  select b.id,
         lower(nullif(btrim(substring(a.system_key from 13)), ''))
  from base b
  join public.chips_entries e on e.transaction_id = b.id
  join public.chips_accounts a on a.id = e.account_id
  where a.account_type = 'ESCROW'
    and upper(a.system_key) like 'POKER_TABLE:%'
), marker_summary as (
  select transaction_id,
         array_agg(distinct table_id) filter (where table_id is not null) as table_ids,
         bool_or(table_id is null or table_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') as invalid_table_marker
  from markers
  group by transaction_id
), classified as (
  select b.*,
         coalesce(ms.table_ids, array[]::text[]) as table_ids,
         coalesce(ms.invalid_table_marker, false) as invalid_table_marker
  from base b
  left join marker_summary ms on ms.transaction_id = b.id
)
select
  c.id::text as id,
  c.sequence::text as sequence,
  c.tx_type::text as tx_type,
  c.idempotency_key,
  c.payload_hash,
  c.user_id::text as user_id,
  c.reference,
  c.description,
  c.metadata,
  c.created_by::text as created_by,
  c.created_at::text as created_at,
  (cardinality(c.table_ids) > 0) as table_related,
  c.table_ids[1] as table_id,
  c.invalid_table_marker,
  (p.id is not null) as table_exists,
  p.status::text as table_status,
  ea.id::text as escrow_account_id,
  ea.status::text as escrow_status,
  ea.balance::text as escrow_balance,
  (select count(*)::text from public.chips_entries e where e.transaction_id = c.id) as entry_count
from classified c
left join public.poker_tables p on p.id::text = c.table_ids[1]
left join public.chips_accounts ea
  on ea.account_type = 'ESCROW'
 and ea.system_key = 'POKER_TABLE:' || c.table_ids[1]
where c.invalid_table_marker = false
  and cardinality(c.table_ids) <= 1
  and (
    cardinality(c.table_ids) = 0
    or (
      (p.id is null or upper(p.status) = 'CLOSED')
      and ea.id is not null
      and ea.balance = 0
    )
  )
  and exists (select 1 from public.chips_entries e where e.transaction_id = c.id)
order by c.created_at asc, c.id asc
limit $2::int;
`;

const ENTRIES_SQL = `
select
  e.id::text as id,
  e.transaction_id::text as transaction_id,
  e.account_id::text as account_id,
  e.entry_seq::text as entry_seq,
  e.amount::text as amount,
  e.metadata,
  e.created_at::text as created_at,
  a.id::text as account_row_id,
  a.account_type::text as account_type,
  a.user_id::text as account_user_id,
  a.system_key as account_system_key,
  a.status::text as account_status,
  a.label as account_label
from public.chips_entries e
join public.chips_accounts a on a.id = e.account_id
where e.transaction_id = any($1::uuid[])
order by e.transaction_id asc, e.id asc;
`;

const HELP = `Usage: node scripts/ops/chips-ledger-archive-export.mjs [options]

Required:
  --target stage|prod             Explicit target; no default.

Selection:
  --cutoff <timestamp>            Strict upper bound for transaction.created_at.
  --cutoff-days <integer>         Default: 30; ignored when --cutoff is set.
  --batch-size <integer>          Default/max: 5000.
  --after-created-at <timestamp>  Resume cursor timestamp.
  --after-id <uuid>               Resume cursor UUID tie-breaker.

Output:
  --output <path>                 Required; use a private path outside checkout.
  --manifest <path>               Default: <output>.manifest.json

The selected database transaction is REPEATABLE READ and READ ONLY. The script
does not upload, delete, update, insert, or alter any ledger or poker row.
`;

function fail(message) {
  throw new Error(message);
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

export function toBigIntString(value, label = "bigint") {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  const normalized = text(value);
  if (!INTEGER_RE.test(normalized)) fail(`${label} is not an integer value`);
  return normalized;
}

function nullableText(value) {
  return value == null ? null : text(value) || null;
}

function normalizeJson(value) {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    fail("database JSON value could not be parsed");
  }
}

export function timestampToMicros(value) {
  const normalized = text(value).replace(" ", "T").replace(/([+-][0-9]{2})([0-9]{2})$/, "$1:$2").replace(/\+00$/, "Z");
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(normalized);
  if (!match) fail("timestamp must include an explicit timezone and at most six fractional digits");
  const baseMillis = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(baseMillis)) fail("timestamp is invalid");
  const micros = (match[2] || "").padEnd(6, "0");
  return BigInt(baseMillis) * 1000n + BigInt(micros || "0");
}

export function normalizeTimestamp(value, label = "timestamp") {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail(`${label} is invalid`);
    return value.toISOString();
  }
  const normalized = text(value).replace(" ", "T").replace(/([+-][0-9]{2})([0-9]{2})$/, "$1:$2").replace(/\+00$/, "Z");
  try {
    timestampToMicros(normalized);
  } catch (error) {
    fail(`${label} is invalid: ${error.message}`);
  }
  return normalized;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareTransactions(left, right) {
  const leftTransaction = left?.transaction || left;
  const rightTransaction = right?.transaction || right;
  const leftMicros = timestampToMicros(leftTransaction?.created_at ?? leftTransaction?.createdAt);
  const rightMicros = timestampToMicros(rightTransaction?.created_at ?? rightTransaction?.createdAt);
  if (leftMicros < rightMicros) return -1;
  if (leftMicros > rightMicros) return 1;
  return compareText(text(leftTransaction?.id), text(rightTransaction?.id));
}

function compareEntries(left, right) {
  const leftId = BigInt(toBigIntString(left?.id, "entry.id"));
  const rightId = BigInt(toBigIntString(right?.id, "entry.id"));
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

export function sortRecords(records) {
  return [...records].sort(compareTransactions);
}

export function stringifyJson(value) {
  return JSON.stringify(value, (_key, nested) => (typeof nested === "bigint" ? nested.toString() : nested));
}

export function serializeRecords(records) {
  if (!records.length) return "";
  return `${records.map((record) => stringifyJson(record)).join("\n")}\n`;
}

export function parseJsonl(rawText) {
  if (rawText === "") return [];
  if (!rawText.endsWith("\n")) fail("JSONL artifact has no final newline");
  return rawText.slice(0, -1).split("\n").map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      fail("JSONL artifact contains invalid JSON");
    }
  });
}

export function buildArchiveBytes(records) {
  const rawText = serializeRecords(records);
  const rawBytes = Buffer.from(rawText, "utf8");
  const compressedBytes = gzipSync(rawBytes, { level: 9, mtime: 0 });
  return {
    rawText,
    rawBytes,
    compressedBytes,
    rawSha256: crypto.createHash("sha256").update(rawBytes).digest("hex"),
    compressedSha256: crypto.createHash("sha256").update(compressedBytes).digest("hex"),
  };
}

export function evaluateTableEligibility(candidate) {
  const tableId = text(candidate?.table_id ?? candidate?.tableId);
  const related = candidate?.table_related === true || candidate?.tableRelated === true || Boolean(tableId);
  if (!related) return { eligible: true, reason: "not_poker_table_lifecycle" };
  if (candidate?.invalid_table_marker === true || candidate?.invalidTableMarker === true) {
    return { eligible: false, reason: "invalid_table_marker" };
  }
  if (!UUID_RE.test(tableId)) return { eligible: false, reason: "invalid_table_id" };
  if (!text(candidate?.escrow_account_id ?? candidate?.escrowAccountId)) {
    return { eligible: false, reason: "escrow_missing" };
  }
  if (toBigIntString(candidate?.escrow_balance ?? candidate?.escrowBalance, "escrow.balance") !== "0") {
    return { eligible: false, reason: "escrow_non_zero" };
  }
  const tableExists = candidate?.table_exists === true || candidate?.tableExists === true;
  if (tableExists && text(candidate?.table_status ?? candidate?.tableStatus).toUpperCase() !== "CLOSED") {
    return { eligible: false, reason: "table_not_closed" };
  }
  return { eligible: true, reason: tableExists ? "closed_table" : "retained_escrow_after_table_retention" };
}

function buildTableContext(candidate) {
  if (!candidate?.table_related && !candidate?.tableRelated && !candidate?.table_id && !candidate?.tableId) return null;
  return {
    table_id: text(candidate.table_id ?? candidate.tableId),
    table_exists: candidate.table_exists === true || candidate.tableExists === true,
    table_status: nullableText(candidate.table_status ?? candidate.tableStatus)?.toUpperCase() || null,
    escrow_account_id: nullableText(candidate.escrow_account_id ?? candidate.escrowAccountId),
    escrow_status: nullableText(candidate.escrow_status ?? candidate.escrowStatus)?.toLowerCase() || null,
    escrow_balance: toBigIntString(candidate.escrow_balance ?? candidate.escrowBalance, "escrow.balance"),
  };
}

export function buildExportRecord(candidate, rawEntries) {
  const transactionId = text(candidate?.id);
  if (!UUID_RE.test(transactionId)) fail("transaction.id is not a UUID");
  const entries = [...rawEntries].sort(compareEntries).map((entry) => ({
    id: toBigIntString(entry.id, "entry.id"),
    transaction_id: text(entry.transaction_id),
    account_id: text(entry.account_id),
    entry_seq: toBigIntString(entry.entry_seq, "entry.entry_seq"),
    amount: toBigIntString(entry.amount, "entry.amount"),
    metadata: normalizeJson(entry.metadata),
    created_at: normalizeTimestamp(entry.created_at, "entry.created_at"),
    account: {
      id: text(entry.account_row_id || entry.account_id),
      account_type: text(entry.account_type),
      user_id: nullableText(entry.account_user_id),
      system_key: nullableText(entry.account_system_key),
      status: nullableText(entry.account_status),
      label: nullableText(entry.account_label),
    },
  }));

  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    record_type: "chips_transaction",
    transaction: {
      id: transactionId,
      sequence: toBigIntString(candidate.sequence, "transaction.sequence"),
      tx_type: text(candidate.tx_type),
      idempotency_key: text(candidate.idempotency_key),
      payload_hash: text(candidate.payload_hash),
      user_id: nullableText(candidate.user_id),
      reference: nullableText(candidate.reference),
      description: nullableText(candidate.description),
      metadata: normalizeJson(candidate.metadata),
      created_by: nullableText(candidate.created_by),
      created_at: normalizeTimestamp(candidate.created_at, "transaction.created_at"),
    },
    table_context: buildTableContext(candidate),
    entries,
  };
}

function candidateId(candidate) {
  return text(candidate?.id);
}

export function validateBatch({ candidates, records, cutoff }) {
  if (!Array.isArray(candidates) || !Array.isArray(records)) fail("batch must contain arrays");
  if (candidates.length !== records.length) fail("batch transaction count mismatch");

  const candidatesById = new Map();
  for (const candidate of candidates) {
    const id = candidateId(candidate);
    if (!UUID_RE.test(id) || candidatesById.has(id)) fail("duplicate transaction in candidate batch");
    candidatesById.set(id, candidate);
  }

  const expectedOrder = [...candidates].sort((left, right) => compareTransactions(left, right)).map(candidateId);
  const seenTransactions = new Set();
  const seenEntries = new Set();
  const txTypeCounts = {};
  let entryCount = 0;
  let credits = 0n;
  let debits = 0n;
  let netAmount = 0n;

  records.forEach((record, index) => {
    const transaction = record?.transaction;
    const id = text(transaction?.id);
    if (record?.schema_version !== EXPORT_SCHEMA_VERSION || record?.record_type !== "chips_transaction") {
      fail("unsupported or malformed export record");
    }
    if (id !== expectedOrder[index]) fail("transaction order is not deterministic");
    if (seenTransactions.has(id)) fail("duplicate transaction in exported batch");
    seenTransactions.add(id);

    const candidate = candidatesById.get(id);
    if (!candidate) fail("exported transaction was not selected by the database query");
    if (cutoff && timestampToMicros(transaction.created_at) >= timestampToMicros(cutoff)) {
      fail("exported transaction is not older than cutoff");
    }
    const eligibility = evaluateTableEligibility(candidate);
    if (!eligibility.eligible) fail(`ineligible poker transaction: ${eligibility.reason}`);

    const expectedEntries = BigInt(toBigIntString(candidate.entry_count, "database entry count"));
    if (!Array.isArray(record.entries) || BigInt(record.entries.length) !== expectedEntries) {
      fail(`incomplete entry set for transaction ${id}`);
    }
    const expectedEntryOrder = [...record.entries].sort(compareEntries).map((entry) => toBigIntString(entry.id, "entry.id"));
    if (record.entries.map((entry) => toBigIntString(entry.id, "entry.id")).some((entryId, entryIndex) => entryId !== expectedEntryOrder[entryIndex])) {
      fail(`entry order is not deterministic: ${id}`);
    }

    let total = 0n;
    for (const entry of record.entries) {
      if (text(entry.transaction_id) !== id) fail(`entry points to another transaction: ${id}`);
      const entryId = toBigIntString(entry.id, "entry.id");
      if (seenEntries.has(entryId)) fail(`duplicate entry in exported batch: ${entryId}`);
      seenEntries.add(entryId);
      if (text(entry.account_id) !== text(entry.account?.id)) fail(`entry account identity mismatch: ${entryId}`);
      const amount = BigInt(toBigIntString(entry.amount, "entry.amount"));
      total += amount;
      netAmount += amount;
      if (amount > 0n) credits += amount;
      if (amount < 0n) debits -= amount;
    }
    if (total !== 0n) fail(`transaction is not conserved: ${id}`);
    const txType = text(transaction.tx_type);
    if (!txType) fail(`transaction type is missing: ${id}`);
    txTypeCounts[txType] = (txTypeCounts[txType] || 0) + 1;
    entryCount += record.entries.length;
  });

  if (netAmount !== 0n || credits !== debits) fail("batch is not conserved");

  return {
    transactionCount: records.length,
    entryCount,
    txTypeCounts: Object.fromEntries(Object.entries(txTypeCounts).sort(([left], [right]) => compareText(left, right))),
    credits: credits.toString(),
    debits: debits.toString(),
    netAmount: netAmount.toString(),
  };
}

export function buildManifest({ target, cutoff, batchSize, cursor, records, archive, outputPath }) {
  const validation = validateBatch({ candidates: records.map((record) => ({
    id: record.transaction.id,
    created_at: record.transaction.created_at,
    entry_count: String(record.entries.length),
    table_related: Boolean(record.table_context),
    table_id: record.table_context?.table_id,
    table_exists: record.table_context?.table_exists,
    table_status: record.table_context?.table_status,
    escrow_account_id: record.table_context?.escrow_account_id,
    escrow_balance: record.table_context?.escrow_balance,
  })), records, cutoff: null });
  const first = records[0]?.transaction || null;
  const last = records.at(-1)?.transaction || null;
  const compressionRatio = archive.rawBytes.length === 0
    ? null
    : Number((archive.compressedBytes.length / archive.rawBytes.length).toFixed(6));
  const endCursor = last ? { created_at: last.created_at, id: last.id } : null;

  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    artifact_type: "chips_ledger_archive",
    format: "jsonl.gz",
    target,
    cutoff: {
      created_at: cutoff,
      rule: "transaction.created_at < cutoff",
    },
    batch: {
      limit: batchSize,
      transactions: validation.transactionCount,
      entries: validation.entryCount,
      tx_types: validation.txTypeCounts,
    },
    amounts: {
      credits: validation.credits,
      debits: validation.debits,
      net: validation.netAmount,
    },
    time_range: {
      first_created_at: first?.created_at || null,
      last_created_at: last?.created_at || null,
    },
    cursor: {
      order: ["transaction.created_at ASC", "transaction.id ASC"],
      start: cursor || null,
      end: endCursor,
      next: endCursor,
    },
    bytes: {
      raw: archive.rawBytes.length,
      compressed: archive.compressedBytes.length,
      compression_ratio_compressed_over_raw: compressionRatio,
    },
    sha256: {
      raw_jsonl: archive.rawSha256,
      compressed_artifact: archive.compressedSha256,
    },
    artifact: path.basename(outputPath),
  };
}

function parseArgs(argv) {
  const keyMap = {
    "target": "target",
    "cutoff": "cutoff",
    "cutoff-days": "cutoffDays",
    "batch-size": "batchSize",
    "after-created-at": "afterCreatedAt",
    "after-id": "afterId",
    "output": "output",
    "manifest": "manifest",
  };
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (!token.startsWith("--") || !keyMap[token.slice(2)]) fail(`unknown argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${token} requires a value`);
    args[keyMap[token.slice(2)]] = value;
    index += 1;
  }
  return args;
}

function parseBoundedInteger(value, name, { min, max }) {
  const normalized = text(value);
  if (!/^\d+$/.test(normalized)) fail(`${name} must be an integer`);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail(`${name} must be between ${min} and ${max}`);
  return parsed;
}

function deriveProjectRef(dbUrl) {
  let url;
  try {
    url = new URL(dbUrl);
  } catch {
    fail("selected database URL is invalid");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") fail("selected database URL must be PostgreSQL");
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(url.hostname);
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(url.hostname);
  const user = /^postgres\.([a-z0-9]{20})$/i.exec(decodeURIComponent(url.username || ""));
  const ref = direct?.[1] || (pooler ? user?.[1] : null);
  if (!ref) fail("selected database URL does not expose a supported Supabase project ref");
  return ref.toLowerCase();
}

export function resolveTarget(targetValue, env = process.env) {
  const target = text(targetValue);
  const config = TARGETS[target];
  if (!config) fail("target must be exactly stage or prod");

  const expectedRefs = {};
  for (const [name, targetConfig] of Object.entries(TARGETS)) {
    const expected = text(env[targetConfig.expectedRefEnv] || env[targetConfig.legacyRefEnv]).toLowerCase();
    if (!PROJECT_REF_RE.test(expected)) fail(`${targetConfig.expectedRefEnv} is required and must be a project ref`);
    if (expected !== targetConfig.canonicalRef) fail(`${targetConfig.expectedRefEnv} does not match the versioned canonical ref`);
    expectedRefs[name] = expected;
  }
  if (expectedRefs.stage === expectedRefs.prod) fail("stage and production project refs must differ");

  const dbUrl = text(env[config.dbEnv]);
  if (!dbUrl) fail(`${config.dbEnv} is required for target ${target}`);
  const dbProjectRef = deriveProjectRef(dbUrl);
  if (dbProjectRef !== config.canonicalRef) fail(`${config.dbEnv} does not match the canonical ${target} project ref`);

  return { target, label: config.label, dbUrl, projectRef: dbProjectRef };
}

function resolveCursor(args) {
  const hasCreatedAt = args.afterCreatedAt != null;
  const hasId = args.afterId != null;
  if (hasCreatedAt !== hasId) fail("--after-created-at and --after-id must be supplied together");
  if (!hasCreatedAt) return null;
  const createdAt = normalizeTimestamp(args.afterCreatedAt, "--after-created-at");
  const id = text(args.afterId).toLowerCase();
  if (!UUID_RE.test(id)) fail("--after-id must be a UUID");
  return { created_at: createdAt, id };
}

function resolveOptions(args, env, cwd, now) {
  if (!args.output) fail("--output is required; use a private path outside the repository");
  const target = resolveTarget(args.target, env);
  const cutoff = args.cutoff
    ? normalizeTimestamp(args.cutoff, "--cutoff")
    : (() => {
        const days = args.cutoffDays == null ? DEFAULT_CUTOFF_DAYS : parseBoundedInteger(args.cutoffDays, "--cutoff-days", { min: 0, max: 36500 });
        return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
      })();
  const batchSize = args.batchSize == null
    ? DEFAULT_BATCH_SIZE
    : parseBoundedInteger(args.batchSize, "--batch-size", { min: 1, max: MAX_BATCH_SIZE });
  const outputPath = path.resolve(cwd, args.output);
  const manifestPath = path.resolve(cwd, args.manifest || `${outputPath}.manifest.json`);
  if (outputPath === manifestPath) fail("--output and --manifest must be different paths");
  if (fs.existsSync(outputPath)) fail(`refusing to overwrite existing artifact: ${outputPath}`);
  if (fs.existsSync(manifestPath)) fail(`refusing to overwrite existing manifest: ${manifestPath}`);
  return { ...target, cutoff, batchSize, cursor: resolveCursor(args), outputPath, manifestPath };
}

async function readSnapshot(sql, options) {
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read, read only;");
    const candidates = await tx.unsafe(CANDIDATE_SQL, [
      options.cutoff,
      options.batchSize,
      options.cursor?.created_at || null,
      options.cursor?.id || null,
    ]);
    const ids = candidates.map((candidate) => text(candidate.id));
    const entries = ids.length ? await tx.unsafe(ENTRIES_SQL, [ids]) : [];
    return { candidates, entries };
  });
}

function groupEntries(rows, candidateIds) {
  const groups = new Map();
  for (const row of rows) {
    const transactionId = text(row.transaction_id);
    if (!candidateIds.has(transactionId)) fail("database returned an entry outside the selected transaction batch");
    const current = groups.get(transactionId) || [];
    current.push(row);
    groups.set(transactionId, current);
  }
  return groups;
}

function writeOutput(options, archive, manifest) {
  writeExclusiveFiles([
    { path: options.outputPath, data: archive.compressedBytes },
    { path: options.manifestPath, data: `${stringifyJson(manifest)}\n` },
  ]);
}

function outputMetrics(manifest, options) {
  const summary = {
    event: "chips_ledger_archive_export",
    read_only: true,
    target: options.target,
    project_ref: options.projectRef,
    artifact: options.outputPath,
    manifest: options.manifestPath,
    transactions: manifest.batch.transactions,
    entries: manifest.batch.entries,
    time_range: manifest.time_range,
    cursor: manifest.cursor,
    tx_types: manifest.batch.tx_types,
    amounts: manifest.amounts,
    raw_bytes: manifest.bytes.raw,
    compressed_bytes: manifest.bytes.compressed,
    compression_ratio_compressed_over_raw: manifest.bytes.compression_ratio_compressed_over_raw,
    sha256: manifest.sha256,
  };
  process.stdout.write(`${stringifyJson(summary)}\n`);
}

export async function runExport({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), now = new Date() } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return null;
  }
  const options = resolveOptions(args, env, cwd, now);
  const sql = postgres(options.dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 30,
  });

  try {
    const snapshot = await readSnapshot(sql, options);
    const candidateIds = new Set(snapshot.candidates.map((candidate) => text(candidate.id)));
    const entriesByTransaction = groupEntries(snapshot.entries, candidateIds);
    const records = sortRecords(snapshot.candidates.map((candidate) => buildExportRecord(
      candidate,
      entriesByTransaction.get(text(candidate.id)) || [],
    )));
    validateBatch({ candidates: snapshot.candidates, records, cutoff: options.cutoff });

    const archive = buildArchiveBytes(records);
    const roundTripRaw = gunzipSync(archive.compressedBytes);
    if (!roundTripRaw.equals(archive.rawBytes)) fail("gzip round-trip verification failed");
    const roundTripRecords = parseJsonl(roundTripRaw.toString("utf8"));
    validateBatch({ candidates: snapshot.candidates, records: roundTripRecords, cutoff: options.cutoff });
    if (serializeRecords(roundTripRecords) !== archive.rawText) fail("JSONL round-trip verification failed");

    const manifest = buildManifest({
      target: options.target,
      cutoff: options.cutoff,
      batchSize: options.batchSize,
      cursor: options.cursor,
      records,
      archive,
      outputPath: options.outputPath,
    });
    if (manifest.sha256.compressed_artifact !== crypto.createHash("sha256").update(archive.compressedBytes).digest("hex")) {
      fail("manifest checksum verification failed");
    }
    writeOutput(options, archive, manifest);
    outputMetrics(manifest, options);
    return manifest;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runExport().catch((error) => {
    process.stderr.write(`chips-ledger-archive-export failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
