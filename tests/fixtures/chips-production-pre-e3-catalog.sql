-- Test-only catalog captured read-only from Production on 2026-10-15.
-- Exact deployed prosrc, not a migration. Apply only to the disposable test DB.
CREATE OR REPLACE FUNCTION public.chips_assert_archive_prune_target(p_project_ref text, p_transaction_count bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare system_identifier text; begin select controls.system_identifier::text into system_identifier from pg_catalog.pg_control_system() as controls; if system_identifier is distinct from '7575202818581710058' or p_project_ref is distinct from 'otbqfijerkieoxwpxjnm' then raise exception 'Ledger archive pruning requires canonical Production identity'; end if; if p_transaction_count is null or p_transaction_count<1 or p_transaction_count>2 then raise exception 'Production archive pruning allows at most 2 transactions before activation'; end if; return system_identifier; end;$function$
;

CREATE OR REPLACE FUNCTION public.chips_assert_bot_only_archive_proof_lifecycle_gate(p_table_id uuid, p_batch_id bigint, p_cutoff timestamp with time zone, p_transaction_ids uuid[], p_registry_keys text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  table_row record;
  escrow_count bigint;
  unknown_registry_count bigint;
  unknown_hot_count bigint;
  human_registry_count bigint;
  young_registry_count bigint;
  incomplete_old_count bigint;
  newest_created_at timestamptz;
begin
  if not public.chips_table_fence_is_active() then
    raise exception using errcode = 'P8913', message = 'Bot-only lifecycle gate requires the active TABLE fence';
  end if;
  if p_batch_id is null or not exists (
    select 1 from public.chips_ledger_archive_batches batches
     where batches.batch_id = p_batch_id
       and batches.status = 'committed'
       and batches.project_ref = 'otbqfijerkieoxwpxjnm'
       and batches.format_version = 2
       and batches.source_policy_id = 'production-ledger-bot-only-retention-7d-v1'
       and batches.cutoff = p_cutoff
  ) then
    raise exception using errcode = 'P8913', message = 'Bot-only lifecycle gate requires the exact committed schema-v2 batch';
  end if;
  if p_transaction_ids is null or pg_catalog.cardinality(p_transaction_ids) < 1 then raise exception using errcode = 'P8913', message = 'Bot-only lifecycle gate requires exact transaction evidence'; end if;
  perform public.chips_assert_archive_prune_target('otbqfijerkieoxwpxjnm', pg_catalog.cardinality(p_transaction_ids));
  perform public.chips_assert_production_retention_control('production-ledger-bot-only-retention-7d-v1', pg_catalog.cardinality(p_transaction_ids), false);
  select tables.id, tables.status, tables.has_human_participant, tables.bot_only_proof_eligible, tables.bot_only_retention_complete_at into table_row from public.poker_tables tables where tables.id = p_table_id for update;
  if not found then raise exception using errcode = 'P8913', message = 'Bot-only table is missing'; end if;
  if pg_catalog.upper(table_row.status::text) <> 'CLOSED' then raise exception using errcode = 'P8913', message = 'Bot-only table is not CLOSED'; end if;
  if table_row.has_human_participant is true then raise exception using errcode = 'P8913', message = 'Human-participant table is outside bot-only retention'; end if;
  if table_row.bot_only_proof_eligible is not true then raise exception using errcode = 'P8913', message = 'Historical bot-only proof is uncertain'; end if;
  select count(*) into escrow_count from public.chips_accounts accounts where accounts.account_type::text = 'ESCROW' and accounts.system_key = 'POKER_TABLE:' || p_table_id::text and accounts.status::text = 'active' and accounts.balance = 0;
  if escrow_count <> 1 then raise exception using errcode = 'P8913', message = 'Bot-only table escrow is not active and zero'; end if;

  with candidate_transaction_ids as (
    select transactions.id from public.chips_transactions transactions where transactions.id = any(coalesce(p_transaction_ids, array[]::uuid[])) and transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
    union
    select transactions.id from public.chips_transactions transactions where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type) and pg_catalog.lower(coalesce(transactions.idempotency_key, '')) like any (array['join-buyin:' || p_table_id::text || ':%','bot-seed-buyin:' || p_table_id::text || ':%','managed-bot-seed-buyin:' || p_table_id::text || ':%']) and transactions.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || p_table_id::text || ':[^:]+(:[^:]+)*$')
    union
    select transactions.id from public.chips_transactions transactions where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type) and pg_catalog.lower(coalesce(transactions.idempotency_key, '')) like any (array['poker:leave:' || p_table_id::text || ':%','poker:inactive_cleanup:' || p_table_id::text || ':%']) and transactions.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || p_table_id::text || ':[^:]+(:[^:]+)*$')
    union
    select transactions.id from public.chips_transactions transactions where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type) and pg_catalog.lower(coalesce(transactions.idempotency_key, '')) like any (array['poker:rebuy:v1:' || p_table_id::text || ':%','poker:deferred-leave:v1:' || p_table_id::text || ':%','poker:bot-terminal-cashout:v1:' || p_table_id::text || ':%','poker:human-terminal-cashout:v1:' || p_table_id::text || ':%','poker:bot-replacement-buyin:v1:' || p_table_id::text || ':%','poker:managed-bot-top-up:v1:' || p_table_id::text || ':%']) and transactions.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || p_table_id::text || ':[^:]+(:[^:]+)*$')
    union
    select transactions.id from public.chips_transactions transactions where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type) and pg_catalog.lower(coalesce(transactions.metadata::text, '')) like '%' || p_table_id::text || '%' and transactions.metadata is not null and pg_catalog.jsonb_typeof(transactions.metadata) = 'object' and transactions.metadata ? 'tableId' and nullif(pg_catalog.btrim(transactions.metadata->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and pg_catalog.lower(pg_catalog.btrim(transactions.metadata->>'tableId')) = p_table_id::text
    union
    select transactions.id from public.chips_transactions transactions where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type) and pg_catalog.lower(coalesce(transactions.metadata::text, '')) like '%' || p_table_id::text || '%' and transactions.metadata is not null and pg_catalog.jsonb_typeof(transactions.metadata) = 'string' and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text) and pg_catalog.jsonb_typeof((transactions.metadata #>> '{}')::jsonb) = 'object' and ((transactions.metadata #>> '{}')::jsonb) ? 'tableId' and nullif(pg_catalog.btrim(((transactions.metadata #>> '{}')::jsonb)->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and pg_catalog.lower(pg_catalog.btrim(((transactions.metadata #>> '{}')::jsonb)->>'tableId')) = p_table_id::text
    union
    select transactions.id from public.chips_transactions transactions where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type) and pg_catalog.lower(coalesce(transactions.reference, '')) like any (array['table:' || p_table_id::text || '%','poker-rebuy:' || p_table_id::text || '%','bot_seed_buy_in:' || p_table_id::text || '%','bot_replacement_buy_in:' || p_table_id::text || '%','managed_bot_top_up:' || p_table_id::text || '%']) and transactions.reference ~* ('^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):' || p_table_id::text || '(:.*)?$')
    union
    select registry.transaction_id from public.chips_transaction_idempotency registry where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type) and registry.table_id = p_table_id
    union
    select registry.transaction_id from public.chips_transaction_idempotency registry where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type) and registry.table_id is null and pg_catalog.lower(registry.idempotency_key) like any (array['join-buyin:' || p_table_id::text || ':%','bot-seed-buyin:' || p_table_id::text || ':%','managed-bot-seed-buyin:' || p_table_id::text || ':%']) and registry.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || p_table_id::text || ':[^:]+(:[^:]+)*$')
    union
    select registry.transaction_id from public.chips_transaction_idempotency registry where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type) and registry.table_id is null and pg_catalog.lower(registry.idempotency_key) like any (array['poker:leave:' || p_table_id::text || ':%','poker:inactive_cleanup:' || p_table_id::text || ':%']) and registry.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || p_table_id::text || ':[^:]+(:[^:]+)*$')
    union
    select registry.transaction_id from public.chips_transaction_idempotency registry where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type) and registry.table_id is null and pg_catalog.lower(registry.idempotency_key) like any (array['poker:rebuy:v1:' || p_table_id::text || ':%','poker:deferred-leave:v1:' || p_table_id::text || ':%','poker:bot-terminal-cashout:v1:' || p_table_id::text || ':%','poker:human-terminal-cashout:v1:' || p_table_id::text || ':%','poker:bot-replacement-buyin:v1:' || p_table_id::text || ':%','poker:managed-bot-top-up:v1:' || p_table_id::text || ':%']) and registry.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || p_table_id::text || ':[^:]+(:[^:]+)*$')
    union
    select entries.transaction_id from public.chips_entries entries join public.chips_accounts accounts on accounts.id = entries.account_id where accounts.account_type::text = 'ESCROW' and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
  ), target_transactions as (
    select transactions.id, transactions.idempotency_key, transactions.reference, normalized.normalized_metadata,
      case when transactions.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.idempotency_key, ':', 2))) when transactions.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.idempotency_key, ':', 3))) when transactions.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.idempotency_key, ':', 4))) else null end as key_table_id
    from candidate_transaction_ids candidates join public.chips_transactions transactions on transactions.id = candidates.id cross join lateral (select case when transactions.metadata is not null and pg_catalog.jsonb_typeof(transactions.metadata) = 'object' then transactions.metadata when transactions.metadata is not null and pg_catalog.jsonb_typeof(transactions.metadata) = 'string' and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text) then (transactions.metadata #>> '{}')::jsonb else null::jsonb end as normalized_metadata) normalized
    where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
  ), target_transaction_evidence as (
    select target.id as transaction_id, target.key_table_id as table_id from target_transactions target where target.key_table_id is not null
    union all select target.id, pg_catalog.lower(pg_catalog.btrim(target.normalized_metadata->>'tableId')) from target_transactions target where target.normalized_metadata is not null and pg_catalog.jsonb_typeof(target.normalized_metadata) = 'object' and target.normalized_metadata ? 'tableId' and nullif(pg_catalog.btrim(target.normalized_metadata->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    union all select target.id, pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(target.reference, ':', 2))) from target_transactions target where target.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(:.*)?$'
    union all select target.id, case when registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 2))) when registry.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 3))) when registry.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 4))) else null end from target_transactions target join public.chips_transaction_idempotency registry on registry.transaction_id = target.id and registry.table_id is null where registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin|poker:(leave|inactive_cleanup)|poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1):'
    union all select target.id, p_table_id::text from target_transactions target join public.chips_entries entries on entries.transaction_id = target.id join public.chips_accounts accounts on accounts.id = entries.account_id where accounts.account_type::text = 'ESCROW' and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
  ), unknown_registry_rows as (
    select registry.idempotency_key, registry.transaction_id from public.chips_transaction_idempotency registry where registry.tx_type::text in ('TABLE_BUY_IN','TABLE_CASH_OUT') and registry.table_id is null and (registry.transaction_id = any(coalesce(p_transaction_ids,array[]::uuid[])) or registry.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || p_table_id::text || ':[^:]+(:[^:]+)*$') or registry.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || p_table_id::text || ':[^:]+(:[^:]+)*$') or registry.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || p_table_id::text || ':[^:]+(:[^:]+)*$') or exists (select 1 from target_transaction_evidence evidence where evidence.transaction_id = registry.transaction_id and evidence.table_id = p_table_id::text) or exists (select 1 from public.chips_entries entries join public.chips_accounts accounts on accounts.id=entries.account_id where entries.transaction_id=registry.transaction_id and accounts.account_type::text='ESCROW' and accounts.system_key='POKER_TABLE:'||p_table_id::text))
  ), unknown_registry_identity_evidence as (
    select unknown.idempotency_key as identity_key, case when unknown.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(unknown.idempotency_key,':',2))) when unknown.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(unknown.idempotency_key,':',3))) when unknown.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(unknown.idempotency_key,':',4))) else null end as table_id from unknown_registry_rows unknown
    union all select unknown.idempotency_key, evidence.table_id from unknown_registry_rows unknown join target_transaction_evidence evidence on evidence.transaction_id = unknown.transaction_id
    union all select distinct unknown.idempotency_key, p_table_id::text from unknown_registry_rows unknown join public.chips_entries entries on entries.transaction_id=unknown.transaction_id join public.chips_accounts accounts on accounts.id=entries.account_id where accounts.account_type::text='ESCROW' and accounts.system_key='POKER_TABLE:'||p_table_id::text
  ), hot_identity_rows as (
    select distinct target.id as transaction_id from target_transactions target where not exists (select 1 from public.chips_transaction_idempotency registry where registry.transaction_id=target.id and registry.table_id is not null) or exists (select 1 from public.chips_transaction_idempotency registry where registry.transaction_id=target.id and registry.table_id is null)
  ), hot_identity_evidence as (
    select hot.transaction_id,evidence.table_id from hot_identity_rows hot join target_transaction_evidence evidence on evidence.transaction_id=hot.transaction_id
    union all select distinct hot.transaction_id, case when registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key,':',2))) when registry.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key,':',3))) when registry.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$' then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key,':',4))) else null end from hot_identity_rows hot join public.chips_transaction_idempotency registry on registry.transaction_id=hot.transaction_id and registry.table_id is null where registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin|poker:(leave|inactive_cleanup)|poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1):'
    union all select distinct hot.transaction_id,p_table_id::text from hot_identity_rows hot join public.chips_entries entries on entries.transaction_id=hot.transaction_id join public.chips_accounts accounts on accounts.id=entries.account_id where accounts.account_type::text='ESCROW' and accounts.system_key='POKER_TABLE:'||p_table_id::text
  )
  select (select count(distinct unknown.identity_key)::bigint from unknown_registry_identity_evidence unknown where unknown.table_id=p_table_id::text),(select count(distinct hot.transaction_id)::bigint from hot_identity_evidence hot where hot.table_id=p_table_id::text) into unknown_registry_count,unknown_hot_count;
  if unknown_registry_count<>0 or unknown_hot_count<>0 then raise exception using errcode='P8914',message='Unknown TABLE identity blocks bot-only lifecycle completion'; end if;
  select count(*) into human_registry_count from public.chips_transaction_idempotency registry where registry.table_id=p_table_id and registry.tx_type::text in ('TABLE_BUY_IN','TABLE_CASH_OUT') and registry.user_id is not null;
  if human_registry_count<>0 then raise exception using errcode='P8914',message='USER TABLE identity blocks bot-only lifecycle completion'; end if;
  select count(*) into young_registry_count from public.chips_transaction_idempotency registry where registry.table_id=p_table_id and registry.tx_type::text in ('TABLE_BUY_IN','TABLE_CASH_OUT') and registry.user_id is null and registry.transaction_created_at>=p_cutoff;
  if young_registry_count<>0 then raise exception using errcode='P8915',message='Young TABLE identity blocks bot-only lifecycle completion'; end if;
  select count(*) into incomplete_old_count from public.chips_transaction_idempotency registry where registry.table_id=p_table_id and registry.tx_type::text in ('TABLE_BUY_IN','TABLE_CASH_OUT') and registry.user_id is null and registry.transaction_created_at<p_cutoff and not (registry.idempotency_key=any(coalesce(p_registry_keys,array[]::text[])) or exists (select 1 from public.chips_ledger_archive_batches batches where batches.batch_id=registry.archive_batch_id and batches.format_version=2 and batches.source_policy_id='production-ledger-bot-only-retention-7d-v1' and batches.pruned_at is not null and batches.registry_cleaned_at is not null));
  if incomplete_old_count<>0 then raise exception using errcode='P8916',message='Old TABLE identity is not fully archived, pruned, and cleaned'; end if;
  select max(value) into newest_created_at from (select max(registry.transaction_created_at) as value from public.chips_transaction_idempotency registry where registry.table_id=p_table_id union all select max(batches.bot_only_newest_created_at) from public.chips_ledger_archive_batches batches where batches.bot_only_table_id=p_table_id and batches.format_version=2 and batches.source_policy_id='production-ledger-bot-only-retention-7d-v1' and batches.registry_cleaned_at is not null) known;
  if newest_created_at is null or newest_created_at>=p_cutoff then raise exception using errcode='P8915',message='Newest known TABLE identity is not older than the bot-only cutoff'; end if;
  return pg_catalog.jsonb_build_object('state','table_complete','table_id',p_table_id,'newest_created_at',newest_created_at,'unknown_registry',unknown_registry_count,'unknown_hot',unknown_hot_count,'protected_registry',human_registry_count);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.chips_assert_closed_human_table_lifecycle_gate(p_table_id uuid, p_cutoff timestamp with time zone, p_current_batch_id bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare bad_count bigint;
begin
  if p_table_id is null or p_cutoff is null then raise exception using errcode='P9230',message='Human retention gate arguments are required'; end if;
  if not exists (
    select 1 from public.poker_tables t
    join public.chips_accounts a on a.account_type::text='ESCROW' and a.system_key='POKER_TABLE:'||t.id::text and a.status::text='active' and a.balance=0
    join public.poker_state s on s.table_id=t.id and jsonb_typeof(s.state)='object' and s.state->>'phase'='HAND_DONE' and s.state->>'handId'=''
    where t.id=p_table_id and upper(t.status::text)='CLOSED' and t.has_human_participant is true and not exists(select 1 from public.poker_requests r where r.table_id=t.id and r.result_json is null)
  ) then raise exception using errcode='P9231',message='Human table terminal lifecycle is incomplete'; end if;
  select count(*) into bad_count from public.chips_transaction_idempotency r left join public.chips_ledger_archive_batches b on b.batch_id=r.archive_batch_id where r.table_id=p_table_id and r.tx_type::text in ('TABLE_BUY_IN','TABLE_CASH_OUT') and (r.transaction_created_at>=p_cutoff or (r.archive_batch_id is null and p_current_batch_id is null) or (r.archive_batch_id is not null and not (b.status='committed' and b.archive_proof_verified_at is not null and b.pruned_at is not null and b.pruned_transaction_count=b.transaction_count and b.pruned_entry_count=b.entry_count and b.pruned_transaction_ids_sha256=b.archived_transaction_ids_sha256 and b.pruned_entry_ids_sha256=b.archived_entry_ids_sha256 and b.source_policy_id in ('production-ledger-auto-retention-30d-v1','production-ledger-closed-human-table-retention-30d-v1'))));
  if bad_count<>0 then raise exception using errcode='P9232',message='Human TABLE identity set is incomplete, young, or incompatible'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.chips_assert_production_retention_control(p_policy_id text, p_transaction_count bigint, p_execute boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actual_system_identifier text; control_row public.chips_production_retention_control%rowtype; policy_known boolean; limit_value integer;
begin
  select system_identifier::text into actual_system_identifier from pg_catalog.pg_control_system();
  if actual_system_identifier is distinct from '7575202818581710058' then raise exception using errcode='P8910',message='Production retention requires the canonical database identity'; end if;
  policy_known := p_policy_id in ('production-ledger-auto-retention-30d-v1','production-ledger-bot-only-retention-7d-v1','production-ledger-closed-human-table-retention-30d-v1','production-ledger-escrow-account-retention-v1');
  if not policy_known then raise exception using errcode='P8911',message='Unknown Production retention policy'; end if;
  select * into control_row from public.chips_production_retention_control where control_id is true;
  if not found then raise exception using errcode='P8911',message='Production retention control is missing'; end if;
  limit_value := case when control_row.enabled then control_row.max_transactions else 2 end;
  if p_transaction_count is null or p_transaction_count < 1 or p_transaction_count > limit_value then raise exception using errcode='P8911',message='Production retention batch exceeds the current bound'; end if;
  if p_execute and control_row.enabled is not true and coalesce(pg_catalog.current_setting('chips.production_canary',true),'') <> '1' then raise exception using errcode='P8912',message='Production destructive automation is disabled'; end if;
  return pg_catalog.jsonb_build_object('project_ref','otbqfijerkieoxwpxjnm','system_identifier',actual_system_identifier,'policy_id',p_policy_id,'max_transactions',limit_value,'enabled',control_row.enabled);
end;$function$
;

CREATE OR REPLACE FUNCTION public.chips_auto_prune_and_cleanup_bot_only_archive_batch(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_registry_keys text[], p_table_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare batch public.chips_ledger_archive_batches%rowtype; result jsonb;
begin
  if not public.chips_production_bot_only_retention_automatic_active() then raise exception using errcode='P8954',message='Automatic bot-only Production retention is not active'; end if;
  select batches.* into batch from public.chips_ledger_archive_batches batches where batches.object_path=p_object_path for update;
  if not found or batch.project_ref<>'otbqfijerkieoxwpxjnm' or batch.format_version<>2 or batch.source_policy_id<>'production-ledger-bot-only-retention-7d-v1' or batch.bot_only_table_id is distinct from p_table_id then raise exception using errcode='P8955',message='Automatic cleanup target is not a canonical Production bot-only batch'; end if;
  perform public.chips_assert_production_retention_control(batch.source_policy_id,batch.transaction_count,true);
  if batch.destructive_go_at is null and batch.destructive_go_batch_id is not null then raise exception using errcode='P8956',message='Automatic bot-only batch has a partial GO';
  elsif batch.destructive_go_at is null then
    perform pg_catalog.set_config('chips.production_bot_only_go','1',true);
    update public.chips_ledger_archive_batches batches set destructive_go_at=pg_catalog.timezone('utc',pg_catalog.now()),destructive_go_batch_id=batch.batch_id where batches.batch_id=batch.batch_id and batches.destructive_go_at is null;
    if not found then raise exception using errcode='P8956',message='Automatic bot-only batch GO transition was not unique'; end if;
  elsif batch.destructive_go_batch_id is distinct from batch.batch_id then raise exception using errcode='P8956',message='Automatic bot-only batch has a partial or foreign GO'; end if;
  result:=public.chips_prune_and_cleanup_bot_only_archive_batch(p_object_path,p_transaction_ids,p_entry_ids,p_registry_keys,p_table_id,true,batch.batch_id);
  return result||pg_catalog.jsonb_build_object('automatic_policy','production-ledger-bot-only-retention-7d-v1');
end;$function$
;

CREATE OR REPLACE FUNCTION public.chips_auto_prune_closed_human_table_archive_batch(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_table_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  policy public.chips_production_closed_human_table_retention_policy%rowtype;
  registry_count bigint;
  distinct_transaction_count bigint;
  distinct_table_count bigint;
  null_table_count bigint;
  exact_table_count bigint;
  foreign_archive_mapping_count bigint;
  receipt_count integer;
  go_count integer;
  result jsonb;
begin
  if not public.chips_production_closed_human_retention_automatic_active() then raise exception using errcode='P9269',message='Automatic closed-human Production retention is not active'; end if;
  if p_object_path is null or p_transaction_ids is null or p_entry_ids is null or p_table_id is null or pg_catalog.cardinality(p_transaction_ids)<1 or pg_catalog.cardinality(p_entry_ids)<1 then raise exception using errcode='P9270',message='Automatic closed-human exact archive binding is required'; end if;
  select policies.* into policy from public.chips_production_closed_human_table_retention_policy policies where policies.policy_id='production-ledger-closed-human-table-retention-30d-v1';
  if not found or policy.enabled is not true or policy.canary_batch_id is null or policy.canary_confirmation is distinct from ('GO '||policy.canary_batch_id::text) or policy.activation_confirmation is distinct from ('ACTIVATE production-ledger-closed-human-table-retention-30d-v1 CANARY '||policy.canary_batch_id::text) or policy.activation_go_at is null or policy.activated_at is null then raise exception using errcode='P9270',message='Automatic closed-human Production policy binding is invalid'; end if;
  select batches.* into batch from public.chips_ledger_archive_batches batches where batches.object_path=p_object_path for update;
  if not found or batch.project_ref is distinct from 'otbqfijerkieoxwpxjnm' or batch.format_version is distinct from 1 or batch.source_policy_id is distinct from 'production-ledger-closed-human-table-retention-30d-v1' or batch.status is distinct from 'committed' or batch.committed_at is null or batch.object_path is distinct from ('v1/sha256/'||batch.compressed_sha256||'.jsonl.gz') or batch.batch_id is null or batch.transaction_count is null or batch.entry_count is null or pg_catalog.cardinality(p_transaction_ids)<>batch.transaction_count or pg_catalog.cardinality(p_entry_ids)<>batch.entry_count then raise exception using errcode='P9271',message='Automatic closed-human target is not one canonical Production batch'; end if;
  perform public.chips_assert_production_retention_control(batch.source_policy_id,batch.transaction_count,true);
  perform public.chips_assert_archive_prune_target(batch.project_ref,batch.transaction_count);
  receipt_count:=pg_catalog.num_nonnulls(batch.pruned_at,batch.pruned_transaction_count,batch.pruned_entry_count,batch.pruned_transaction_ids_sha256,batch.pruned_entry_ids_sha256);
  if receipt_count not in (0,5) then raise exception using errcode='P9272',message='Automatic closed-human prune receipt is partial'; end if;
  go_count:=pg_catalog.num_nonnulls(batch.destructive_go_at,batch.destructive_go_batch_id);
  if go_count not in (0,2) or (go_count=2 and batch.destructive_go_batch_id is distinct from batch.batch_id) or (receipt_count=5 and go_count<>2) then raise exception using errcode='P9272',message='Automatic closed-human batch GO is partial or foreign'; end if;
  select pg_catalog.count(*),pg_catalog.count(distinct registry.transaction_id),pg_catalog.count(distinct registry.table_id),pg_catalog.count(*) filter(where registry.table_id is null),pg_catalog.count(*) filter(where registry.table_id=p_table_id),pg_catalog.count(*) filter(where registry.archive_batch_id is not null and registry.archive_batch_id<>batch.batch_id)
    into registry_count,distinct_transaction_count,distinct_table_count,null_table_count,exact_table_count,foreign_archive_mapping_count
    from public.chips_transaction_idempotency registry where registry.transaction_id=any(p_transaction_ids);
  if registry_count<>batch.transaction_count or distinct_transaction_count<>batch.transaction_count or distinct_table_count<>1 or null_table_count<>0 or exact_table_count<>batch.transaction_count or foreign_archive_mapping_count<>0 then raise exception using errcode='P9273',message='Automatic closed-human target registry binding is not exact'; end if;
  perform public.chips_assert_closed_human_table_lifecycle_gate(p_table_id,batch.cutoff,batch.batch_id);
  if go_count=0 then
    perform pg_catalog.set_config('chips.production_closed_human_go','1',true);
    update public.chips_ledger_archive_batches batches set destructive_go_at=pg_catalog.timezone('utc',pg_catalog.now()),destructive_go_batch_id=batch.batch_id where batches.batch_id=batch.batch_id and batches.destructive_go_at is null and batches.destructive_go_batch_id is null;
    if not found then raise exception using errcode='P9274',message='Automatic closed-human batch GO transition was not unique'; end if;
  end if;
  perform pg_catalog.set_config('chips.production_closed_human_automatic','1',true);
  result:=public.chips_prune_closed_human_table_archive_batch(p_object_path,p_transaction_ids,p_entry_ids,p_table_id,true,batch.batch_id);
  return result||pg_catalog.jsonb_build_object('automatic_policy','production-ledger-closed-human-table-retention-30d-v1','batch_id',batch.batch_id,'table_id',p_table_id);
end;$function$
;

CREATE OR REPLACE FUNCTION public.chips_complete_closed_human_table_retention(p_table_id uuid, p_cutoff timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin perform public.chips_assert_closed_human_table_lifecycle_gate(p_table_id,p_cutoff,null); perform pg_catalog.set_config('chips.production_table_lifecycle','1',true); update public.poker_tables set human_retention_complete_at=coalesce(human_retention_complete_at,pg_catalog.timezone('utc',pg_catalog.now())) where id=p_table_id; return pg_catalog.jsonb_build_object('state','human_retention_complete','table_id',p_table_id); end;$function$
;

CREATE OR REPLACE FUNCTION public.chips_guard_archive_batch_mutations()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  old_proof_count integer;
  new_proof_count integer;
  old_receipt_count integer;
  new_receipt_count integer;
  old_bot_proof_count integer;
  new_bot_proof_count integer;
  old_cleanup_count integer;
  new_cleanup_count integer;
  proof_changed boolean;
  receipt_changed boolean;
  bot_proof_changed boolean;
  cleanup_changed boolean;
  go_changed boolean;
begin
  if tg_op = 'DELETE' then raise exception 'Archive batch rows are durable; DELETE is not permitted'; end if;
  if new.object_path is distinct from old.object_path or new.batch_id is distinct from old.batch_id or new.project_ref is distinct from old.project_ref or new.format_version is distinct from old.format_version or new.cutoff is distinct from old.cutoff or new.cursor_start_created_at is distinct from old.cursor_start_created_at or new.cursor_start_id is distinct from old.cursor_start_id or new.cursor_end_created_at is distinct from old.cursor_end_created_at or new.cursor_end_id is distinct from old.cursor_end_id or new.first_created_at is distinct from old.first_created_at or new.last_created_at is distinct from old.last_created_at or new.transaction_count is distinct from old.transaction_count or new.entry_count is distinct from old.entry_count or new.tx_types is distinct from old.tx_types or new.raw_bytes is distinct from old.raw_bytes or new.compressed_bytes is distinct from old.compressed_bytes or new.raw_sha256 is distinct from old.raw_sha256 or new.compressed_sha256 is distinct from old.compressed_sha256 or new.credits is distinct from old.credits or new.debits is distinct from old.debits or new.net_amount is distinct from old.net_amount or new.created_at is distinct from old.created_at or new.source_policy_id is distinct from old.source_policy_id then raise exception 'Archive batch proof fields are immutable'; end if;
  proof_changed := new.archived_transaction_ids_sha256 is distinct from old.archived_transaction_ids_sha256 or new.archived_entry_ids_sha256 is distinct from old.archived_entry_ids_sha256 or new.archive_proof_verified_at is distinct from old.archive_proof_verified_at;
  receipt_changed := new.pruned_at is distinct from old.pruned_at or new.pruned_transaction_count is distinct from old.pruned_transaction_count or new.pruned_entry_count is distinct from old.pruned_entry_count or new.pruned_transaction_ids_sha256 is distinct from old.pruned_transaction_ids_sha256 or new.pruned_entry_ids_sha256 is distinct from old.pruned_entry_ids_sha256;
  bot_proof_changed := new.bot_only_table_id is distinct from old.bot_only_table_id or new.bot_only_table_count is distinct from old.bot_only_table_count or new.bot_only_newest_created_at is distinct from old.bot_only_newest_created_at or new.bot_only_registry_keys_sha256 is distinct from old.bot_only_registry_keys_sha256 or new.bot_only_out_of_scope_keys_sha256 is distinct from old.bot_only_out_of_scope_keys_sha256 or new.bot_only_identity_count is distinct from old.bot_only_identity_count or new.bot_only_eligible_count is distinct from old.bot_only_eligible_count;
  cleanup_changed := new.registry_cleaned_at is distinct from old.registry_cleaned_at or new.registry_cleaned_key_count is distinct from old.registry_cleaned_key_count or new.registry_cleaned_keys_sha256 is distinct from old.registry_cleaned_keys_sha256;
  go_changed := new.destructive_go_at is distinct from old.destructive_go_at or new.destructive_go_batch_id is distinct from old.destructive_go_batch_id;
  if proof_changed and receipt_changed then raise exception 'Archive proof and prune receipt require separate transitions'; end if;
  if receipt_changed and cleanup_changed then raise exception 'Archive prune receipt and registry cleanup receipt require separate transitions'; end if;
  if receipt_changed and new.format_version = 2 and (coalesce(pg_catalog.current_setting('chips.production_bot_only_prune', true), '') <> '1' or new.destructive_go_at is null or new.destructive_go_batch_id is distinct from new.batch_id) then raise exception using errcode = 'P8911', message = 'Schema-v2 archive batches require the exact lifecycle operator and batch GO'; end if;
  if (proof_changed or bot_proof_changed) and current_user <> 'chips_ledger_archive_pruner' then raise exception 'Archive proof may only be written by the archive pruner'; end if;
  if bot_proof_changed and coalesce(pg_catalog.current_setting('chips.production_bot_only_proof', true), '') <> '1' then raise exception 'Bot-only proof may only be written by the lifecycle proof operator'; end if;
  if (receipt_changed or cleanup_changed) and current_user <> 'chips_ledger_archive_pruner' then raise exception 'Archive receipt may only be written by the archive pruner'; end if;
  if cleanup_changed and coalesce(pg_catalog.current_setting('chips.production_bot_only_cleanup', true), '') <> '1' then raise exception 'Registry cleanup receipt may only be written by the lifecycle cleanup operator'; end if;
  if go_changed and not (current_user = 'postgres' and (coalesce(pg_catalog.current_setting('chips.production_bot_only_go', true), '') = '1' or coalesce(pg_catalog.current_setting('chips.production_closed_human_go', true), '') = '1' or coalesce(pg_catalog.current_setting('chips.production_canary', true), '') = '1')) then raise exception 'Destructive GO may only be written by the exact authorization function'; end if;
  if new.status is distinct from old.status then if old.status <> 'pending' or new.status <> 'committed' or old.committed_at is not null or new.committed_at is null then raise exception 'Archive batch status may only transition pending to committed'; end if; elsif new.committed_at is distinct from old.committed_at then raise exception 'Archive batch committed_at is immutable'; end if;
  old_proof_count := pg_catalog.num_nonnulls(old.archived_transaction_ids_sha256, old.archived_entry_ids_sha256, old.archive_proof_verified_at); new_proof_count := pg_catalog.num_nonnulls(new.archived_transaction_ids_sha256, new.archived_entry_ids_sha256, new.archive_proof_verified_at);
  if old_proof_count = 0 then if new_proof_count not in (0,3) then raise exception 'Archive ID proof must transition from empty to complete'; end if; if new_proof_count=3 and new.status<>'committed' then raise exception 'Archive ID proof requires a committed batch'; end if; elsif proof_changed then raise exception 'Archive ID proof cannot be replaced or cleared'; end if;
  old_receipt_count := pg_catalog.num_nonnulls(old.pruned_at, old.pruned_transaction_count, old.pruned_entry_count, old.pruned_transaction_ids_sha256, old.pruned_entry_ids_sha256); new_receipt_count := pg_catalog.num_nonnulls(new.pruned_at, new.pruned_transaction_count, new.pruned_entry_count, new.pruned_transaction_ids_sha256, new.pruned_entry_ids_sha256);
  if old_receipt_count=0 then if new_receipt_count not in (0,5) then raise exception 'Archive prune receipt must transition from empty to complete'; end if; if new_receipt_count=5 and new_proof_count<>3 then raise exception 'Archive prune receipt requires an immutable ID proof'; end if; elsif receipt_changed then raise exception 'Archive prune receipt cannot be replaced or cleared'; end if;
  old_bot_proof_count := pg_catalog.num_nonnulls(old.bot_only_table_id, old.bot_only_table_count, old.bot_only_newest_created_at, old.bot_only_registry_keys_sha256, old.bot_only_out_of_scope_keys_sha256, old.bot_only_identity_count, old.bot_only_eligible_count); new_bot_proof_count := pg_catalog.num_nonnulls(new.bot_only_table_id, new.bot_only_table_count, new.bot_only_newest_created_at, new.bot_only_registry_keys_sha256, new.bot_only_out_of_scope_keys_sha256, new.bot_only_identity_count, new.bot_only_eligible_count);
  if old_bot_proof_count=0 then if new_bot_proof_count not in (0,7) then raise exception 'Bot-only proof must transition from empty to complete'; end if; if new_bot_proof_count=7 and (new.status<>'committed' or new.format_version<>2) then raise exception 'Bot-only proof requires a committed schema-v2 batch'; end if; elsif bot_proof_changed then raise exception 'Bot-only proof cannot be replaced or cleared'; end if;
  old_cleanup_count := pg_catalog.num_nonnulls(old.registry_cleaned_at, old.registry_cleaned_key_count, old.registry_cleaned_keys_sha256); new_cleanup_count := pg_catalog.num_nonnulls(new.registry_cleaned_at, new.registry_cleaned_key_count, new.registry_cleaned_keys_sha256);
  if old_cleanup_count=0 then if new_cleanup_count not in (0,3) then raise exception 'Registry cleanup receipt must transition from empty to complete'; end if; if new_cleanup_count=3 and new_receipt_count<>5 then raise exception 'Registry cleanup receipt requires a complete ledger prune receipt'; end if; if new_cleanup_count=3 and not ((new.source_policy_id='production-ledger-bot-only-retention-7d-v1' and new_bot_proof_count=7) or (new.format_version=1 and new.source_policy_id='production-ledger-auto-retention-30d-v1' and new_bot_proof_count=0)) then raise exception 'Registry cleanup receipt requires matching immutable proof basis'; end if; elsif cleanup_changed then raise exception 'Registry cleanup receipt cannot be replaced or cleared'; end if;
  if old.destructive_go_at is not null and go_changed then raise exception 'Destructive GO cannot be replaced or cleared'; end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.chips_guard_human_retention_marker()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$begin if new.human_retention_complete_at is distinct from old.human_retention_complete_at and (old.human_retention_complete_at is not null or new.human_retention_complete_at is null or current_user<>'chips_ledger_archive_pruner' or coalesce(pg_catalog.current_setting('chips.production_table_lifecycle',true),'')<>'1') then raise exception using errcode='P9233',message='Human retention marker is immutable and lifecycle controlled'; end if; return new; end;$function$
;

CREATE OR REPLACE FUNCTION public.chips_prune_and_cleanup_bot_only_archive_batch(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_registry_keys text[], p_table_id uuid, p_execute boolean DEFAULT false, p_approved_batch_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare batch public.chips_ledger_archive_batches%rowtype; registry_keys_sha256 text; prune_result jsonb; deleted_registry_count bigint; lifecycle_marker timestamptz;
begin
  if p_execute is null then raise exception using errcode='P8921',message='Bot-only execute flag must not be NULL'; end if;
  if p_registry_keys is null or pg_catalog.cardinality(p_registry_keys)<1 or pg_catalog.cardinality(p_registry_keys)<>pg_catalog.cardinality(p_transaction_ids) then raise exception using errcode='P8921',message='Bot-only cleanup registry key set is invalid'; end if;
  select batches.* into batch from public.chips_ledger_archive_batches batches where batches.object_path=p_object_path for update;
  if not found or batch.project_ref<>'otbqfijerkieoxwpxjnm' or batch.format_version<>2 or batch.source_policy_id<>'production-ledger-bot-only-retention-7d-v1' then raise exception using errcode='P8921',message='Bot-only cleanup requires a canonical Production schema-v2 batch'; end if;
  perform public.chips_assert_archive_prune_target(batch.project_ref,pg_catalog.cardinality(p_transaction_ids));
  perform public.chips_assert_production_retention_control(batch.source_policy_id,pg_catalog.cardinality(p_transaction_ids),p_execute);
  if batch.bot_only_table_id is distinct from p_table_id or batch.transaction_count<>pg_catalog.cardinality(p_transaction_ids) or batch.entry_count<>pg_catalog.cardinality(p_entry_ids) or batch.archive_proof_verified_at is null or batch.archived_transaction_ids_sha256<>public.chips_archive_uuid_ids_sha256(p_transaction_ids) or batch.archived_entry_ids_sha256<>public.chips_archive_bigint_ids_sha256(p_entry_ids) then raise exception using errcode='P8921',message='Bot-only cleanup arguments do not match immutable proof'; end if;
  registry_keys_sha256:=public.chips_archive_text_ids_sha256(p_registry_keys);
  if registry_keys_sha256<>batch.bot_only_registry_keys_sha256 then raise exception using errcode='P8921',message='Bot-only cleanup keys do not match immutable proof'; end if;
  if batch.registry_cleaned_at is not null then
    if batch.registry_cleaned_key_count<>pg_catalog.cardinality(p_registry_keys) or batch.registry_cleaned_keys_sha256<>registry_keys_sha256 then raise exception using errcode='P8922',message='Existing bot-only cleanup receipt differs from the retry'; end if;
    select tables.bot_only_retention_complete_at into lifecycle_marker from public.poker_tables tables where tables.id=batch.bot_only_table_id;
    if found and lifecycle_marker is null then raise exception using errcode='P8925',message='Existing bot-only cleanup receipt has an empty TABLE lifecycle marker'; end if;
    return pg_catalog.jsonb_build_object('state','already_cleaned','transactions',batch.transaction_count,'registry_keys',batch.registry_cleaned_key_count);
  end if;
  perform public.chips_assert_bot_only_archive_proof_lifecycle_gate(batch.bot_only_table_id,batch.batch_id,batch.cutoff,p_transaction_ids,p_registry_keys);
  if not p_execute then prune_result:=public.chips_prune_committed_archive_batch_internal(p_object_path,p_transaction_ids,p_entry_ids,false); return prune_result||pg_catalog.jsonb_build_object('cleanup','prepare_only','table_id',batch.bot_only_table_id); end if;
  if p_approved_batch_id is distinct from batch.batch_id or batch.destructive_go_batch_id is distinct from batch.batch_id or batch.destructive_go_at is null then raise exception using errcode='P8923',message='Exact bot-only batch GO is required before destructive cleanup'; end if;
  perform pg_catalog.set_config('chips.production_bot_only_prune','1',true);
  prune_result:=public.chips_prune_committed_archive_batch_internal(p_object_path,p_transaction_ids,p_entry_ids,true);
  perform public.chips_assert_bot_only_archive_proof_lifecycle_gate(batch.bot_only_table_id,batch.batch_id,batch.cutoff,p_transaction_ids,p_registry_keys);
  select count(*) into deleted_registry_count from public.chips_transaction_idempotency registry where registry.archive_batch_id=batch.batch_id and registry.idempotency_key=any(p_registry_keys);
  if deleted_registry_count<>pg_catalog.cardinality(p_registry_keys) then raise exception using errcode='P8924',message='Bot-only registry cleanup set is incomplete'; end if;
  perform pg_catalog.set_config('chips.production_bot_registry_cleanup','1',true);
  delete from public.chips_transaction_idempotency registry where registry.archive_batch_id=batch.batch_id and registry.idempotency_key=any(p_registry_keys);
  get diagnostics deleted_registry_count=row_count;
  if deleted_registry_count<>pg_catalog.cardinality(p_registry_keys) then raise exception using errcode='P8924',message='Bot-only registry DELETE count mismatch'; end if;
  perform pg_catalog.set_config('chips.production_bot_only_cleanup','1',true);
  update public.chips_ledger_archive_batches batches set registry_cleaned_at=pg_catalog.timezone('utc',pg_catalog.now()),registry_cleaned_key_count=pg_catalog.cardinality(p_registry_keys),registry_cleaned_keys_sha256=registry_keys_sha256 where batches.batch_id=batch.batch_id and batches.registry_cleaned_at is null;
  if not found then raise exception using errcode='P8924',message='Bot-only cleanup receipt transition was not unique'; end if;
  perform pg_catalog.set_config('chips.production_table_lifecycle','1',true);
  update public.poker_tables tables set bot_only_retention_complete_at=coalesce(tables.bot_only_retention_complete_at,pg_catalog.timezone('utc',pg_catalog.now())) where tables.id=batch.bot_only_table_id and tables.bot_only_retention_complete_at is null;
  select tables.bot_only_retention_complete_at into lifecycle_marker from public.poker_tables tables where tables.id=batch.bot_only_table_id;
  if not found or lifecycle_marker is null then raise exception using errcode='P8925',message='Bot-only lifecycle completion marker was not persisted'; end if;
  return prune_result||pg_catalog.jsonb_build_object('state','cleaned','registry_keys',deleted_registry_count,'table_id',batch.bot_only_table_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.chips_prune_closed_human_table_archive_batch(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_table_id uuid, p_execute boolean DEFAULT false, p_approved_batch_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare batch public.chips_ledger_archive_batches%rowtype; policy public.chips_production_closed_human_table_retention_policy%rowtype; prune_result jsonb; receipt_count integer; registry_count bigint; distinct_table_count bigint; null_table_count bigint;
begin
  if p_execute is null then raise exception using errcode='P9235',message='Closed-human execute flag must not be NULL'; end if;
  if p_table_id is null then raise exception using errcode='P9235',message='Closed-human table identity is required'; end if;
  if p_object_path is null or p_transaction_ids is null or p_entry_ids is null or pg_catalog.cardinality(p_transaction_ids)<1 or pg_catalog.cardinality(p_entry_ids)<1 then raise exception using errcode='P9235',message='Closed-human exact archive IDs are required'; end if;
  if p_execute is true and p_approved_batch_id is null then raise exception using errcode='P9235',message='Exact closed-human approved batch is required'; end if;
  if p_execute is false and p_approved_batch_id is not null then raise exception using errcode='P9235',message='Closed-human approved batch is execute-only'; end if;
  select batches.* into batch from public.chips_ledger_archive_batches batches where batches.object_path=p_object_path for update;
  if not found or batch.project_ref is distinct from 'otbqfijerkieoxwpxjnm' or batch.format_version is distinct from 1 or batch.source_policy_id is distinct from 'production-ledger-closed-human-table-retention-30d-v1' or batch.batch_id is null or batch.status is distinct from 'committed' or batch.committed_at is null or batch.cutoff is null or coalesce(batch.raw_sha256,'') !~ '^[0-9a-f]{64}$' or coalesce(batch.compressed_sha256,'') !~ '^[0-9a-f]{64}$' or batch.object_path is distinct from ('v1/sha256/'||batch.compressed_sha256||'.jsonl.gz') or batch.transaction_count is null or batch.entry_count is null then raise exception using errcode='P9235',message='Closed-human prune requires one canonical Production batch'; end if;
  perform public.chips_assert_archive_prune_target(batch.project_ref,pg_catalog.cardinality(p_transaction_ids));
  receipt_count:=pg_catalog.num_nonnulls(batch.pruned_at,batch.pruned_transaction_count,batch.pruned_entry_count,batch.pruned_transaction_ids_sha256,batch.pruned_entry_ids_sha256);
  if receipt_count not in (0,5) then raise exception using errcode='P9235',message='Closed-human prune receipt is partial'; end if;
  select policies.* into policy from public.chips_production_closed_human_table_retention_policy policies where policies.policy_id='production-ledger-closed-human-table-retention-30d-v1';
  if not found or ((policy.enabled is true or policy.activated_at is not null) and coalesce(pg_catalog.current_setting('chips.production_closed_human_automatic',true),'')<>'1') or (coalesce(pg_catalog.current_setting('chips.production_closed_human_automatic',true),'')='1' and (policy.enabled is not true or policy.activated_at is null)) then raise exception using errcode='P9235',message='Closed-human policy is not in the required manual-only or active automatic state'; end if;
  if p_execute is true then
    if p_approved_batch_id is distinct from batch.batch_id or batch.destructive_go_at is null or batch.destructive_go_batch_id is distinct from batch.batch_id or (coalesce(pg_catalog.current_setting('chips.production_closed_human_automatic',true),'')<>'1' and (policy.canary_batch_id is distinct from batch.batch_id or policy.canary_confirmation is distinct from ('GO '||batch.batch_id::text))) or (coalesce(pg_catalog.current_setting('chips.production_closed_human_automatic',true),'')='1' and (policy.enabled is not true or policy.activated_at is null)) then raise exception using errcode='P9235',message='Exact closed-human batch GO is required before execute'; end if;
  end if;
  prune_result:=public.chips_prune_committed_archive_batch_internal(p_object_path,p_transaction_ids,p_entry_ids,false);
  if prune_result->>'state' not in ('ready','already_pruned') then raise exception using errcode='P9235',message='Closed-human exact dry-run is not ready'; end if;
  if (prune_result->>'distinct_tables')::bigint<>1 then raise exception using errcode='P9235',message='Closed-human batch must bind to exactly one table'; end if;
  select count(*),count(distinct registry.table_id),count(*) filter(where registry.table_id is null) into registry_count,distinct_table_count,null_table_count from public.chips_transaction_idempotency registry where registry.transaction_id=any(p_transaction_ids);
  if registry_count<>pg_catalog.cardinality(p_transaction_ids) or distinct_table_count<>1 or null_table_count<>0 or not exists(select 1 from public.chips_transaction_idempotency registry where registry.transaction_id=any(p_transaction_ids) and registry.table_id=p_table_id) then raise exception using errcode='P9235',message='Closed-human archive table binding is not exact'; end if;
  perform public.chips_assert_closed_human_table_lifecycle_gate(p_table_id,batch.cutoff,batch.batch_id);
  if p_execute is false or prune_result->>'state'='already_pruned' then return prune_result||pg_catalog.jsonb_build_object('policy_id',batch.source_policy_id,'table_id',p_table_id); end if;
  perform pg_catalog.set_config('chips.production_closed_human_prune','1',true);
  prune_result:=public.chips_prune_committed_archive_batch_internal(p_object_path,p_transaction_ids,p_entry_ids,true);
  perform public.chips_assert_closed_human_table_lifecycle_gate(p_table_id,batch.cutoff,batch.batch_id);
  return prune_result||pg_catalog.jsonb_build_object('policy_id',batch.source_policy_id,'table_id',p_table_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.chips_register_archive_id_proof(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_project_ref text, p_format_version integer, p_cutoff timestamp with time zone, p_cursor_start_created_at timestamp with time zone, p_cursor_start_id uuid, p_cursor_end_created_at timestamp with time zone, p_cursor_end_id uuid, p_first_created_at timestamp with time zone, p_last_created_at timestamp with time zone, p_tx_types jsonb, p_raw_bytes bigint, p_compressed_bytes bigint, p_raw_sha256 text, p_compressed_sha256 text, p_credits numeric, p_debits numeric, p_net_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare batch public.chips_ledger_archive_batches%rowtype; transaction_hash text; entry_hash text; updated_count bigint; begin perform public.chips_assert_archive_prune_target(p_project_ref,pg_catalog.cardinality(p_transaction_ids)); if p_transaction_ids is null or pg_catalog.cardinality(p_transaction_ids) not between 1 and 2 or p_entry_ids is null or pg_catalog.cardinality(p_entry_ids)<1 then raise exception 'Production archive proof arrays are invalid'; end if; transaction_hash:=public.chips_archive_uuid_ids_sha256(p_transaction_ids); entry_hash:=public.chips_archive_bigint_ids_sha256(p_entry_ids); select * into batch from public.chips_ledger_archive_batches where object_path=p_object_path for update; if not found or batch.status<>'committed' or batch.project_ref<>'otbqfijerkieoxwpxjnm' then raise exception 'Archive manifest is not committed canonical Production evidence'; end if; if batch.object_path <> 'v1/sha256/' || p_compressed_sha256 || '.jsonl.gz' or batch.transaction_count<>pg_catalog.cardinality(p_transaction_ids) or batch.entry_count<>pg_catalog.cardinality(p_entry_ids) or batch.raw_sha256<>p_raw_sha256 or batch.compressed_sha256<>p_compressed_sha256 then raise exception 'Archive proof does not match committed manifest'; end if; if batch.archive_proof_verified_at is not null then if batch.archived_transaction_ids_sha256 is distinct from transaction_hash or batch.archived_entry_ids_sha256 is distinct from entry_hash then raise exception 'Committed archive already has a different immutable proof'; end if; return pg_catalog.jsonb_build_object('state','proof_exists','transactions',batch.transaction_count,'entries',batch.entry_count); end if; update public.chips_ledger_archive_batches set archived_transaction_ids_sha256=transaction_hash,archived_entry_ids_sha256=entry_hash,archive_proof_verified_at=pg_catalog.timezone('utc',pg_catalog.now()) where batch_id=batch.batch_id and archive_proof_verified_at is null; get diagnostics updated_count=row_count; if updated_count<>1 then raise exception 'Archive proof transition was not unique'; end if; return pg_catalog.jsonb_build_object('state','proof_registered','transactions',batch.transaction_count,'entries',batch.entry_count,'transaction_ids_sha256',transaction_hash,'entry_ids_sha256',entry_hash); end;$function$
;

CREATE OR REPLACE FUNCTION public.chips_register_bot_only_archive_proof(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_table_id uuid, p_registry_keys text[], p_out_of_scope_keys_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  actual_transaction_ids uuid[];
  actual_entry_ids bigint[];
  actual_registry_keys text[];
  sorted_registry_keys text[];
  out_of_scope_keys text[];
  transaction_ids_sha256 text;
  entry_ids_sha256 text;
  registry_keys_sha256 text;
  out_of_scope_keys_sha256 text;
  expected_transaction_count bigint;
  expected_entry_count bigint;
  actual_table_count bigint;
  actual_identity_count bigint;
  actual_eligible_count bigint;
  invalid_registry_binding_count bigint;
  newest_created_at timestamptz;
  table_row record;
  invalid_shape_count bigint;
  updated_count bigint;
begin
  perform public.chips_assert_production_retention_control('production-ledger-bot-only-retention-7d-v1', pg_catalog.cardinality(p_transaction_ids), false);
  perform public.chips_assert_archive_prune_target('otbqfijerkieoxwpxjnm', pg_catalog.cardinality(p_transaction_ids));
  if p_transaction_ids is null or p_entry_ids is null or p_registry_keys is null or pg_catalog.cardinality(p_transaction_ids) < 1 or pg_catalog.cardinality(p_transaction_ids) > 5000 or pg_catalog.cardinality(p_entry_ids) < 1 or pg_catalog.cardinality(p_registry_keys) <> pg_catalog.cardinality(p_transaction_ids) then raise exception using errcode='P8917',message='Bot-only proof batch arrays are invalid'; end if;
  if (select count(*) from pg_catalog.unnest(p_transaction_ids) as values(value)) <> (select count(distinct value) from pg_catalog.unnest(p_transaction_ids) as values(value)) or (select count(*) from pg_catalog.unnest(p_entry_ids) as values(value)) <> (select count(distinct value) from pg_catalog.unnest(p_entry_ids) as values(value)) or (select count(*) from pg_catalog.unnest(p_registry_keys) as values(value)) <> (select count(distinct value) from pg_catalog.unnest(p_registry_keys) as values(value)) then raise exception using errcode='P8917',message='Bot-only proof batch arrays contain duplicates'; end if;
  transaction_ids_sha256 := public.chips_archive_uuid_ids_sha256(p_transaction_ids);
  entry_ids_sha256 := public.chips_archive_bigint_ids_sha256(p_entry_ids);
  select batches.* into batch from public.chips_ledger_archive_batches batches where batches.object_path=p_object_path for update;
  if not found then raise exception using errcode='P8917',message='Committed bot-only archive manifest was not found'; end if;
  if batch.status<>'committed' or batch.project_ref<>'otbqfijerkieoxwpxjnm' or batch.format_version<>2 or batch.source_policy_id<>'production-ledger-bot-only-retention-7d-v1' then raise exception using errcode='P8917',message='Bot-only proof requires a committed canonical Production schema-v2 batch'; end if;
  if batch.object_path <> ('v1/sha256/' || batch.compressed_sha256 || '.jsonl.gz') then raise exception using errcode='P8917',message='Bot-only object path does not match compressed SHA-256'; end if;
  if batch.transaction_count <> pg_catalog.cardinality(p_transaction_ids) or batch.entry_count <> pg_catalog.cardinality(p_entry_ids) then raise exception using errcode='P8917',message='Bot-only proof counts do not match the manifest'; end if;
  select pg_catalog.array_agg(transactions.id order by transactions.created_at,transactions.id) into actual_transaction_ids from public.chips_transactions transactions where transactions.id=any(p_transaction_ids);
  if actual_transaction_ids is distinct from p_transaction_ids then raise exception using errcode='P8917',message='Bot-only transaction order does not match the hot ledger'; end if;
  with wanted as (select ids.id,ids.ordinality from pg_catalog.unnest(p_transaction_ids) with ordinality ids(id,ordinality)) select pg_catalog.array_agg(entries.id order by wanted.ordinality,entries.id) into actual_entry_ids from wanted join public.chips_entries entries on entries.transaction_id=wanted.id;
  if actual_entry_ids is distinct from p_entry_ids then raise exception using errcode='P8917',message='Bot-only entry order does not match the hot ledger'; end if;
  select tables.id,tables.status,tables.has_human_participant,tables.bot_only_proof_eligible into table_row from public.poker_tables tables where tables.id=p_table_id for update;
  if not found or pg_catalog.upper(coalesce(table_row.status::text,''))<>'CLOSED' or table_row.has_human_participant is true or table_row.bot_only_proof_eligible is not true then raise exception using errcode='P8918',message='Bot-only proof requires an authoritative closed bot-only table'; end if;
  select count(*) into actual_table_count from (select distinct (public.chips_parse_table_idempotency_key(transactions.idempotency_key)->>'table_id')::uuid as table_id from public.chips_transactions transactions where transactions.id=any(p_transaction_ids)) tables;
  if actual_table_count<>1 or exists(select 1 from public.chips_transactions transactions where transactions.id=any(p_transaction_ids) and (public.chips_parse_table_idempotency_key(transactions.idempotency_key)->>'table_id')::uuid<>p_table_id) then raise exception using errcode='P8918',message='Bot-only proof has more than one table identity'; end if;
  select count(*) into invalid_shape_count from (
    select transactions.id from public.chips_transactions transactions join public.chips_entries entries on entries.transaction_id=transactions.id join public.chips_accounts accounts on accounts.id=entries.account_id where transactions.id=any(p_transaction_ids)
    group by transactions.id,transactions.tx_type,transactions.user_id,transactions.created_at,transactions.metadata,transactions.reference
    having transactions.tx_type::text not in ('TABLE_BUY_IN','TABLE_CASH_OUT') or transactions.user_id is not null or transactions.created_at>=batch.cutoff
      or (transactions.metadata ? 'tableId' and (nullif(pg_catalog.btrim(transactions.metadata->>'tableId'),'') is null or nullif(pg_catalog.btrim(transactions.metadata->>'tableId'),'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or pg_catalog.lower(pg_catalog.btrim(transactions.metadata->>'tableId'))<>p_table_id::text))
      or (transactions.reference is not null and public.chips_parse_table_reference(transactions.reference)<>p_table_id)
      or count(*)<>2 or count(*) filter(where accounts.account_type::text='USER')<>0 or count(*) filter(where accounts.account_type::text='SYSTEM')<>1 or count(*) filter(where accounts.account_type::text='ESCROW')<>1 or count(*) filter(where accounts.account_type::text='ESCROW' and accounts.system_key='POKER_TABLE:'||p_table_id::text)<>1 or not bool_and(accounts.status::text='active') or sum(entries.amount)<>0
      or (transactions.tx_type::text='TABLE_BUY_IN' and (sum(entries.amount) filter(where accounts.account_type::text='SYSTEM')>=0 or sum(entries.amount) filter(where accounts.account_type::text='ESCROW')<=0))
      or (transactions.tx_type::text='TABLE_CASH_OUT' and (sum(entries.amount) filter(where accounts.account_type::text='ESCROW')>=0 or sum(entries.amount) filter(where accounts.account_type::text='SYSTEM')<=0))
  ) invalid;
  if invalid_shape_count<>0 then raise exception using errcode='P8918',message='Bot-only proof is outside the technical TABLE whitelist'; end if;
  select pg_catalog.array_agg(registry.idempotency_key order by registry.idempotency_key) into actual_registry_keys from public.chips_transaction_idempotency registry where registry.transaction_id=any(p_transaction_ids) and registry.table_id=p_table_id and registry.archive_batch_id is null;
  select pg_catalog.array_agg(value order by value) into sorted_registry_keys from pg_catalog.unnest(p_registry_keys) as values(value);
  if actual_registry_keys is distinct from sorted_registry_keys then raise exception using errcode='P8919',message='Bot-only registry key proof does not match the hot registry'; end if;
  select count(*) into invalid_registry_binding_count from public.chips_transaction_idempotency registry where registry.table_id=p_table_id and (registry.key_format_version is distinct from 1 or registry.key_format is distinct from (public.chips_parse_table_idempotency_key(registry.idempotency_key)->>'format'));
  if invalid_registry_binding_count<>0 then raise exception using errcode='P8919',message='Bot-only registry format does not match the server-verifiable key'; end if;
  registry_keys_sha256 := public.chips_archive_text_ids_sha256(sorted_registry_keys);
  select pg_catalog.array_agg(registry.idempotency_key order by registry.idempotency_key) into out_of_scope_keys from public.chips_transaction_idempotency registry where registry.table_id=p_table_id and not(registry.idempotency_key=any(sorted_registry_keys));
  out_of_scope_keys := coalesce(out_of_scope_keys,array[]::text[]);
  out_of_scope_keys_sha256 := public.chips_archive_text_ids_sha256(out_of_scope_keys);
  if p_out_of_scope_keys_sha256 is distinct from out_of_scope_keys_sha256 then raise exception using errcode='P8919',message='Bot-only out-of-scope registry proof does not match the hot registry'; end if;
  select count(*) into actual_identity_count from public.chips_transaction_idempotency registry where registry.table_id=p_table_id;
  actual_eligible_count := pg_catalog.cardinality(p_transaction_ids);
  if actual_identity_count<>actual_eligible_count then raise exception using errcode='P8919',message='Bot-only registry identity count does not match the complete eligible set'; end if;
  select max(registry.transaction_created_at) into newest_created_at from public.chips_transaction_idempotency registry where registry.table_id=p_table_id;
  if newest_created_at is null or newest_created_at>=batch.cutoff then raise exception using errcode='P8915',message='Bot-only proof newest identity has not crossed the seven-day cutoff'; end if;
  perform public.chips_assert_bot_only_archive_proof_lifecycle_gate(p_table_id,batch.batch_id,batch.cutoff,p_transaction_ids,sorted_registry_keys);
  if batch.archive_proof_verified_at is not null then
    if batch.archived_transaction_ids_sha256 is distinct from transaction_ids_sha256 or batch.archived_entry_ids_sha256 is distinct from entry_ids_sha256 or batch.bot_only_table_id is distinct from p_table_id or batch.bot_only_registry_keys_sha256 is distinct from registry_keys_sha256 then raise exception using errcode='P8920',message='Existing bot-only proof differs from the requested evidence'; end if;
    return pg_catalog.jsonb_build_object('state','proof_exists','transactions',batch.transaction_count,'entries',batch.entry_count);
  end if;
  perform pg_catalog.set_config('chips.production_bot_only_proof','1',true);
  update public.chips_ledger_archive_batches batches set archived_transaction_ids_sha256=transaction_ids_sha256,archived_entry_ids_sha256=entry_ids_sha256,archive_proof_verified_at=pg_catalog.timezone('utc',pg_catalog.now()),bot_only_table_id=p_table_id,bot_only_table_count=1,bot_only_newest_created_at=newest_created_at,bot_only_registry_keys_sha256=registry_keys_sha256,bot_only_out_of_scope_keys_sha256=out_of_scope_keys_sha256,bot_only_identity_count=actual_identity_count,bot_only_eligible_count=actual_eligible_count where batches.batch_id=batch.batch_id and batches.archive_proof_verified_at is null;
  get diagnostics updated_count=row_count;
  if updated_count<>1 then raise exception using errcode='P8920',message='Bot-only proof transition was not unique'; end if;
  return pg_catalog.jsonb_build_object('state','proof_registered','transactions',batch.transaction_count,'entries',batch.entry_count,'table_id',p_table_id,'registry_keys_sha256',registry_keys_sha256);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.chips_retire_production_escrow_accounts(p_batch_id bigint, p_account_ids uuid[], p_recovery_object_path text, p_recovery_object_sha256 text, p_account_snapshot_sha256 text, p_execute boolean DEFAULT false, p_confirmation text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  policy public.chips_production_escrow_account_retention_policy%rowtype;
  table_ids uuid[]; sorted_account_ids uuid[]; locked_account_ids uuid[];
  account_count bigint; table_count bigint; bad_table_count bigint; bad_account_count bigint; hot_entry_count bigint; snapshot_count bigint; registry_count bigint; transaction_count bigint; receipt_count integer;
  account_ids_sha256 text; lifecycle_state text; affected_count bigint; production_system_identifier text;
begin
  if p_execute is null then raise exception using errcode='P8945',message='Escrow account retirement execute flag must not be NULL'; end if;
  if p_batch_id is null or p_account_ids is null or pg_catalog.cardinality(p_account_ids) not between 1 and 2 or pg_catalog.array_ndims(p_account_ids)<>1 or pg_catalog.array_position(p_account_ids,null) is not null then raise exception using errcode='P8945',message='Escrow account retirement set is invalid'; end if;
  if (select count(*) from pg_catalog.unnest(p_account_ids) ids(id))<>(select count(distinct id) from pg_catalog.unnest(p_account_ids) ids(id)) then raise exception using errcode='P8945',message='Escrow account retirement set contains duplicate IDs'; end if;
  select pg_catalog.array_agg(ids.id order by ids.id) into sorted_account_ids from pg_catalog.unnest(p_account_ids) ids(id);
  if sorted_account_ids is distinct from p_account_ids then raise exception using errcode='P8945',message='Escrow account retirement IDs must be sorted'; end if;
  account_ids_sha256:=public.chips_archive_uuid_ids_sha256(p_account_ids);
  if p_recovery_object_path is null or p_recovery_object_sha256 is null or p_account_snapshot_sha256 is null or p_recovery_object_sha256 !~ '^[0-9a-f]{64}$' or p_account_snapshot_sha256 !~ '^[0-9a-f]{64}$' or p_recovery_object_path<>'account-recovery/v1/sha256/'||p_recovery_object_sha256||'.json.gz' then raise exception using errcode='P8946',message='Escrow account recovery binding is invalid'; end if;
  production_system_identifier:=public.chips_assert_archive_prune_stage();
  if production_system_identifier is distinct from '7575202818581710058' then raise exception using errcode='P8976',message='Escrow account retirement is restricted to canonical Production'; end if;
  if not p_execute and (pg_catalog.current_setting('transaction_isolation') not in ('repeatable read','serializable') or pg_catalog.current_setting('transaction_read_only')<>'on') then raise exception using errcode='P8947',message='Escrow account prepare requires a read-only stable snapshot'; end if;
  if p_execute and pg_catalog.current_setting('transaction_isolation')<>'serializable' then raise exception using errcode='P8947',message='Escrow account execute requires SERIALIZABLE isolation'; end if;
  if p_execute and not exists (select 1 from pg_catalog.pg_locks locks where locks.locktype='advisory' and locks.pid=pg_catalog.pg_backend_pid() and locks.granted and locks.mode='ExclusiveLock' and locks.classid::bigint=((pg_catalog.hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm',0)>>32)&4294967295) and locks.objid::bigint=(pg_catalog.hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm',0)&4294967295)) then raise exception using errcode='P8977',message='Production automation advisory lock is required before escrow account retirement'; end if;
  if p_execute then select batches.* into batch from public.chips_ledger_archive_batches batches where batches.batch_id=p_batch_id for update; else select batches.* into batch from public.chips_ledger_archive_batches batches where batches.batch_id=p_batch_id; end if;
  if not found or batch.status is distinct from 'committed' or batch.project_ref is distinct from 'otbqfijerkieoxwpxjnm' or batch.format_version is distinct from 2 or batch.source_policy_id is distinct from 'production-ledger-bot-only-retention-7d-v1' then raise exception using errcode='P8948',message='Escrow account retirement requires a committed canonical Production schema-v2 batch'; end if;
  if batch.object_path is null or batch.compressed_sha256 is null or batch.raw_sha256 is null or batch.compressed_sha256 !~ '^[0-9a-f]{64}$' or batch.raw_sha256 !~ '^[0-9a-f]{64}$' or batch.object_path is distinct from 'v1/sha256/'||batch.compressed_sha256||'.jsonl.gz' then raise exception using errcode='P8948',message='Escrow account retirement requires a content-addressed archive manifest'; end if;
  if batch.archive_proof_verified_at is null or pg_catalog.num_nonnulls(batch.archived_transaction_ids_sha256,batch.archived_entry_ids_sha256,batch.archive_proof_verified_at)<>3 or pg_catalog.num_nonnulls(batch.pruned_at,batch.pruned_transaction_count,batch.pruned_entry_count,batch.pruned_transaction_ids_sha256,batch.pruned_entry_ids_sha256)<>5 or pg_catalog.num_nonnulls(batch.registry_cleaned_at,batch.registry_cleaned_key_count,batch.registry_cleaned_keys_sha256)<>3 or batch.pruned_transaction_count is distinct from batch.transaction_count or batch.pruned_entry_count is distinct from batch.entry_count or batch.pruned_transaction_ids_sha256 is distinct from batch.archived_transaction_ids_sha256 or batch.pruned_entry_ids_sha256 is distinct from batch.archived_entry_ids_sha256 or batch.registry_cleaned_key_count is distinct from batch.transaction_count or batch.destructive_go_at is null or batch.destructive_go_batch_id is distinct from batch.batch_id then raise exception using errcode='P8949',message='Archive proof, prune receipt, registry receipt, or ledger GO is incomplete'; end if;
  if pg_catalog.num_nonnulls(batch.bot_only_table_id,batch.bot_only_table_count,batch.bot_only_newest_created_at,batch.bot_only_registry_keys_sha256,batch.bot_only_out_of_scope_keys_sha256,batch.bot_only_identity_count,batch.bot_only_eligible_count)<>7 or batch.bot_only_table_count is distinct from 1 or batch.bot_only_identity_count is distinct from batch.transaction_count or batch.bot_only_eligible_count is distinct from batch.transaction_count then raise exception using errcode='P8950',message='Bot-only account retirement proof is incomplete'; end if;
  table_ids:=array[batch.bot_only_table_id]; lifecycle_state:='bot-only'; table_count:=pg_catalog.cardinality(table_ids);
  if table_count is null or table_count<1 or table_count>2 then raise exception using errcode='P8953',message='Archive batch table count is outside the account-retirement limit'; end if;
  if table_count<>1 then raise exception using errcode='P8953',message='Bot-only archive batch must contain one table'; end if;
  if pg_catalog.cardinality(p_account_ids)<>table_count then raise exception using errcode='P8954',message='Account count must match the exact archive table set'; end if;
  if exists(select 1 from public.poker_tables tables where tables.id=any(table_ids)) then raise exception using errcode='P8955',message='A corresponding poker table still exists'; end if;
  if exists(select 1 from pg_catalog.pg_constraint constraints where constraints.contype='f' and constraints.confrelid='public.chips_accounts'::pg_catalog.regclass and constraints.conrelid not in ('public.chips_entries'::pg_catalog.regclass,'public.chips_account_snapshot'::pg_catalog.regclass)) then raise exception using errcode='P8956',message='Unknown foreign key dependency blocks account retirement'; end if;
  if exists(select 1 from pg_catalog.pg_trigger triggers where triggers.tgrelid='public.chips_accounts'::pg_catalog.regclass and not triggers.tgisinternal and (triggers.tgtype::integer&8)<>0 and triggers.tgname not in ('chips_accounts_escrow_retirement_guard','chips_accounts_production_escrow_retirement_guard')) then raise exception using errcode='P8956',message='Unknown DELETE trigger dependency blocks account retirement'; end if;
  receipt_count:=pg_catalog.num_nonnulls(batch.account_retirement_at,batch.account_retirement_account_count,batch.account_retirement_account_ids_sha256,batch.account_retirement_recovery_object_path,batch.account_retirement_recovery_object_sha256,batch.account_retirement_snapshot_sha256);
  if receipt_count not in (0,6) then raise exception using errcode='P8957',message='Account-retirement receipt is partial'; end if;
  if receipt_count=6 then
    if batch.account_retirement_account_count is distinct from pg_catalog.cardinality(p_account_ids) or batch.account_retirement_account_ids_sha256 is distinct from account_ids_sha256 or batch.account_retirement_recovery_object_path is distinct from p_recovery_object_path or batch.account_retirement_recovery_object_sha256 is distinct from p_recovery_object_sha256 or batch.account_retirement_snapshot_sha256 is distinct from p_account_snapshot_sha256 then raise exception using errcode='P8958',message='Existing account-retirement receipt differs from the verified recovery'; end if;
    if exists(select 1 from public.chips_accounts accounts where accounts.id=any(p_account_ids)) then raise exception using errcode='P8958',message='Account-retirement receipt exists while an account remains'; end if;
    if exists(select 1 from public.chips_entries entries where entries.account_id=any(p_account_ids)) or exists(select 1 from public.chips_account_snapshot snapshots where snapshots.account_id=any(p_account_ids)) then raise exception using errcode='P8958',message='Already-retired account still has dependent ledger state'; end if;
    if exists(select 1 from public.chips_transaction_idempotency registry where registry.archive_batch_id=batch.batch_id or registry.table_id=any(table_ids)) then raise exception using errcode='P8958',message='Already-retired batch still has registry mappings'; end if;
    return pg_catalog.jsonb_build_object('state','already_retired','batch_id',batch.batch_id,'account_count',batch.account_retirement_account_count,'account_ids_sha256',account_ids_sha256,'recovery_object_path',batch.account_retirement_recovery_object_path,'recovery_object_sha256',batch.account_retirement_recovery_object_sha256,'account_snapshot_sha256',batch.account_retirement_snapshot_sha256,'lifecycle',lifecycle_state);
  end if;
  select count(*) into account_count from public.chips_accounts accounts where accounts.id=any(p_account_ids);
  if account_count<>pg_catalog.cardinality(p_account_ids) then raise exception using errcode='P8959',message='Exact ESCROW account set is missing'; end if;
  select count(*) into bad_account_count from public.chips_accounts accounts where accounts.id=any(p_account_ids) and (accounts.account_type::text is distinct from 'ESCROW' or accounts.user_id is not null or accounts.status::text is distinct from 'active' or accounts.balance is distinct from 0 or accounts.system_key is null or accounts.system_key !~ '^POKER_TABLE:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
  if bad_account_count<>0 then raise exception using errcode='P8960',message='Account is not an active zero-balance canonical ESCROW'; end if;
  select count(*) into bad_table_count from pg_catalog.unnest(table_ids) wanted(table_id) where (select count(*) from public.chips_accounts accounts where accounts.account_type::text='ESCROW' and accounts.system_key is not distinct from 'POKER_TABLE:'||wanted.table_id::text)<>1 or not exists(select 1 from public.chips_accounts accounts where accounts.id=any(p_account_ids) and accounts.system_key='POKER_TABLE:'||wanted.table_id::text);
  if bad_table_count<>0 then raise exception using errcode='P8961',message='Table-to-ESCROW account binding is not exactly one-to-one'; end if;
  select count(*) into hot_entry_count from public.chips_entries entries where entries.account_id=any(p_account_ids); if hot_entry_count<>0 then raise exception using errcode='P8962',message='Hot chips_entries block account retirement'; end if;
  select count(*) into snapshot_count from public.chips_account_snapshot snapshots where snapshots.account_id=any(p_account_ids); if snapshot_count<>0 then raise exception using errcode='P8963',message='chips_account_snapshot blocks account retirement'; end if;
  select count(*) into registry_count from public.chips_transaction_idempotency registry where registry.archive_batch_id=batch.batch_id or registry.table_id=any(table_ids) or exists(select 1 from pg_catalog.unnest(table_ids) wanted(table_id) where pg_catalog.strpos(pg_catalog.lower(registry.idempotency_key),wanted.table_id::text)>0); if registry_count<>0 then raise exception using errcode='P8964',message='Residual idempotency/table mapping blocks account retirement'; end if;
  with wanted as materialized (select ids.table_id from pg_catalog.unnest(table_ids) ids(table_id)), candidate_transaction_ids as materialized (
    select candidates.id from wanted cross join lateral (select transactions.id from public.chips_transactions transactions where pg_catalog.lower(coalesce(transactions.reference,'')) like '%'||wanted.table_id::text||'%') candidates
    union select candidates.id from wanted cross join lateral (select transactions.id from public.chips_transactions transactions where pg_catalog.lower(coalesce(transactions.idempotency_key,'')) like '%'||wanted.table_id::text||'%') candidates
    union select candidates.id from wanted cross join lateral (select transactions.id from public.chips_transactions transactions where pg_catalog.lower(coalesce(transactions.metadata::text,'')) like '%'||wanted.table_id::text||'%') candidates
  ), target_transactions as (select transactions.id from candidate_transaction_ids candidates join public.chips_transactions transactions on transactions.id=candidates.id where exists(select 1 from wanted where pg_catalog.strpos(pg_catalog.lower(coalesce(transactions.reference,'')),wanted.table_id::text)>0 or pg_catalog.strpos(pg_catalog.lower(transactions.idempotency_key),wanted.table_id::text)>0 or pg_catalog.strpos(pg_catalog.lower(transactions.metadata::text),wanted.table_id::text)>0)) select count(*) into transaction_count from target_transactions;
  if transaction_count<>0 then raise exception using errcode='P8965',message='Residual table transaction identity blocks account retirement'; end if;
  perform public.chips_assert_production_retention_control('production-ledger-escrow-account-retention-v1',pg_catalog.cardinality(p_account_ids),p_execute);
  if not p_execute then return pg_catalog.jsonb_build_object('state','eligible','mode','prepare-only','batch_id',batch.batch_id,'account_count',pg_catalog.cardinality(p_account_ids),'account_ids_sha256',account_ids_sha256,'recovery_object_path',p_recovery_object_path,'recovery_object_sha256',p_recovery_object_sha256,'account_snapshot_sha256',p_account_snapshot_sha256,'lifecycle',lifecycle_state,'read_only',true); end if;
  select policies.* into policy from public.chips_production_escrow_account_retention_policy policies where policies.policy_id='production-ledger-escrow-account-retention-v1';
  if not found then raise exception using errcode='P8966',message='Escrow account-retention kill switch row is missing'; end if;
  if policy.enabled is not true then if policy.canary_batch_id is distinct from batch.batch_id or policy.canary_account_ids_sha256 is distinct from account_ids_sha256 or p_confirmation is distinct from 'GO '||batch.batch_id::text then raise exception using errcode='P8967',message='Exact account-retirement canary GO is required'; end if; elsif p_confirmation is distinct from 'GO '||batch.batch_id::text then raise exception using errcode='P8967',message='Exact account-retirement GO is required'; end if;
  if not public.chips_table_fence_is_active() then raise exception using errcode='P8968',message='Active TABLE fence is required before account retirement'; end if;
  perform public.chips_lock_table_fence_for_retention();
  if not public.chips_table_fence_is_active() then raise exception using errcode='P8968',message='TABLE fence changed before account retirement'; end if;
  select pg_catalog.array_agg(locked.id order by locked.id) into locked_account_ids from (select accounts.id from public.chips_accounts accounts where accounts.id=any(p_account_ids) order by accounts.id for update skip locked) locked;
  if locked_account_ids is distinct from p_account_ids then raise exception using errcode='55P03',message='Could not lock the exact escrow account set',detail='An account was concurrently changed or locked',hint='Retry only after complete read-only revalidation'; end if;
  if not public.chips_table_fence_is_active() then raise exception using errcode='P8969',message='TABLE fence changed after account locks'; end if;
  if exists(select 1 from pg_catalog.pg_constraint constraints where constraints.contype='f' and constraints.confrelid='public.chips_accounts'::pg_catalog.regclass and constraints.conrelid not in ('public.chips_entries'::pg_catalog.regclass,'public.chips_account_snapshot'::pg_catalog.regclass)) or exists(select 1 from pg_catalog.pg_trigger triggers where triggers.tgrelid='public.chips_accounts'::pg_catalog.regclass and not triggers.tgisinternal and (triggers.tgtype::integer&8)<>0 and triggers.tgname not in ('chips_accounts_escrow_retirement_guard','chips_accounts_production_escrow_retirement_guard')) then raise exception using errcode='P8969',message='Account dependency catalog changed after account locks'; end if;
  select count(*) into account_count from public.chips_accounts accounts where accounts.id=any(p_account_ids);
  select count(*) into bad_account_count from public.chips_accounts accounts where accounts.id=any(p_account_ids) and (accounts.account_type::text is distinct from 'ESCROW' or accounts.user_id is not null or accounts.status::text is distinct from 'active' or accounts.balance is distinct from 0 or accounts.system_key is null or accounts.system_key !~ '^POKER_TABLE:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
  select count(*) into bad_table_count from pg_catalog.unnest(table_ids) wanted(table_id) where (select count(*) from public.chips_accounts accounts where accounts.account_type::text='ESCROW' and accounts.system_key is not distinct from 'POKER_TABLE:'||wanted.table_id::text)<>1 or not exists(select 1 from public.chips_accounts accounts where accounts.id=any(p_account_ids) and accounts.system_key='POKER_TABLE:'||wanted.table_id::text);
  select count(*) into hot_entry_count from public.chips_entries entries where entries.account_id=any(p_account_ids);
  select count(*) into snapshot_count from public.chips_account_snapshot snapshots where snapshots.account_id=any(p_account_ids);
  select count(*) into registry_count from public.chips_transaction_idempotency registry where registry.archive_batch_id=batch.batch_id or registry.table_id=any(table_ids) or exists(select 1 from pg_catalog.unnest(table_ids) wanted(table_id) where pg_catalog.strpos(pg_catalog.lower(registry.idempotency_key),wanted.table_id::text)>0);
  with wanted as materialized (select ids.table_id from pg_catalog.unnest(table_ids) ids(table_id)), candidate_transaction_ids as materialized (
    select candidates.id from wanted cross join lateral (select transactions.id from public.chips_transactions transactions where pg_catalog.lower(coalesce(transactions.reference,'')) like '%'||wanted.table_id::text||'%') candidates
    union select candidates.id from wanted cross join lateral (select transactions.id from public.chips_transactions transactions where pg_catalog.lower(coalesce(transactions.idempotency_key,'')) like '%'||wanted.table_id::text||'%') candidates
    union select candidates.id from wanted cross join lateral (select transactions.id from public.chips_transactions transactions where pg_catalog.lower(coalesce(transactions.metadata::text,'')) like '%'||wanted.table_id::text||'%') candidates
  ), target_transactions as (select transactions.id from candidate_transaction_ids candidates join public.chips_transactions transactions on transactions.id=candidates.id where exists(select 1 from wanted where pg_catalog.strpos(pg_catalog.lower(coalesce(transactions.reference,'')),wanted.table_id::text)>0 or pg_catalog.strpos(pg_catalog.lower(transactions.idempotency_key),wanted.table_id::text)>0 or pg_catalog.strpos(pg_catalog.lower(transactions.metadata::text),wanted.table_id::text)>0)) select count(*) into transaction_count from target_transactions;
  if account_count<>pg_catalog.cardinality(p_account_ids) or bad_account_count<>0 or bad_table_count<>0 or exists(select 1 from public.poker_tables tables where tables.id=any(table_ids)) or hot_entry_count<>0 or snapshot_count<>0 or registry_count<>0 or transaction_count<>0 then raise exception using errcode='P8969',message='Mutable account or table state changed after account locks'; end if;
  perform pg_catalog.set_config('chips.production_escrow_delete','1',true); perform pg_catalog.set_config('chips.production_escrow_batch_id',batch.batch_id::text,true);
  delete from public.chips_accounts accounts where accounts.id=any(p_account_ids); get diagnostics affected_count=row_count;
  if affected_count<>pg_catalog.cardinality(p_account_ids) or exists(select 1 from public.chips_accounts accounts where accounts.id=any(p_account_ids)) then raise exception using errcode='P8970',message='Escrow account DELETE count mismatch'; end if;
  perform pg_catalog.set_config('chips.escrow_account_retirement_receipt','1',true);
  update public.chips_ledger_archive_batches batches set account_retirement_at=pg_catalog.timezone('utc',pg_catalog.now()),account_retirement_account_count=pg_catalog.cardinality(p_account_ids),account_retirement_account_ids_sha256=account_ids_sha256,account_retirement_recovery_object_path=p_recovery_object_path,account_retirement_recovery_object_sha256=p_recovery_object_sha256,account_retirement_snapshot_sha256=p_account_snapshot_sha256 where batches.batch_id=batch.batch_id and batches.account_retirement_at is null;
  get diagnostics affected_count=row_count; if affected_count<>1 then raise exception using errcode='P8971',message='Account-retirement receipt transition was not unique'; end if;
  return pg_catalog.jsonb_build_object('state','retired','batch_id',batch.batch_id,'account_count',pg_catalog.cardinality(p_account_ids),'account_ids_sha256',account_ids_sha256,'recovery_object_path',p_recovery_object_path,'recovery_object_sha256',p_recovery_object_sha256,'account_snapshot_sha256',p_account_snapshot_sha256,'lifecycle',lifecycle_state);
end;
$function$
;
