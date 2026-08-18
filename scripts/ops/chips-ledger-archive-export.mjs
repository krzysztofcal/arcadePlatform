import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import postgres from "postgres";
import { writeExclusiveFiles } from "./_shared/chips-ledger-archive-files.mjs";
import { assertTableBinding } from "./_shared/chips-table-idempotency.mjs";

export const EXPORT_SCHEMA_VERSION = 1;
export const DEFAULT_CUTOFF_DAYS = 30;
export const DEFAULT_BATCH_SIZE = 5000;
export const MAX_BATCH_SIZE = 5000;
export const PRODUCTION_MAX_BATCH_SIZE = 2;
export const STAGE_AUTOMATION_POLICY_ID = "stage-ledger-auto-retention-30d-v1";
export const BOT_ONLY_RETENTION_POLICY_ID = "stage-ledger-bot-only-retention-7d-v1";
export const BOT_ONLY_EXPORT_SCHEMA_VERSION = 2;
export const BOT_ONLY_RETENTION_DAYS = 7;

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

// The manual exporter deliberately keeps its broad, lifecycle-safe selector.
// Stage automation uses this independent selector so the JSONL itself is
// prunable-only before Storage or proof state is created.
export const PRUNABLE_CANDIDATE_SQL = `
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
  where a.account_type::text = 'ESCROW'
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
), eligible as (
  select c.*,
         p.id as table_row_id,
         p.status::text as table_status,
         ea.id::text as escrow_account_id,
         ea.status::text as escrow_status,
         ea.balance::text as escrow_balance
  from classified c
  left join public.poker_tables p on p.id::text = c.table_ids[1]
  left join public.chips_accounts ea
    on ea.account_type::text = 'ESCROW'
   and ea.system_key = 'POKER_TABLE:' || c.table_ids[1]
  where c.invalid_table_marker = false
    and cardinality(c.table_ids) = 1
    and c.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
    and c.user_id is null
    and (p.id is null or upper(p.status::text) = 'CLOSED')
    and ea.id is not null
    and ea.status::text = 'active'
    and ea.balance = 0
), eligible_ids as (
  select e.id
  from eligible e
  join public.chips_entries entries on entries.transaction_id = e.id
  join public.chips_accounts accounts on accounts.id = entries.account_id
  where exists (
    select 1
    from public.chips_transaction_idempotency registry
    where registry.idempotency_key = e.idempotency_key
      and registry.transaction_id = e.id
      and registry.payload_hash = e.payload_hash
      and registry.tx_type = e.tx_type
      and registry.user_id is not distinct from e.user_id
      and registry.transaction_created_at = e.created_at
      and registry.archive_batch_id is null
  )
    and not exists (
      select 1
      from public.chips_transaction_idempotency mapped
      where mapped.transaction_id = e.id
        and mapped.archive_batch_id is not null
    )
  group by e.id, e.tx_type
  having count(*) = 2
     and count(*) filter (where accounts.account_type::text = 'USER') = 0
     and count(*) filter (where accounts.account_type::text = 'SYSTEM') = 1
     and count(*) filter (where accounts.account_type::text = 'ESCROW') = 1
     and count(*) filter (
       where accounts.account_type::text = 'ESCROW'
         and accounts.system_key = 'POKER_TABLE:' || e.table_ids[1]
     ) = 1
     and bool_and(accounts.status::text = 'active')
     and sum(entries.amount) = 0
     and (
       (e.tx_type::text = 'TABLE_BUY_IN'
        and sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM') < 0
        and sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW') > 0)
       or
       (e.tx_type::text = 'TABLE_CASH_OUT'
        and sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW') < 0
        and sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM') > 0)
     )
)
select
  e.id::text as id,
  e.sequence::text as sequence,
  e.tx_type::text as tx_type,
  e.idempotency_key,
  e.payload_hash,
  e.user_id::text as user_id,
  e.reference,
  e.description,
  e.metadata,
  e.created_by::text as created_by,
  e.created_at::text as created_at,
  true as table_related,
  e.table_ids[1] as table_id,
  false as invalid_table_marker,
  (e.table_row_id is not null) as table_exists,
  e.table_status,
  e.escrow_account_id,
  e.escrow_status,
  e.escrow_balance,
  (select count(*)::text from public.chips_entries entries where entries.transaction_id = e.id) as entry_count
from eligible e
join eligible_ids ids on ids.id = e.id
order by e.created_at asc, e.id asc
limit $2::int;
`;

