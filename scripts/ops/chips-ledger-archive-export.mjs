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
export const LEGACY_STAGE_ALLOWLIST_POLICY_ID = "legacy_stage_allowlist_v1";
export const BOT_ONLY_EXPORT_SCHEMA_VERSION = 2;
export const BOT_ONLY_RETENTION_DAYS = 7;
export const LEGACY_STAGE_ALLOWLIST_TABLE_COUNT = 974;
export const LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT = 10;
export const LEGACY_STAGE_ALLOWLIST_BATCH_COUNT = Math.ceil(
  LEGACY_STAGE_ALLOWLIST_TABLE_COUNT / LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT,
);
export const LEGACY_STAGE_ALLOWLIST_SOURCE_RUN = "32753223679";
export const LEGACY_STAGE_ALLOWLIST_CUTOFF = "2026-08-17T16:51:28.074Z";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTEGER_RE = /^-?(?:0|[1-9][0-9]*)$/;
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const SQLSTATE_RE = /^[0-9A-Z]{5}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export const LEGACY_STAGE_ALLOWLIST_EVIDENCE_FIELDS = Object.freeze([
  "policy_id",
  "proof_basis",
  "allowlist_sha256",
  "batch_table_ids",
  "batch_table_ids_sha256",
  "master_table_ids",
  "master_table_count",
  "batch_number",
  "batch_table_count",
  "source_run",
  "query_sha256",
  "generator_sha256",
  "stage_system_identifier",
  "master_manifest_sha256",
  "batch_manifest_sha256",
  "freeze_run_id",
  "diagnostic_source_run",
  "diagnostic_source_run_sha256",
]);

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
         lower(nullif(btrim(b.metadata->>'tableId'), '')) as table_id,
         (
           b.metadata ? 'tableId'
           and (
             nullif(btrim(b.metadata->>'tableId'), '') is null
             or nullif(btrim(b.metadata->>'tableId'), '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           )
         ) as invalid_marker
  from base b
  where b.metadata ? 'tableId'
    and (
      nullif(btrim(b.metadata->>'tableId'), '') is not null
      or b.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
    )

  union all

  select b.id,
         case
           when b.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):'
             then lower(nullif(btrim(split_part(b.reference, ':', 2)), ''))
           else null
         end,
         (
           b.reference is not null
           and (
             b.reference !~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):'
             or nullif(btrim(split_part(b.reference, ':', 2)), '') is null
             or nullif(btrim(split_part(b.reference, ':', 2)), '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           )
         )
  from base b
  where b.reference is not null
    and (
      b.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):'
      or b.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
    )

  union all

  select b.id,
         lower(nullif(btrim(substring(a.system_key from 13)), '')),
         false
  from base b
  join public.chips_entries e on e.transaction_id = b.id
  join public.chips_accounts a on a.id = e.account_id
  where a.account_type = 'ESCROW'
    and upper(a.system_key) like 'POKER_TABLE:%'
), marker_summary as (
  select transaction_id,
         array_agg(distinct table_id) filter (where table_id is not null) as table_ids,
         bool_or(invalid_marker or table_id is null or table_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') as invalid_table_marker
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
         lower(nullif(btrim(b.metadata->>'tableId'), '')) as table_id,
         (
           b.metadata ? 'tableId'
           and (
             nullif(btrim(b.metadata->>'tableId'), '') is null
             or nullif(btrim(b.metadata->>'tableId'), '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           )
         ) as invalid_marker
  from base b
  where b.metadata ? 'tableId'
    and (
      nullif(btrim(b.metadata->>'tableId'), '') is not null
      or b.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
    )

  union all

  select b.id,
         case
           when b.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):'
             then lower(nullif(btrim(split_part(b.reference, ':', 2)), ''))
           else null
         end,
         (
           b.reference is not null
           and (
             b.reference !~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):'
             or nullif(btrim(split_part(b.reference, ':', 2)), '') is null
             or nullif(btrim(split_part(b.reference, ':', 2)), '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           )
         )
  from base b
  where b.reference is not null
    and (
      b.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):'
      or b.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
    )

  union all

  select b.id,
         lower(nullif(btrim(substring(a.system_key from 13)), '')),
         false
  from base b
  join public.chips_entries e on e.transaction_id = b.id
  join public.chips_accounts a on a.id = e.account_id
  where a.account_type::text = 'ESCROW'
    and upper(a.system_key) like 'POKER_TABLE:%'
), marker_summary as (
  select transaction_id,
         array_agg(distinct table_id) filter (where table_id is not null) as table_ids,
         bool_or(invalid_marker or table_id is null or table_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') as invalid_table_marker
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
//
// Keep exporter metadata handling aligned with chips_normalize_table_metadata()
// without calling that raising fence function from a diagnostic read.  The
// input-validity check makes malformed legacy strings a row-level fail-closed
// value instead of aborting the whole snapshot.
export const BOT_ONLY_NORMALIZED_TABLE_TRANSACTIONS_CTE = `
table_transaction_metadata as materialized (
  select transactions.*,
         case
           when transactions.metadata is not null
             and pg_catalog.jsonb_typeof(transactions.metadata) = 'object'
             then transactions.metadata
           when transactions.metadata is not null
             and pg_catalog.jsonb_typeof(transactions.metadata) = 'string'
             and pg_catalog.pg_input_is_valid(
               transactions.metadata #>> '{}',
               'jsonb'::text
             )
             then (transactions.metadata #>> '{}')::jsonb
           else null::jsonb
         end as normalized_metadata
    from public.chips_transactions transactions
   where transactions.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
), table_transaction_classification as materialized (
  select metadata.*,
         metadata.normalized_metadata is not null
           and pg_catalog.jsonb_typeof(metadata.normalized_metadata) = 'object'
           as metadata_is_object,
         case
           when metadata.idempotency_key ~ '^join-buyin:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then 'join-buyin'
           when metadata.idempotency_key ~ '^bot-seed-buyin:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then 'bot-seed-buyin'
           when metadata.idempotency_key ~ '^managed-bot-seed-buyin:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then 'managed-bot-seed-buyin'
           when metadata.idempotency_key ~ '^poker:leave:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then 'poker:leave'
           when metadata.idempotency_key ~ '^poker:inactive_cleanup:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then 'poker:inactive_cleanup'
           when metadata.idempotency_key ~ '^poker:rebuy:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then 'poker:rebuy:v1'
           when metadata.idempotency_key ~ '^poker:deferred-leave:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then 'poker:deferred-leave:v1'
           when metadata.idempotency_key ~ '^poker:bot-terminal-cashout:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then 'poker:bot-terminal-cashout:v1'
           when metadata.idempotency_key ~ '^poker:human-terminal-cashout:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then 'poker:human-terminal-cashout:v1'
           when metadata.idempotency_key ~ '^poker:bot-replacement-buyin:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then 'poker:bot-replacement-buyin:v1'
           when metadata.idempotency_key ~ '^poker:managed-bot-top-up:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then 'poker:managed-bot-top-up:v1'
           else null
         end as key_format_from_key
    from table_transaction_metadata metadata
), table_transactions as materialized (
  select classified.*,
         case
           when classified.metadata_is_object
             and classified.normalized_metadata ? 'tableId'
             and nullif(pg_catalog.btrim(classified.normalized_metadata->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
             then pg_catalog.lower(pg_catalog.btrim(classified.normalized_metadata->>'tableId'))
           else null
         end as metadata_table_id,
         case
           when classified.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(:.*)?$'
             then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(classified.reference, ':', 2)))
           else null
         end as reference_table_id
    from table_transaction_classification classified
), registry_rows as materialized (
  select registry.idempotency_key,
         registry.transaction_id,
         registry.payload_hash,
         registry.tx_type,
         registry.user_id,
         registry.transaction_created_at,
         registry.archive_batch_id,
         registry.table_id,
         registry.key_format_version,
         registry.key_format
    from public.chips_transaction_idempotency registry
), unknown_registry_transactions as materialized (
  select registry.idempotency_key,
         registry.transaction_id,
         case
           when registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
             then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 2)))
           when registry.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
             then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 3)))
           when registry.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
             then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 4)))
           else null
         end as key_table_id_from_key,
         transactions.metadata_table_id,
         transactions.reference_table_id
    from registry_rows registry
    join table_transactions transactions on transactions.id = registry.transaction_id
   where registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.table_id is null
), unknown_identity_evidence as (
  select unknown.idempotency_key,
         evidence.table_id
    from unknown_registry_transactions unknown
    cross join lateral (
      values
        (unknown.key_table_id_from_key),
        (unknown.metadata_table_id),
        (unknown.reference_table_id)
    ) evidence(table_id)
   where evidence.table_id is not null

  union all

  select distinct unknown.idempotency_key,
         pg_catalog.lower(pg_catalog.btrim(pg_catalog.substring(accounts.system_key, 13)))
    from unknown_registry_transactions unknown
    join public.chips_entries entries on entries.transaction_id = unknown.transaction_id
    join public.chips_accounts accounts on accounts.id = entries.account_id
   where accounts.account_type::text = 'ESCROW'
     and accounts.system_key ~* '^POKER_TABLE:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
), unknown_target_identity as materialized (
  select distinct evidence.idempotency_key, evidence.table_id
    from unknown_identity_evidence evidence
   where evidence.table_id is not null
)
`;

// Legacy allowlist generation is a fixed historical proof basis. It is
// intentionally separate from BOT_ONLY_CANDIDATE_SQL: the normal seven-day
// policy must continue to reject tables without authoritative proof.
export const LEGACY_STAGE_ALLOWLIST_TABLE_STATS_CTE = `
legacy_registry as materialized (
  select registry.idempotency_key,
         registry.transaction_id,
         registry.payload_hash,
         registry.tx_type,
         registry.user_id,
         registry.transaction_created_at,
         registry.archive_batch_id,
         registry.table_id,
         registry.key_format_version,
         registry.key_format
    from registry_rows registry
   where registry.table_id is not null
     and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
), legacy_entry_shapes as materialized (
  select transactions.id,
         registry.table_id,
         transactions.tx_type::text as tx_type,
         transactions.user_id,
         count(entries.id)::bigint as entry_count,
         count(*) filter (where accounts.account_type::text = 'USER')::bigint as user_entry_count,
         count(*) filter (where accounts.account_type::text = 'SYSTEM')::bigint as system_entry_count,
         count(*) filter (where accounts.account_type::text = 'ESCROW')::bigint as escrow_entry_count,
         count(*) filter (
           where accounts.account_type::text = 'ESCROW'
             and accounts.system_key = 'POKER_TABLE:' || registry.table_id::text
         )::bigint as matching_escrow_count,
         count(*) filter (where accounts.status::text = 'active')::bigint as active_entry_count,
         coalesce(sum(entries.amount), 0)::numeric as net_amount,
         coalesce(sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM'), 0)::numeric as system_amount,
         coalesce(sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW'), 0)::numeric as escrow_amount
    from table_transactions transactions
    join legacy_registry registry
      on registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
     and registry.payload_hash = transactions.payload_hash
     and registry.tx_type = transactions.tx_type
     and registry.user_id is not distinct from transactions.user_id
     and registry.transaction_created_at = transactions.created_at
    left join public.chips_entries entries on entries.transaction_id = transactions.id
    left join public.chips_accounts accounts on accounts.id = entries.account_id
   group by transactions.id, registry.table_id, transactions.tx_type, transactions.user_id
), legacy_marker_issues as materialized (
  select distinct transactions.id, registry.table_id
    from table_transactions transactions
    join legacy_registry registry
      on registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
   where not transactions.metadata_is_object
      or (
        transactions.metadata_is_object
        and transactions.normalized_metadata ? 'tableId'
        and (
          transactions.metadata_table_id is null
          or transactions.metadata_table_id <> registry.table_id::text
        )
      )
      or (
        transactions.reference is not null
        and (
          transactions.reference_table_id is null
          or transactions.reference_table_id <> registry.table_id::text
        )
      )
), legacy_table_stats as materialized (
  select registry.table_id,
         max(registry.transaction_created_at) as newest_created_at,
         count(*)::bigint as identity_count,
         count(*) filter (
           where registry.user_id is null
             and registry.transaction_created_at < $1::timestamptz
             and registry.archive_batch_id is null
         )::bigint as eligible_count,
         count(*) filter (
           where shapes.entry_count = 2
             and shapes.user_id is null
             and shapes.user_entry_count = 0
             and shapes.system_entry_count = 1
             and shapes.escrow_entry_count = 1
             and shapes.matching_escrow_count = 1
             and shapes.active_entry_count = 2
             and shapes.net_amount = 0
             and (
               (shapes.tx_type = 'TABLE_BUY_IN'
                and shapes.system_amount < 0
                and shapes.escrow_amount > 0)
               or
               (shapes.tx_type = 'TABLE_CASH_OUT'
                and shapes.escrow_amount < 0
                and shapes.system_amount > 0)
             )
         )::bigint as valid_entry_transaction_count,
         count(*) filter (where markers.id is not null)::bigint as marker_issue_transaction_count
    from legacy_registry registry
    left join legacy_entry_shapes shapes
      on shapes.id = registry.transaction_id
     and shapes.table_id = registry.table_id
    left join legacy_marker_issues markers
      on markers.id = registry.transaction_id
     and markers.table_id = registry.table_id
   group by registry.table_id
)
`;

export const LEGACY_STAGE_ALLOWLIST_GENERATOR_SQL = `
with ${BOT_ONLY_NORMALIZED_TABLE_TRANSACTIONS_CTE}, ${LEGACY_STAGE_ALLOWLIST_TABLE_STATS_CTE}, eligible_tables as (
  select stats.table_id,
         stats.newest_created_at,
         stats.identity_count,
         stats.eligible_count,
         stats.valid_entry_transaction_count,
         stats.marker_issue_transaction_count
    from legacy_table_stats stats
    join public.poker_tables tables on tables.id = stats.table_id
    join public.chips_accounts escrow
      on escrow.account_type::text = 'ESCROW'
     and escrow.system_key = 'POKER_TABLE:' || stats.table_id::text
   where tables.status::text = 'CLOSED'
     and tables.has_human_participant is false
     and tables.bot_only_proof_eligible is not true
     and escrow.status::text = 'active'
     and escrow.balance = 0
     and stats.newest_created_at < $1::timestamptz
     and stats.identity_count > 0
     and stats.eligible_count = stats.identity_count
     and stats.valid_entry_transaction_count = stats.identity_count
     and stats.marker_issue_transaction_count = 0
)
select table_id::text as table_id,
       newest_created_at::text as newest_created_at,
       identity_count::text as identity_count,
       eligible_count::text as eligible_count
  from eligible_tables
 order by table_id asc;
`;

export const LEGACY_STAGE_ALLOWLIST_CANDIDATE_SQL = `
with ${BOT_ONLY_NORMALIZED_TABLE_TRANSACTIONS_CTE}, ${LEGACY_STAGE_ALLOWLIST_TABLE_STATS_CTE}, selected_table_ids as materialized (
  select table_id
    from pg_catalog.unnest($2::uuid[]) as selected(table_id)
), candidate_table_rows as materialized (
  select stats.table_id,
         stats.newest_created_at,
         stats.identity_count,
         stats.eligible_count
    from legacy_table_stats stats
    join selected_table_ids selected on selected.table_id = stats.table_id
    join public.poker_tables tables on tables.id = stats.table_id
    join public.chips_accounts escrow
      on escrow.account_type::text = 'ESCROW'
     and escrow.system_key = 'POKER_TABLE:' || stats.table_id::text
   where tables.status::text = 'CLOSED'
     and tables.has_human_participant is false
     and tables.bot_only_proof_eligible is not true
     and escrow.status::text = 'active'
     and escrow.balance = 0
     and stats.newest_created_at < $1::timestamptz
     and stats.identity_count > 0
     and stats.eligible_count = stats.identity_count
     and stats.valid_entry_transaction_count = stats.identity_count
     and stats.marker_issue_transaction_count = 0
), candidate_transactions as materialized (
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
         stats.newest_created_at as table_newest_created_at,
         stats.identity_count as table_identity_count,
         stats.eligible_count as table_eligible_count
    from table_transactions transactions
    join legacy_registry registry
      on registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
     and registry.payload_hash = transactions.payload_hash
     and registry.tx_type = transactions.tx_type
     and registry.user_id is not distinct from transactions.user_id
     and registry.transaction_created_at = transactions.created_at
     and registry.archive_batch_id is null
    join candidate_table_rows stats on stats.table_id = registry.table_id
   where transactions.created_at < $1::timestamptz
     and transactions.user_id is null
     and transactions.metadata_is_object
     and (
       not (transactions.normalized_metadata ? 'tableId')
       or transactions.metadata_table_id = registry.table_id::text
     )
     and (
       transactions.reference is null
       or transactions.reference_table_id = registry.table_id::text
     )
), candidate_entry_shapes as materialized (
  select transactions.id,
         transactions.idempotency_key,
         transactions.tx_type::text as tx_type,
         transactions.key_table_id,
         count(entries.id)::bigint as entry_count
    from candidate_transactions transactions
    join public.chips_entries entries on entries.transaction_id = transactions.id
    join public.chips_accounts accounts on accounts.id = entries.account_id
   group by transactions.id, transactions.idempotency_key, transactions.tx_type, transactions.key_table_id
  having count(*) = 2
     and count(*) filter (where accounts.account_type::text = 'USER') = 0
     and count(*) filter (where accounts.account_type::text = 'SYSTEM') = 1
     and count(*) filter (where accounts.account_type::text = 'ESCROW') = 1
     and count(*) filter (
       where accounts.account_type::text = 'ESCROW'
         and accounts.system_key = 'POKER_TABLE:' || transactions.key_table_id::text
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
         transactions.key_table_id,
         transactions.key_format_version,
         transactions.key_format,
         tables.status::text as table_status,
         tables.has_human_participant,
         tables.bot_only_proof_eligible,
         escrow.id::text as escrow_account_id,
         escrow.status::text as escrow_status,
         escrow.balance::text as escrow_balance,
         transactions.table_newest_created_at,
         transactions.table_identity_count,
         transactions.table_eligible_count,
         shapes.entry_count
    from candidate_transactions transactions
    join candidate_entry_shapes shapes
      on shapes.id = transactions.id
     and shapes.idempotency_key = transactions.idempotency_key
    join candidate_table_rows stats on stats.table_id = transactions.key_table_id
    join public.poker_tables tables on tables.id = transactions.key_table_id
    join public.chips_accounts escrow
      on escrow.account_type::text = 'ESCROW'
     and escrow.system_key = 'POKER_TABLE:' || transactions.key_table_id::text
), batch_gate as materialized (
  select count(distinct eligible.key_table_id)::bigint as table_count,
         count(*)::bigint as transaction_count
    from eligible_transactions eligible
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
       eligible.key_table_id::text as key_table_id,
       eligible.key_format_version,
       eligible.key_format,
       eligible.table_newest_created_at::text,
       eligible.table_identity_count,
       eligible.table_eligible_count,
       $4::text as legacy_allowlist_sha256,
       $5::text as legacy_batch_table_ids_sha256,
       $6::text as legacy_source_run,
       $7::text as legacy_query_sha256,
       $8::text as legacy_stage_system_identifier,
       $9::bigint as legacy_master_table_count,
       $10::bigint as legacy_batch_number,
       $11::bigint as legacy_batch_table_count
  from eligible_transactions eligible
 cross join batch_gate gate
 where gate.table_count = pg_catalog.cardinality($2::uuid[])
   and gate.table_count > 0
   and gate.table_count <= $12::int
   and gate.transaction_count > 0
   and gate.transaction_count <= $3::int
 order by eligible.created_at asc, eligible.id asc;
`;

export const BOT_ONLY_CANDIDATE_SQL = `
with ${BOT_ONLY_NORMALIZED_TABLE_TRANSACTIONS_CTE}, table_rows as materialized (
  select registry.table_id,
         max(registry.transaction_created_at) as newest_created_at,
         count(*)::bigint as identity_count,
         count(*) filter (
           where registry.user_id is null
             and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
             and registry.transaction_created_at < $1::timestamptz
             and registry.archive_batch_id is null
         )::bigint as eligible_count
    from registry_rows registry
   where registry.table_id is not null
   group by registry.table_id
), candidate_table_rows as materialized (
  select stats.table_id,
         stats.newest_created_at,
         stats.identity_count,
         stats.eligible_count
    from table_rows stats
    join public.poker_tables tables on tables.id = stats.table_id
    join public.chips_accounts escrow
      on escrow.account_type::text = 'ESCROW'
     and escrow.system_key = 'POKER_TABLE:' || stats.table_id::text
   where tables.status::text = 'CLOSED'
     and tables.has_human_participant is false
     and tables.bot_only_proof_eligible is true
     and escrow.status::text = 'active'
     and escrow.balance = 0
     and stats.newest_created_at < $1::timestamptz
     and stats.eligible_count > 0
     and stats.eligible_count <= $2::int
     and stats.eligible_count = stats.identity_count
     and not exists (
       select 1
         from unknown_target_identity unknown
        where unknown.table_id = stats.table_id::text
     )
), candidate_transactions as materialized (
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
         registry.key_format
    from table_transactions transactions
    join registry_rows registry
      on registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
     and registry.payload_hash = transactions.payload_hash
     and registry.tx_type = transactions.tx_type
     and registry.user_id is not distinct from transactions.user_id
     and registry.transaction_created_at = transactions.created_at
     and registry.table_id is not null
     and registry.key_format_version = 1
     and registry.key_format is not null
     and registry.key_format = transactions.key_format_from_key
     and registry.archive_batch_id is null
    join candidate_table_rows candidate_tables
      on candidate_tables.table_id = registry.table_id
   where (
       $3::timestamptz is null
       or transactions.created_at > $3::timestamptz
       or (transactions.created_at = $3::timestamptz and transactions.id > $4::uuid)
     )
     and transactions.created_at < $1::timestamptz
     and transactions.user_id is null
     and transactions.metadata_is_object
     and (
       not (transactions.normalized_metadata ? 'tableId')
       or transactions.metadata_table_id = registry.table_id::text
     )
     and (
       transactions.reference is null
       or transactions.reference_table_id = registry.table_id::text
     )
), candidate_entry_shapes as materialized (
  select transactions.id,
         transactions.idempotency_key,
         transactions.tx_type::text as tx_type,
         transactions.key_table_id,
         count(entries.id)::text as entry_count
    from candidate_transactions transactions
    join public.chips_entries entries on entries.transaction_id = transactions.id
    join public.chips_accounts accounts on accounts.id = entries.account_id
   group by transactions.id, transactions.idempotency_key, transactions.tx_type, transactions.key_table_id
  having count(*) = 2
     and count(*) filter (where accounts.account_type::text = 'USER') = 0
     and count(*) filter (where accounts.account_type::text = 'SYSTEM') = 1
     and count(*) filter (where accounts.account_type::text = 'ESCROW') = 1
     and count(*) filter (
       where accounts.account_type::text = 'ESCROW'
         and accounts.system_key = 'POKER_TABLE:' || transactions.key_table_id::text
     ) = 1
     and bool_and(accounts.status::text = 'active')
     and sum(entries.amount) = 0
     and (
       (
         transactions.tx_type::text = 'TABLE_BUY_IN'
         and sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM') < 0
         and sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW') > 0
       )
       or
       (
         transactions.tx_type::text = 'TABLE_CASH_OUT'
         and sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW') < 0
         and sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM') > 0
       )
     )
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
         transactions.key_table_id,
         transactions.key_format_version,
         transactions.key_format,
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
         shapes.entry_count
    from candidate_transactions transactions
    join candidate_entry_shapes shapes
      on shapes.id = transactions.id
     and shapes.idempotency_key = transactions.idempotency_key
    join candidate_table_rows stats on stats.table_id = transactions.key_table_id
    join public.poker_tables tables on tables.id = transactions.key_table_id
    join public.chips_accounts escrow
      on escrow.account_type::text = 'ESCROW'
     and escrow.system_key = 'POKER_TABLE:' || transactions.key_table_id::text
), selected_table as (
  select key_table_id
    from eligible_transactions
   group by key_table_id
   having count(*) = max(table_eligible_count)
   order by key_table_id
   limit 1
), selected_table_evidence as materialized (
  select selected.key_table_id,
         public.chips_archive_text_ids_sha256(
           coalesce(array_agg(registry.idempotency_key order by registry.idempotency_key)
             filter (where registry.user_id is not null), array[]::text[])
         ) as table_out_of_scope_keys_sha256
    from selected_table selected
    join registry_rows registry on registry.table_id = selected.key_table_id
   group by selected.key_table_id
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
       evidence.table_out_of_scope_keys_sha256
  from eligible_transactions eligible
  join selected_table on selected_table.key_table_id = eligible.key_table_id
  join selected_table_evidence evidence on evidence.key_table_id = eligible.key_table_id
 order by eligible.created_at asc, eligible.id asc
 limit $2::int;
`;

// A no-candidate result is not necessarily an empty database.  Keep the
// diagnostic read-only and separate from the candidate selector so prepare-only
// can explain which fail-closed condition prevented selection without relaxing
// the selector itself.
export const BOT_ONLY_BLOCKING_ANOMALY_SQL = `
with ${BOT_ONLY_NORMALIZED_TABLE_TRANSACTIONS_CTE}, unknown_identity_counts as (
  select unknown.table_id,
         count(distinct unknown.idempotency_key)::bigint as unknown_identity_count
    from unknown_target_identity unknown
   group by unknown.table_id
), table_rows as materialized (
  select registry.table_id,
         max(registry.transaction_created_at) as newest_created_at,
         count(*)::bigint as identity_count,
         count(*) filter (
           where registry.user_id is null
             and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
             and registry.transaction_created_at < $1::timestamptz
             and registry.archive_batch_id is null
         )::bigint as eligible_count,
         coalesce(unknown.unknown_identity_count, 0)::bigint as unknown_identity_count
    from registry_rows registry
    left join unknown_identity_counts unknown
      on unknown.table_id = registry.table_id::text
   where registry.table_id is not null
   group by registry.table_id, unknown.unknown_identity_count
), table_context as (
  select stats.table_id,
         stats.newest_created_at,
         stats.identity_count,
         stats.eligible_count,
         stats.unknown_identity_count,
         tables.status::text as table_status,
         tables.has_human_participant,
         tables.bot_only_proof_eligible,
         escrow.id as escrow_account_id,
         escrow.status::text as escrow_status,
         escrow.balance as escrow_balance
    from table_rows stats
    left join public.poker_tables tables on tables.id = stats.table_id
    left join public.chips_accounts escrow
      on escrow.account_type::text = 'ESCROW'
     and escrow.system_key = 'POKER_TABLE:' || stats.table_id::text
), marker_issues as (
  select transactions.id,
         registry.table_id
    from table_transactions transactions
    left join registry_rows registry
      on registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
   where not transactions.metadata_is_object
      or (
        transactions.metadata_is_object
        and transactions.normalized_metadata ? 'tableId'
        and (
          transactions.metadata_table_id is null
          or (
            registry.table_id is not null
            and transactions.metadata_table_id <> registry.table_id::text
          )
        )
      )
      or (
        transactions.reference is not null
        and (
          transactions.reference_table_id is null
          or (
            registry.table_id is not null
            and transactions.reference_table_id <> registry.table_id::text
          )
        )
      )
), entry_shapes as materialized (
  select transactions.id,
         registry.table_id,
         transactions.tx_type::text as tx_type,
         transactions.user_id,
         count(entries.id)::bigint as entry_count,
         count(*) filter (where accounts.account_type::text = 'USER')::bigint as user_entry_count,
         count(*) filter (where accounts.account_type::text = 'SYSTEM')::bigint as system_entry_count,
         count(*) filter (where accounts.account_type::text = 'ESCROW')::bigint as escrow_entry_count,
         count(*) filter (
           where accounts.account_type::text = 'ESCROW'
             and accounts.system_key = 'POKER_TABLE:' || registry.table_id::text
         )::bigint as matching_escrow_count,
         count(*) filter (where accounts.status::text = 'active')::bigint as active_entry_count,
         coalesce(sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM'), 0)::numeric as system_amount,
         coalesce(sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW'), 0)::numeric as escrow_amount,
         coalesce(sum(entries.amount), 0)::numeric as net_amount
    from table_transactions transactions
    left join registry_rows registry
      on registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
    left join public.chips_entries entries on entries.transaction_id = transactions.id
    left join public.chips_accounts accounts on accounts.id = entries.account_id
   group by transactions.id, registry.table_id, transactions.tx_type, transactions.user_id
), blockers as (
  select 'unknown_table_identity'::text as blocker_code,
         count(*)::bigint as transaction_count,
         0::bigint as table_count
    from registry_rows registry
   where registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.table_id is null

  union all

  select 'missing_registry_identity',
         count(*)::bigint,
         0::bigint
    from table_transactions transactions
    left join registry_rows registry
      on registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
   where registry.idempotency_key is null

  union all

  select 'invalid_marker',
         count(distinct marker_issues.id)::bigint,
         count(distinct marker_issues.table_id)::bigint
    from marker_issues

  union all

  select 'deferred_entry_binding',
         count(*)::bigint,
         count(distinct entry_shapes.table_id)::bigint
    from entry_shapes
   where entry_shapes.user_id is null
     and (
       entry_shapes.entry_count <> 2
      or entry_shapes.user_entry_count <> 0
      or entry_shapes.system_entry_count <> 1
      or entry_shapes.escrow_entry_count <> 1
      or entry_shapes.matching_escrow_count <> 1
      or entry_shapes.active_entry_count <> 2
      or entry_shapes.net_amount <> 0
      or (
        entry_shapes.tx_type = 'TABLE_BUY_IN'
        and (entry_shapes.system_amount >= 0 or entry_shapes.escrow_amount <= 0)
      )
      or (
        entry_shapes.tx_type = 'TABLE_CASH_OUT'
        and (entry_shapes.escrow_amount >= 0 or entry_shapes.system_amount <= 0)
      )
     )

  union all

  select 'younger_table_identity',
         coalesce(sum(context.identity_count), 0)::bigint,
         count(*)::bigint
    from table_context context
   where context.newest_created_at >= $1::timestamptz

  union all

  select 'human_participant',
         coalesce(sum(context.identity_count), 0)::bigint,
         count(*)::bigint
    from table_context context
   where context.has_human_participant is true

  union all

  select 'human_participant_unknown',
         coalesce(sum(context.identity_count), 0)::bigint,
         count(*)::bigint
    from table_context context
   where context.has_human_participant is null

  union all

  select 'historically_uncertain',
         coalesce(sum(context.identity_count), 0)::bigint,
         count(*)::bigint
    from table_context context
   where context.bot_only_proof_eligible is not true

  union all

  select 'table_not_closed',
         coalesce(sum(context.identity_count), 0)::bigint,
         count(*)::bigint
    from table_context context
   where context.table_status is null
      or upper(context.table_status) <> 'CLOSED'

  union all

  select 'escrow_not_active_or_zero',
         coalesce(sum(context.identity_count), 0)::bigint,
         count(*)::bigint
    from table_context context
   where context.escrow_account_id is null
      or context.escrow_status <> 'active'
      or context.escrow_balance <> 0

  union all

  select 'identity_set_incomplete',
         coalesce(sum(context.identity_count + context.unknown_identity_count), 0)::bigint,
         count(*)::bigint
    from table_context context
   where context.unknown_identity_count > 0
      or context.eligible_count <> context.identity_count

  union all

  select 'no_eligible_identity',
         coalesce(sum(context.identity_count), 0)::bigint,
         count(*)::bigint
    from table_context context
   where context.eligible_count = 0

  union all

  select 'batch_over_capacity',
         coalesce(sum(context.eligible_count), 0)::bigint,
         count(*)::bigint
    from table_context context
   where context.eligible_count > $2::int
)
select blocker_code,
       transaction_count::text,
       table_count::text
  from blockers
 where transaction_count > 0 or table_count > 0
 order by blocker_code;
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

function normalizeBlockingAnomalies(rows) {
  return (rows || []).map((row) => ({
    code: text(row.blocker_code),
    transaction_count: toBigIntString(row.transaction_count, "blocking anomaly transaction_count"),
    table_count: toBigIntString(row.table_count, "blocking anomaly table_count"),
  }));
}

function sqlState(error) {
  const value = text(error?.code || error?.sqlState || error?.sqlstate).toUpperCase();
  return SQLSTATE_RE.test(value) ? value : null;
}

function sqlSha256(query) {
  return crypto.createHash("sha256").update(query).digest("hex");
}

function emitQueryTelemetry(telemetry, event) {
  const payload = {
    event: "chips_ledger_query",
    phase: event.phase,
    query_name: event.queryName,
    sql_sha256: sqlSha256(event.query),
    elapsed_ms: event.elapsedMs,
    sqlstate: event.sqlstate,
    read_only: true,
  };
  if (typeof telemetry === "function") {
    telemetry(payload);
    return;
  }
  process.stderr.write(`${stringifyJson(payload)}\n`);
}

async function observedQuery(tx, { phase, queryName, query, parameters = [], telemetry }) {
  const startedAt = process.hrtime.bigint();
  try {
    const rows = await tx.unsafe(query, parameters);
    emitQueryTelemetry(telemetry, {
      phase,
      queryName,
      query,
      elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      sqlstate: "00000",
    });
    return rows;
  } catch (error) {
    const phaseError = error instanceof Error ? error : new Error(text(error));
    phaseError.chipsLedgerQueryPhase = phase;
    phaseError.chipsLedgerQueryName = queryName;
    phaseError.chipsLedgerQuerySqlState = sqlState(error);
    emitQueryTelemetry(telemetry, {
      phase,
      queryName,
      query,
      elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      sqlstate: phaseError.chipsLedgerQuerySqlState,
    });
    throw phaseError;
  }
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
    if (candidate.legacy_allowlist_sha256) {
      context.legacy_stage_allowlist = {
        policy_id: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
        allowlist_sha256: text(candidate.legacy_allowlist_sha256),
        batch_table_ids_sha256: text(candidate.legacy_batch_table_ids_sha256),
        source_run: text(candidate.legacy_source_run),
        query_sha256: text(candidate.legacy_query_sha256),
        stage_system_identifier: text(candidate.legacy_stage_system_identifier),
        master_table_count: Number(candidate.legacy_master_table_count),
        batch_number: Number(candidate.legacy_batch_number),
        batch_table_count: Number(candidate.legacy_batch_table_count),
      };
    }
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

function validateLegacyStageAllowlistRecord(candidate, record) {
  const transaction = record?.transaction;
  const context = record?.table_context;
  const proof = context?.legacy_stage_allowlist;
  if (transaction?.tx_type !== "TABLE_BUY_IN" && transaction?.tx_type !== "TABLE_CASH_OUT") fail("legacy allowlist archive contains a non-TABLE transaction");
  if (transaction.user_id != null || candidate?.has_human_participant !== false) fail("legacy allowlist archive contains human evidence");
  if (!context || context.table_exists !== true || context.table_status !== "CLOSED"
    || !context.escrow_account_id || context.escrow_status !== "active" || context.escrow_balance !== "0") {
    fail("legacy allowlist table lifecycle evidence is incomplete");
  }
  if (candidate?.bot_only_proof_eligible === true) fail("legacy allowlist archive unexpectedly contains an authoritative bot-only table");
  if (!proof || proof.policy_id !== LEGACY_STAGE_ALLOWLIST_POLICY_ID
    || !/^[0-9a-f]{64}$/.test(proof.allowlist_sha256)
    || !/^[0-9a-f]{64}$/.test(proof.batch_table_ids_sha256)
    || !/^[0-9a-f]{64}$/.test(proof.query_sha256)
    || proof.source_run !== LEGACY_STAGE_ALLOWLIST_SOURCE_RUN
    || proof.stage_system_identifier !== "7656985631720456337"
    || proof.master_table_count !== LEGACY_STAGE_ALLOWLIST_TABLE_COUNT
    || proof.batch_number < 1
    || proof.batch_table_count < 1
    || proof.batch_table_count > LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT) {
    fail("legacy allowlist proof basis is incomplete");
  }
  const tableEntries = record.entries || [];
  if (tableEntries.length !== 2 || tableEntries.some((entry) => entry.account?.account_type === "USER")) fail("legacy allowlist archive entry shape contains a USER entry");
  const escrowEntries = tableEntries.filter((entry) => entry.account?.account_type === "ESCROW");
  const systemEntries = tableEntries.filter((entry) => entry.account?.account_type === "SYSTEM");
  if (escrowEntries.length !== 1 || systemEntries.length !== 1 || escrowEntries[0].account.system_key !== `POKER_TABLE:${context.table_id}`) {
    fail("legacy allowlist archive ESCROW binding is incomplete");
  }
  const escrowAmount = BigInt(escrowEntries[0].amount);
  const systemAmount = BigInt(systemEntries[0].amount);
  if (transaction.tx_type === "TABLE_BUY_IN" && !(escrowAmount > 0n && systemAmount < 0n)) fail("legacy TABLE_BUY_IN direction is invalid");
  if (transaction.tx_type === "TABLE_CASH_OUT" && !(escrowAmount < 0n && systemAmount > 0n)) fail("legacy TABLE_CASH_OUT direction is invalid");
}

export function validateBatch({ candidates, records, cutoff, schemaVersion = EXPORT_SCHEMA_VERSION, sourcePolicyId = null }) {
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
    if (schemaVersion === BOT_ONLY_EXPORT_SCHEMA_VERSION) {
      if (sourcePolicyId === LEGACY_STAGE_ALLOWLIST_POLICY_ID || record?.table_context?.legacy_stage_allowlist) {
        validateLegacyStageAllowlistRecord(candidate, record);
      } else {
        validateBotOnlyRecord(candidate, record);
      }
    }

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

function normalizeLegacyStageAllowlistManifest(legacyStageAllowlist) {
  if (!legacyStageAllowlist || typeof legacyStageAllowlist !== "object" || Array.isArray(legacyStageAllowlist)) {
    fail("legacy Stage allowlist archive manifest evidence is missing");
  }
  const required = [
    "policy_id",
    "proof_basis",
    "allowlist_sha256",
    "batch_table_ids",
    "batch_table_ids_sha256",
    "master_table_ids",
    "master_table_count",
    "batch_number",
    "batch_table_count",
    "source_run",
    "query_sha256",
    "generator_sha256",
    "stage_system_identifier",
    "master_manifest_sha256",
    "batch_manifest_sha256",
  ];
  if (required.some((key) => !Object.hasOwn(legacyStageAllowlist, key))) {
    fail("legacy Stage allowlist archive manifest evidence is incomplete");
  }
  if (!Array.isArray(legacyStageAllowlist.master_table_ids)
    || !Array.isArray(legacyStageAllowlist.batch_table_ids)) {
    fail("legacy Stage allowlist archive manifest table IDs are incomplete");
  }
  return {
    ...legacyStageAllowlist,
    master_table_ids: legacyStageAllowlist.master_table_ids.map((id) => text(id).toLowerCase()),
    batch_table_ids: legacyStageAllowlist.batch_table_ids.map((id) => text(id).toLowerCase()),
  };
}

function canonicalEvidenceJson(value) {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonicalEvidenceJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalEvidenceJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function evidenceType(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function evidenceSha256(value) {
  return crypto.createHash("sha256").update(canonicalEvidenceJson(value), "utf8").digest("hex");
}

export function diagnoseLegacyStageAllowlistEvidence(actual, expected) {
  const actualObject = actual && typeof actual === "object" && !Array.isArray(actual) ? actual : null;
  const expectedObject = expected && typeof expected === "object" && !Array.isArray(expected) ? expected : null;
  const fieldNames = [
    ...LEGACY_STAGE_ALLOWLIST_EVIDENCE_FIELDS,
    ...(expectedObject ? Object.keys(expectedObject).filter((field) => !LEGACY_STAGE_ALLOWLIST_EVIDENCE_FIELDS.includes(field)).sort() : []),
  ];
  const fields = fieldNames.map((field) => {
    const actualExists = actualObject !== null && Object.hasOwn(actualObject, field);
    const expectedExists = expectedObject !== null && Object.hasOwn(expectedObject, field);
    return {
      field,
      exists: actualExists,
      type: evidenceType(actualObject?.[field]),
      matches: actualExists === expectedExists
        && (!expectedExists || canonicalEvidenceJson(actualObject[field]) === canonicalEvidenceJson(expectedObject[field])),
    };
  });
  const knownFields = new Set(LEGACY_STAGE_ALLOWLIST_EVIDENCE_FIELDS);
  if (actualObject !== null) {
    for (const field of Object.keys(actualObject).sort()) {
      if (!knownFields.has(field)) {
        fields.push({ field, exists: true, type: evidenceType(actualObject[field]), matches: false });
      }
    }
  }
  return {
    matches: actualObject !== null
      && expectedObject !== null
      && fields.every((field) => field.matches),
    fields,
    actualSha256: evidenceSha256(actual),
    expectedSha256: evidenceSha256(expected),
  };
}

export function assertLegacyStageAllowlistEvidence(actual, expected) {
  const diagnosis = diagnoseLegacyStageAllowlistEvidence(actual, expected);
  if (!diagnosis.matches) {
    const firstFailure = diagnosis.fields.find((field) => !field.matches);
    fail(`legacy Stage allowlist manifest evidence is incomplete: ${firstFailure?.field || "object"}`);
  }
  return diagnosis;
}

export function buildManifest({ target, cutoff, batchSize, cursor, records, archive, outputPath, sourcePolicyId = null, schemaVersion = EXPORT_SCHEMA_VERSION, legacyStageAllowlist = null }) {
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
    legacy_allowlist_sha256: record.table_context?.legacy_stage_allowlist?.allowlist_sha256,
    legacy_batch_table_ids_sha256: record.table_context?.legacy_stage_allowlist?.batch_table_ids_sha256,
    legacy_source_run: record.table_context?.legacy_stage_allowlist?.source_run,
    legacy_query_sha256: record.table_context?.legacy_stage_allowlist?.query_sha256,
    legacy_stage_system_identifier: record.table_context?.legacy_stage_allowlist?.stage_system_identifier,
    legacy_master_table_count: record.table_context?.legacy_stage_allowlist?.master_table_count,
    legacy_batch_number: record.table_context?.legacy_stage_allowlist?.batch_number,
    legacy_batch_table_count: record.table_context?.legacy_stage_allowlist?.batch_table_count,
  })), records, cutoff: null, schemaVersion, sourcePolicyId });
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
    ...(schemaVersion === BOT_ONLY_EXPORT_SCHEMA_VERSION && sourcePolicyId === BOT_ONLY_RETENTION_POLICY_ID ? {
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
    ...(schemaVersion === BOT_ONLY_EXPORT_SCHEMA_VERSION && sourcePolicyId === LEGACY_STAGE_ALLOWLIST_POLICY_ID ? {
      legacy_stage_allowlist: normalizeLegacyStageAllowlistManifest(legacyStageAllowlist),
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

function hashCanonicalLegacyIds(ids) {
  return crypto.createHash("sha256").update(`${ids.join("\n")}\n`, "utf8").digest("hex");
}

function canonicalLegacyPlanIds(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} is missing from the immutable plan`);
  const ids = value.map((id) => text(id));
  if (ids.some((id) => !UUID_RE.test(id) || id !== id.toLowerCase())) fail(`${label} contains a non-canonical UUID`);
  if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && ids[index - 1] >= id)) {
    fail(`${label} is not a canonical UUID list`);
  }
  return ids;
}

function sameLegacyIdList(left, right, label) {
  if (!Array.isArray(left) || !Array.isArray(right)
    || left.length !== right.length
    || left.some((value, index) => value !== right[index])) {
    fail(`${label} is not bound to the immutable legacy plan`);
  }
}

function assertLegacyStageAllowlistPlan(plan, cutoff) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    fail("legacy-stage-allowlist-v1 requires an immutable plan");
  }
  const required = [
    "masterManifest",
    "batchManifest",
    "archiveManifest",
    "masterTableIds",
    "batchTableIds",
    "allowlistSha256",
    "batchTableIdsSha256",
    "sourceRun",
    "querySha256",
    "stageSystemIdentifier",
    "masterTableCount",
    "batchNumber",
    "batchTableCount",
    "masterManifestSha256",
    "batchManifestSha256",
  ];
  if (required.some((key) => !Object.hasOwn(plan, key))) {
    fail("legacy-stage-allowlist-v1 requires the full immutable plan");
  }

  const master = plan.masterManifest;
  const batch = plan.batchManifest;
  const archive = plan.archiveManifest;
  if (!master || typeof master !== "object" || !batch || typeof batch !== "object"
    || !archive || typeof archive !== "object") {
    fail("legacy-stage-allowlist-v1 immutable plan manifests are incomplete");
  }

  const masterTableIds = canonicalLegacyPlanIds(plan.masterTableIds, "immutable master table IDs");
  const batchTableIds = canonicalLegacyPlanIds(plan.batchTableIds, "immutable batch table IDs");
  sameLegacyIdList(masterTableIds, master.table_ids, "master table IDs");
  sameLegacyIdList(batchTableIds, batch.batch_table_ids, "batch table IDs");
  sameLegacyIdList(masterTableIds, archive.master_table_ids, "archive master table IDs");
  sameLegacyIdList(batchTableIds, archive.batch_table_ids, "archive batch table IDs");

  if (masterTableIds.length !== LEGACY_STAGE_ALLOWLIST_TABLE_COUNT
    || batchTableIds.length < 1
    || batchTableIds.length > LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT
    || !Number.isSafeInteger(plan.batchNumber)
    || plan.batchNumber < 1
    || plan.batchNumber > LEGACY_STAGE_ALLOWLIST_BATCH_COUNT
    || plan.masterTableCount !== master.table_count
    || plan.batchNumber !== batch.batch_number
    || plan.batchTableCount !== batch.batch_table_count
    || plan.batchTableCount !== batchTableIds.length
    || plan.allowlistSha256 !== master.allowlist_sha256
    || plan.batchTableIdsSha256 !== batch.batch_table_ids_sha256
    || plan.masterManifestSha256 !== master.manifest_sha256
    || plan.batchManifestSha256 !== batch.manifest_sha256
    || plan.allowlistSha256 !== hashCanonicalLegacyIds(masterTableIds)
    || plan.batchTableIdsSha256 !== hashCanonicalLegacyIds(batchTableIds)) {
    fail("legacy-stage-allowlist-v1 immutable plan hash or count binding is invalid");
  }
  if (plan.sourceRun !== master.source_run
    || plan.querySha256 !== master.query_sha256
    || plan.stageSystemIdentifier !== master.stage_system_identifier
    || plan.cutoff !== batch.cutoff) {
    fail("legacy-stage-allowlist-v1 immutable plan evidence is inconsistent");
  }
  if (text(cutoff) !== text(plan.cutoff)) fail("legacy-stage-allowlist-v1 cutoff is not bound to the immutable plan");

  const archiveBindings = [
    [archive.policy_id, LEGACY_STAGE_ALLOWLIST_POLICY_ID, "archive policy"],
    [archive.proof_basis, LEGACY_STAGE_ALLOWLIST_POLICY_ID, "archive proof basis"],
    [archive.allowlist_sha256, plan.allowlistSha256, "archive allowlist hash"],
    [archive.batch_table_ids_sha256, plan.batchTableIdsSha256, "archive batch hash"],
    [archive.source_run, plan.sourceRun, "archive source run"],
    [archive.query_sha256, plan.querySha256, "archive query hash"],
    [archive.stage_system_identifier, plan.stageSystemIdentifier, "archive Stage identity"],
    [archive.master_table_count, plan.masterTableCount, "archive master count"],
    [archive.batch_number, plan.batchNumber, "archive batch number"],
    [archive.batch_table_count, plan.batchTableCount, "archive batch count"],
    [archive.master_manifest_sha256, plan.masterManifestSha256, "archive master manifest hash"],
    [archive.batch_manifest_sha256, plan.batchManifestSha256, "archive batch manifest hash"],
  ];
  if (archiveBindings.some(([actual, expected]) => actual !== expected)) {
    fail("legacy-stage-allowlist-v1 archive manifest is not bound to the immutable plan");
  }
  if (!SHA256_RE.test(plan.allowlistSha256)
    || !SHA256_RE.test(plan.batchTableIdsSha256)
    || !SHA256_RE.test(plan.querySha256)
    || !SHA256_RE.test(plan.masterManifestSha256)
    || !SHA256_RE.test(plan.batchManifestSha256)) {
    fail("legacy-stage-allowlist-v1 immutable plan contains an invalid hash");
  }
  return plan;
}