// Schema-v2 selection is table-complete.  A batch contains one table only;
// this makes the lifecycle receipt and the final table marker independently
// auditable and leaves an over-capacity table untouched.
export const BOT_ONLY_CANDIDATE_SQL = `
with table_rows as (
  select registry.table_id,
         max(registry.transaction_created_at) as newest_created_at,
         count(*)::bigint as identity_count,
         count(*) filter (
           where registry.user_id is null
             and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
             and registry.transaction_created_at < $1::timestamptz
             and registry.archive_batch_id is null
         )::bigint as eligible_count,
         public.chips_archive_text_ids_sha256(
           coalesce(array_agg(registry.idempotency_key order by registry.idempotency_key)
             filter (where registry.user_id is not null), array[]::text[])
         ) as out_of_scope_keys_sha256
    from public.chips_transaction_idempotency registry
   where registry.table_id is not null
   group by registry.table_id
), eligible_transactions as (
  select transactions.id,
         transactions.sequence,
         transactions.tx_type,
         transactions.idempotency_key,
         transactions.payload_hash,
         transactions.user_id,
         transactions.reference,
         transactions.description,
         transactions.metadata,
         transactions.created_by,
         transactions.created_at,
         registry.table_id as key_table_id,
         registry.key_format_version,
         registry.key_format,
         tables.id as table_row_id,
         tables.status::text as table_status,
         tables.has_human_participant,
         tables.bot_only_proof_eligible,
         escrow.id::text as escrow_account_id,
         escrow.status::text as escrow_status,
         escrow.balance::text as escrow_balance,
         stats.newest_created_at as table_newest_created_at,
         stats.identity_count as table_identity_count,
         stats.eligible_count as table_eligible_count,
         stats.out_of_scope_keys_sha256 as table_out_of_scope_keys_sha256,
         count(entries.id)::text as entry_count
    from public.chips_transactions transactions
    join public.chips_transaction_idempotency registry
      on registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
     and registry.payload_hash = transactions.payload_hash
     and registry.tx_type = transactions.tx_type
     and registry.user_id is not distinct from transactions.user_id
     and registry.transaction_created_at = transactions.created_at
     and registry.table_id is not null
     and registry.key_format_version = 1
     and registry.key_format is not null
     and registry.key_format = public.chips_parse_table_idempotency_key(transactions.idempotency_key)->>'format'
     and registry.archive_batch_id is null
    join table_rows stats on stats.table_id = registry.table_id
    join public.poker_tables tables on tables.id = registry.table_id
    join public.chips_accounts escrow
      on escrow.account_type::text = 'ESCROW'
     and escrow.system_key = 'POKER_TABLE:' || registry.table_id::text
   join public.chips_entries entries on entries.transaction_id = transactions.id
   join public.chips_accounts accounts on accounts.id = entries.account_id
   where $3::timestamptz is null
     and transactions.created_at < $1::timestamptz
     and transactions.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and transactions.user_id is null
     and tables.status::text = 'CLOSED'
     and tables.has_human_participant is false
     and tables.bot_only_proof_eligible is true
     and escrow.status::text = 'active'
     and escrow.balance = 0
     and stats.newest_created_at < $1::timestamptz
     and stats.eligible_count > 0
     and stats.eligible_count <= $2::int
     and not exists (
       select 1 from public.chips_transaction_idempotency unknown
        where unknown.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
          and unknown.table_id is null
     )
     and not exists (
       select 1 from table_rows blocked
        where blocked.table_id = registry.table_id
          and blocked.eligible_count <> blocked.identity_count
     )
   group by transactions.id, transactions.sequence, transactions.tx_type,
            transactions.idempotency_key, transactions.payload_hash,
            transactions.user_id, transactions.reference, transactions.description,
            transactions.metadata, transactions.created_by, transactions.created_at,
            registry.table_id, registry.key_format_version, registry.key_format,
            tables.id, tables.status, tables.has_human_participant,
            tables.bot_only_proof_eligible, escrow.id, escrow.status, escrow.balance,
            stats.newest_created_at, stats.identity_count, stats.eligible_count,
            stats.out_of_scope_keys_sha256
  having count(*) = 2
     and count(*) filter (where accounts.account_type::text = 'USER') = 0
     and count(*) filter (where accounts.account_type::text = 'SYSTEM') = 1
     and count(*) filter (where accounts.account_type::text = 'ESCROW') = 1
     and count(*) filter (
       where accounts.account_type::text = 'ESCROW'
         and accounts.system_key = 'POKER_TABLE:' || registry.table_id::text
     ) = 1
     and bool_and(accounts.status::text = 'active')
     and sum(entries.amount) = 0
     and (
       (transactions.tx_type::text = 'TABLE_BUY_IN'
        and sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM') < 0
        and sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW') > 0)
       or
       (transactions.tx_type::text = 'TABLE_CASH_OUT'
        and sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW') < 0
        and sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM') > 0)
     )
), selected_table as (
  select key_table_id
    from eligible_transactions
   group by key_table_id
   order by key_table_id
   limit 1
)
select eligible.id::text as id,
       eligible.sequence::text as sequence,
       eligible.tx_type::text as tx_type,
       eligible.idempotency_key,
       eligible.payload_hash,
       eligible.user_id::text as user_id,
       eligible.reference,
       eligible.description,
       eligible.metadata,
       eligible.created_by::text as created_by,
       eligible.created_at::text as created_at,
       true as table_related,
       eligible.key_table_id::text as table_id,
       false as invalid_table_marker,
       true as table_exists,
       eligible.table_status,
       eligible.escrow_account_id,
       eligible.escrow_status,
       eligible.escrow_balance,
       eligible.entry_count,
       eligible.has_human_participant,
       eligible.bot_only_proof_eligible,
       eligible.key_table_id::text,
       eligible.key_format_version,
       eligible.key_format,
       eligible.table_newest_created_at::text,
       eligible.table_identity_count,
       eligible.table_eligible_count,
       eligible.table_out_of_scope_keys_sha256
  from eligible_transactions eligible
  join selected_table on selected_table.key_table_id = eligible.key_table_id
 order by eligible.created_at asc, eligible.id asc
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
  --batch-size <integer>          Stage default/max: 5000; Production max: 2.
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

function buildTableContext(candidate, schemaVersion = EXPORT_SCHEMA_VERSION) {
  if (!candidate?.table_related && !candidate?.tableRelated && !candidate?.table_id && !candidate?.tableId) return null;
  const context = {
    table_id: text(candidate.table_id ?? candidate.tableId),
    table_exists: candidate.table_exists === true || candidate.tableExists === true,
    table_status: nullableText(candidate.table_status ?? candidate.tableStatus)?.toUpperCase() || null,
    escrow_account_id: nullableText(candidate.escrow_account_id ?? candidate.escrowAccountId),
    escrow_status: nullableText(candidate.escrow_status ?? candidate.escrowStatus)?.toLowerCase() || null,
    escrow_balance: toBigIntString(candidate.escrow_balance ?? candidate.escrowBalance, "escrow.balance"),
  };
  if (schemaVersion === BOT_ONLY_EXPORT_SCHEMA_VERSION) {
    context.bot_only_proof = {
      has_human_participant: candidate.has_human_participant === false
        ? false
        : candidate.has_human_participant === true ? true : null,
      proof_eligible: candidate.bot_only_proof_eligible === true
        ? true
        : candidate.bot_only_proof_eligible === false ? false : null,
      table_id_from_key: text(candidate.key_table_id ?? candidate.table_id ?? candidate.tableId),
      key_format_version: Number(candidate.key_format_version),
      key_format: text(candidate.key_format),
    };
    context.table_identity_summary = {
      newest_created_at: normalizeTimestamp(candidate.table_newest_created_at, "table.newest_created_at"),
      identity_count: toBigIntString(candidate.table_identity_count, "table.identity_count"),
      eligible_count: toBigIntString(candidate.table_eligible_count, "table.eligible_count"),
      out_of_scope_keys_sha256: text(candidate.table_out_of_scope_keys_sha256),
    };
  }
  return context;
}

export function buildExportRecord(candidate, rawEntries, { schemaVersion = EXPORT_SCHEMA_VERSION } = {}) {
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
    schema_version: schemaVersion,
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
    table_context: buildTableContext(candidate, schemaVersion),
    entries,
  };
}

function candidateId(candidate) {
  return text(candidate?.id);
}

function validateBotOnlyRecord(candidate, record) {
  const transaction = record?.transaction;
  const context = record?.table_context;
  const proof = context?.bot_only_proof;
  const summary = context?.table_identity_summary;
  if (transaction?.tx_type !== "TABLE_BUY_IN" && transaction?.tx_type !== "TABLE_CASH_OUT") fail("bot-only archive contains a non-TABLE transaction");
  if (transaction.user_id != null) fail("bot-only archive contains a USER transaction");
  if (!context || context.table_exists !== true || context.table_status !== "CLOSED"
    || !context.escrow_account_id || context.escrow_status !== "active" || context.escrow_balance !== "0") {
    fail("bot-only archive table lifecycle evidence is incomplete");
  }
  if (candidate?.has_human_participant !== false || candidate?.bot_only_proof_eligible !== true) {
    fail("bot-only candidate human-participant proof is not authoritative");
  }
  if (!proof || proof.has_human_participant !== false || proof.proof_eligible !== true) fail("bot-only archive human-participant proof is not authoritative");
  if (proof.table_id_from_key !== context.table_id || proof.key_format_version !== 1 || !proof.key_format) fail("bot-only idempotency key binding evidence is incomplete");
  if (!summary || BigInt(summary.identity_count) < 1n || BigInt(summary.eligible_count) < 1n || !/^[0-9a-f]{64}$/.test(summary.out_of_scope_keys_sha256)) fail("bot-only table completeness evidence is incomplete");
  const parsedBinding = assertTableBinding({
    idempotencyKey: transaction.idempotency_key,
    metadata: transaction.metadata,
    reference: transaction.reference,
  });
  if (parsedBinding.tableId !== context.table_id || parsedBinding.format !== proof.key_format) fail("bot-only idempotency key binding differs from the table context");
  const tableEntries = record.entries || [];
  if (tableEntries.length !== 2 || tableEntries.some((entry) => entry.account?.account_type === "USER")) fail("bot-only archive entry shape contains a USER entry");
  const escrowEntries = tableEntries.filter((entry) => entry.account?.account_type === "ESCROW");
  const systemEntries = tableEntries.filter((entry) => entry.account?.account_type === "SYSTEM");
  if (escrowEntries.length !== 1 || systemEntries.length !== 1 || escrowEntries[0].account.system_key !== `POKER_TABLE:${context.table_id}`) {
    fail("bot-only archive ESCROW binding is incomplete");
  }
  const escrowAmount = BigInt(escrowEntries[0].amount);
  const systemAmount = BigInt(systemEntries[0].amount);
  if (transaction.tx_type === "TABLE_BUY_IN" && !(escrowAmount > 0n && systemAmount < 0n)) fail("bot-only TABLE_BUY_IN direction is invalid");
  if (transaction.tx_type === "TABLE_CASH_OUT" && !(escrowAmount < 0n && systemAmount > 0n)) fail("bot-only TABLE_CASH_OUT direction is invalid");
  if (candidate?.key_table_id && text(candidate.key_table_id) !== context.table_id) fail("bot-only key-derived table id differs from metadata/ESCROW");
}

export function validateBatch({ candidates, records, cutoff, schemaVersion = EXPORT_SCHEMA_VERSION }) {
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
    if (record?.schema_version !== schemaVersion || record?.record_type !== "chips_transaction") {
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
    if (schemaVersion === BOT_ONLY_EXPORT_SCHEMA_VERSION) validateBotOnlyRecord(candidate, record);

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

export function buildManifest({ target, cutoff, batchSize, cursor, records, archive, outputPath, sourcePolicyId = null, schemaVersion = EXPORT_SCHEMA_VERSION }) {
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
    has_human_participant: record.table_context?.bot_only_proof?.has_human_participant,
    bot_only_proof_eligible: record.table_context?.bot_only_proof?.proof_eligible,
    key_table_id: record.table_context?.bot_only_proof?.table_id_from_key,
    key_format_version: record.table_context?.bot_only_proof?.key_format_version,
    key_format: record.table_context?.bot_only_proof?.key_format,
    table_newest_created_at: record.table_context?.table_identity_summary?.newest_created_at,
    table_identity_count: record.table_context?.table_identity_summary?.identity_count,
    table_eligible_count: record.table_context?.table_identity_summary?.eligible_count,
    table_out_of_scope_keys_sha256: record.table_context?.table_identity_summary?.out_of_scope_keys_sha256,
  })), records, cutoff: null, schemaVersion });
  const first = records[0]?.transaction || null;
  const last = records.at(-1)?.transaction || null;
  const compressionRatio = archive.rawBytes.length === 0
    ? null
    : Number((archive.compressedBytes.length / archive.rawBytes.length).toFixed(6));
  const endCursor = last ? { created_at: last.created_at, id: last.id } : null;
  const registryKeysSha256 = schemaVersion === BOT_ONLY_EXPORT_SCHEMA_VERSION
    ? crypto.createHash("sha256").update(`${records.map((record) => text(record.transaction.idempotency_key)).sort().join("\n")}\n`).digest("hex")
    : null;

  return {
    schema_version: schemaVersion,
    artifact_type: "chips_ledger_archive",
    format: "jsonl.gz",
    target,
    ...(sourcePolicyId == null ? {} : { source_policy_id: sourcePolicyId }),
    ...(schemaVersion === BOT_ONLY_EXPORT_SCHEMA_VERSION ? {
      bot_only: {
        table_id: records[0]?.table_context?.table_id || null,
        table_count: 1,
        newest_created_at: records[0]?.table_context?.table_identity_summary?.newest_created_at || null,
        registry_keys_sha256: registryKeysSha256,
        out_of_scope_keys_sha256: records[0]?.table_context?.table_identity_summary?.out_of_scope_keys_sha256 || null,
        identity_count: records[0]?.table_context?.table_identity_summary?.identity_count == null
          ? null
          : Number(records[0].table_context.table_identity_summary.identity_count),
        eligible_count: records[0]?.table_context?.table_identity_summary?.eligible_count == null
          ? null
          : Number(records[0].table_context.table_identity_summary.eligible_count),
      },
    } : {}),
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

export function maxBatchSizeForTarget(target) {
  if (target === "stage") return MAX_BATCH_SIZE;
  if (target === "prod") return PRODUCTION_MAX_BATCH_SIZE;
  fail("target must be exactly stage or prod");
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

export function resolveTarget(targetValue, env = process.env, { singleTarget = false } = {}) {
  const target = text(targetValue);
  const config = TARGETS[target];
  if (!config) fail("target must be exactly stage or prod");

  const expectedRefs = {};
  const targetEntries = singleTarget
    ? [[target, config]]
    : Object.entries(TARGETS);
  for (const [name, targetConfig] of targetEntries) {
    const expected = text(env[targetConfig.expectedRefEnv] || env[targetConfig.legacyRefEnv]).toLowerCase();
    if (!PROJECT_REF_RE.test(expected)) fail(`${targetConfig.expectedRefEnv} is required and must be a project ref`);
    if (expected !== targetConfig.canonicalRef) fail(`${targetConfig.expectedRefEnv} does not match the versioned canonical ref`);
    expectedRefs[name] = expected;
  }
  if (!singleTarget && expectedRefs.stage === expectedRefs.prod) fail("stage and production project refs must differ");

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

function resolveOptions(args, env, cwd, now, targetOptions = {}) {
  if (!args.output) fail("--output is required; use a private path outside the repository");
  const target = resolveTarget(args.target, env, targetOptions);
  const cutoff = args.cutoff
    ? normalizeTimestamp(args.cutoff, "--cutoff")
    : (() => {
        const days = args.cutoffDays == null ? DEFAULT_CUTOFF_DAYS : parseBoundedInteger(args.cutoffDays, "--cutoff-days", { min: 0, max: 36500 });
        return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
      })();
  const maxBatchSize = maxBatchSizeForTarget(target.target);
  const batchSize = args.batchSize == null
    ? Math.min(DEFAULT_BATCH_SIZE, maxBatchSize)
    : parseBoundedInteger(args.batchSize, "--batch-size", { min: 1, max: maxBatchSize });
  const outputPath = path.resolve(cwd, args.output);
  const manifestPath = path.resolve(cwd, args.manifest || `${outputPath}.manifest.json`);
  if (outputPath === manifestPath) fail("--output and --manifest must be different paths");
  if (fs.existsSync(outputPath)) fail(`refusing to overwrite existing artifact: ${outputPath}`);
  if (fs.existsSync(manifestPath)) fail(`refusing to overwrite existing manifest: ${manifestPath}`);
  return { ...target, cutoff, batchSize, cursor: resolveCursor(args), outputPath, manifestPath };
}

export async function readSnapshot(sql, options) {
  const timestampParam = (value) => value == null || typeof sql.typed !== "function" ? value : sql.typed(value, 25);
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read, read only;");
    const selector = options.selector || "standard";
    const candidateSql = selector === "standard"
      ? CANDIDATE_SQL
      : selector === "prunable"
        ? PRUNABLE_CANDIDATE_SQL
        : selector === "bot-only-7d"
          ? BOT_ONLY_CANDIDATE_SQL
          : fail("snapshot selector must be standard, prunable, or bot-only-7d");
    const candidates = await tx.unsafe(candidateSql, [
      timestampParam(options.cutoff),
      options.batchSize,
      timestampParam(options.cursor?.created_at || null),
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

export async function runExport({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), now = new Date(), deps = {} } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return null;
  }
  const options = resolveOptions(args, env, cwd, now, deps.targetOptions || {});
  const sql = deps.sql || postgres(options.dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 30,
  });

  try {
    const selector = deps.selector || "standard";
    const schemaVersion = deps.schemaVersion || (selector === "bot-only-7d" ? BOT_ONLY_EXPORT_SCHEMA_VERSION : EXPORT_SCHEMA_VERSION);
    const snapshot = await readSnapshot(sql, { ...options, selector });
    if (deps.noCandidateIfEmpty && snapshot.candidates.length === 0) {
      return { noCandidate: true, options };
    }
    const candidateIds = new Set(snapshot.candidates.map((candidate) => text(candidate.id)));
    const entriesByTransaction = groupEntries(snapshot.entries, candidateIds);
    const records = sortRecords(snapshot.candidates.map((candidate) => buildExportRecord(
      candidate,
      entriesByTransaction.get(text(candidate.id)) || [],
      { schemaVersion },
    )));
    validateBatch({ candidates: snapshot.candidates, records, cutoff: options.cutoff, schemaVersion });

    const archive = buildArchiveBytes(records);
    const roundTripRaw = gunzipSync(archive.compressedBytes);
    if (!roundTripRaw.equals(archive.rawBytes)) fail("gzip round-trip verification failed");
    const roundTripRecords = parseJsonl(roundTripRaw.toString("utf8"));
    validateBatch({ candidates: snapshot.candidates, records: roundTripRecords, cutoff: options.cutoff, schemaVersion });
    if (serializeRecords(roundTripRecords) !== archive.rawText) fail("JSONL round-trip verification failed");

    const manifest = buildManifest({
      target: options.target,
      cutoff: options.cutoff,
      batchSize: options.batchSize,
      cursor: options.cursor,
      records,
      archive,
      outputPath: options.outputPath,
      sourcePolicyId: deps.sourcePolicyId || null,
      schemaVersion,
    });
    if (manifest.sha256.compressed_artifact !== crypto.createHash("sha256").update(archive.compressedBytes).digest("hex")) {
      fail("manifest checksum verification failed");
    }
    writeOutput(options, archive, manifest);
    if (deps.emit !== false) outputMetrics(manifest, options);
    return manifest;
  } finally {
    if (!deps.sql) await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runExport().catch((error) => {
    process.stderr.write(`chips-ledger-archive-export failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