export async function readSnapshot(sql, options) {
  const timestampParam = (value) => value == null || typeof sql.typed !== "function" ? value : sql.typed(value, 25);
  const telemetry = options.telemetry;
  const selector = options.selector || "standard";
  const legacyStageAllowlistPlan = selector === "legacy-stage-allowlist-v1"
    ? assertLegacyStageAllowlistPlan(options.legacyStageAllowlistPlan, options.cutoff)
    : null;
  return sql.begin(async (tx) => {
    await observedQuery(tx, {
      phase: "snapshot.read_only_transaction",
      queryName: "set_transaction_read_only",
      query: "set transaction isolation level repeatable read, read only;",
      telemetry,
    });
    if (selector === "bot-only-7d") {
      // Measured on Stage: the bot-only selector's eligible_transactions CTE joins
      // materially under-estimated CTE scans as Nested Loop and exceeded the 120 s
      // statement budget. Disabling nested loops for this one bounded snapshot lets
      // PostgreSQL pick hash joins; EXPLAIN (ANALYZE, BUFFERS) dropped the full
      // plan from timeout to ~17 s with no index or safety-guard change.
      await observedQuery(tx, {
        phase: "snapshot.read_only_transaction",
        queryName: "set_bot_only_candidate_planner_guard",
        query: "set local enable_nestloop = off;",
        telemetry,
      });
    }
    const candidateSql = selector === "standard"
      ? CANDIDATE_SQL
      : selector === "prunable"
        ? PRUNABLE_CANDIDATE_SQL
        : selector === "bot-only-7d"
          ? BOT_ONLY_CANDIDATE_SQL
          : selector === "legacy-stage-allowlist-v1"
            ? LEGACY_STAGE_ALLOWLIST_CANDIDATE_SQL
            : fail("snapshot selector must be standard, prunable, bot-only-7d, or legacy-stage-allowlist-v1");
    const candidateParameters = selector === "legacy-stage-allowlist-v1"
      ? [
        timestampParam(options.cutoff),
        legacyStageAllowlistPlan.batchTableIds,
        options.batchSize,
        legacyStageAllowlistPlan.allowlistSha256,
        legacyStageAllowlistPlan.batchTableIdsSha256,
        legacyStageAllowlistPlan.sourceRun,
        legacyStageAllowlistPlan.querySha256,
        legacyStageAllowlistPlan.stageSystemIdentifier,
        legacyStageAllowlistPlan.masterTableCount,
        legacyStageAllowlistPlan.batchNumber,
        legacyStageAllowlistPlan.batchTableCount,
        LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT,
      ]
      : [
        timestampParam(options.cutoff),
        options.batchSize,
        timestampParam(options.cursor?.created_at || null),
        options.cursor?.id || null,
      ];
    const candidates = await observedQuery(tx, {
      phase: "snapshot.candidate_selector",
      queryName: selector === "standard"
        ? "standard_candidate_selector"
        : selector === "prunable"
          ? "prunable_candidate_selector"
          : selector === "bot-only-7d"
            ? "bot_only_candidate_selector"
            : "legacy_stage_allowlist_candidate_selector",
      query: candidateSql,
      parameters: candidateParameters,
      telemetry,
    });
    const ids = candidates.map((candidate) => text(candidate.id));
    const entries = ids.length
      ? await observedQuery(tx, {
        phase: "snapshot.entries",
        queryName: "snapshot_entries",
        query: ENTRIES_SQL,
        parameters: [ids],
        telemetry,
      })
      : [];
    const blockingAnomalies = selector === "bot-only-7d" && candidates.length === 0
      ? normalizeBlockingAnomalies(await observedQuery(tx, {
        phase: "snapshot.blocking_anomalies",
        queryName: "bot_only_blocking_anomalies",
        query: BOT_ONLY_BLOCKING_ANOMALY_SQL,
        parameters: [
          timestampParam(options.cutoff),
          options.batchSize,
        ],
        telemetry,
      }))
      : [];
    return { candidates, entries, blockingAnomalies };
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
    const legacyStageAllowlistPlan = selector === "legacy-stage-allowlist-v1"
      ? deps.legacyStageAllowlistPlan
      : null;
    const snapshot = await readSnapshot(sql, {
      ...options,
      selector,
      telemetry: deps.telemetry,
      legacyStageAllowlistPlan,
    });
    const immutableLegacyStageAllowlistEvidence = selector === "legacy-stage-allowlist-v1"
      ? structuredClone(legacyStageAllowlistPlan.archiveManifest)
      : null;
    if (deps.noCandidateIfEmpty && snapshot.candidates.length === 0) {
      return {
        noCandidate: true,
        options,
        blockingAnomalies: snapshot.blockingAnomalies,
      };
    }
    const candidateIds = new Set(snapshot.candidates.map((candidate) => text(candidate.id)));
    const entriesByTransaction = groupEntries(snapshot.entries, candidateIds);
    const records = sortRecords(snapshot.candidates.map((candidate) => buildExportRecord(
      candidate,
      entriesByTransaction.get(text(candidate.id)) || [],
      { schemaVersion },
    )));
    validateBatch({ candidates: snapshot.candidates, records, cutoff: options.cutoff, schemaVersion, sourcePolicyId: deps.sourcePolicyId || null });

    const archive = buildArchiveBytes(records);
    const roundTripRaw = gunzipSync(archive.compressedBytes);
    if (!roundTripRaw.equals(archive.rawBytes)) fail("gzip round-trip verification failed");
    const roundTripRecords = parseJsonl(roundTripRaw.toString("utf8"));
    validateBatch({ candidates: snapshot.candidates, records: roundTripRecords, cutoff: options.cutoff, schemaVersion, sourcePolicyId: deps.sourcePolicyId || null });
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
      legacyStageAllowlist: selector === "legacy-stage-allowlist-v1"
        ? immutableLegacyStageAllowlistEvidence
        : null,
    });
    if (selector === "legacy-stage-allowlist-v1") {
      assertLegacyStageAllowlistEvidence(manifest.legacy_stage_allowlist, immutableLegacyStageAllowlistEvidence);
    }
    if (manifest.sha256.compressed_artifact !== crypto.createHash("sha256").update(archive.compressedBytes).digest("hex")) {
      fail("manifest checksum verification failed");
    }
    writeOutput(options, archive, manifest);
    if (selector === "legacy-stage-allowlist-v1") {
      const writtenManifest = JSON.parse(fs.readFileSync(options.manifestPath, "utf8"));
      assertLegacyStageAllowlistEvidence(writtenManifest.legacy_stage_allowlist, immutableLegacyStageAllowlistEvidence);
    }
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
