-- P1 fix: keep bot-only proof lifecycle evidence exact to the requested
-- table/batch instead of materializing every TABLE identity in the registry.
-- This is a forward-only replacement; already-applied migrations remain
-- immutable.
begin;

-- The closed-human composite index has table_id as its leading column, but
-- escrow and bot-only registry lookups also need a narrow standalone access
-- path for non-null table identities.
create index if not exists chips_transaction_idempotency_table_id_idx
  on public.chips_transaction_idempotency(table_id)
  where table_id is not null;

grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

create or replace function public.chips_assert_bot_only_archive_proof_lifecycle_gate(
  p_table_id uuid,
  p_batch_id bigint,
  p_cutoff timestamptz,
  p_transaction_ids uuid[],
  p_registry_keys text[]
)
returns jsonb
language plpgsql
set search_path = ''
as $$
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
    select 1
      from public.chips_ledger_archive_batches batches
     where batches.batch_id = p_batch_id
       and batches.status = 'committed'
       and batches.format_version = 2
       and batches.source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'
       and batches.cutoff = p_cutoff
  ) then
    raise exception using errcode = 'P8913', message = 'Bot-only lifecycle gate requires the exact committed schema-v2 batch';
  end if;
  if p_transaction_ids is null or pg_catalog.cardinality(p_transaction_ids) < 1 then
    raise exception using errcode = 'P8913', message = 'Bot-only lifecycle gate requires exact transaction evidence';
  end if;

  select tables.id, tables.status, tables.has_human_participant, tables.bot_only_proof_eligible, tables.bot_only_retention_complete_at
    into table_row
    from public.poker_tables tables
   where tables.id = p_table_id
   for update;
  if not found then raise exception using errcode = 'P8913', message = 'Bot-only table is missing'; end if;
  if pg_catalog.upper(table_row.status::text) <> 'CLOSED' then raise exception using errcode = 'P8913', message = 'Bot-only table is not CLOSED'; end if;
  if table_row.has_human_participant is true then raise exception using errcode = 'P8913', message = 'Human-participant table is outside bot-only retention'; end if;
  if table_row.bot_only_proof_eligible is not true then raise exception using errcode = 'P8913', message = 'Historical bot-only proof is uncertain'; end if;

  select count(*) into escrow_count
    from public.chips_accounts accounts
   where accounts.account_type::text = 'ESCROW'
     and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
     and accounts.status::text = 'active'
     and accounts.balance = 0;
  if escrow_count <> 1 then raise exception using errcode = 'P8913', message = 'Bot-only table escrow is not active and zero'; end if;

  -- Keep the target evidence predicates equivalent to the historical gate,
  -- but start from the exact proof IDs and target markers.  No global
  -- registry_rows/table_transactions materialization is used here.  The
  -- result remains fail-closed for key, metadata, reference, and ESCROW
  -- evidence that can bind an unknown identity to this exact table.
  with target_transactions as (
    select transactions.id,
           transactions.idempotency_key,
           transactions.reference,
           normalized.normalized_metadata,
           case
             when transactions.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.idempotency_key, ':', 2)))
             when transactions.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.idempotency_key, ':', 3)))
             when transactions.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.idempotency_key, ':', 4)))
             else null
           end as key_table_id
      from public.chips_transactions transactions
      cross join lateral (
        select case
                 when transactions.metadata is not null
                   and pg_catalog.jsonb_typeof(transactions.metadata) = 'object'
                   then transactions.metadata
                 when transactions.metadata is not null
                   and pg_catalog.jsonb_typeof(transactions.metadata) = 'string'
                   and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text)
                   then (transactions.metadata #>> '{}')::jsonb
                 else null::jsonb
               end as normalized_metadata
      ) normalized
     where transactions.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
       and (
         transactions.id = any(coalesce(p_transaction_ids, array[]::uuid[]))
         or transactions.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || p_table_id::text || ':[^:]+(:[^:]+)*$')
         or transactions.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || p_table_id::text || ':[^:]+(:[^:]+)*$')
         or transactions.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || p_table_id::text || ':[^:]+(:[^:]+)*$')
         or (
           normalized.normalized_metadata is not null
           and pg_catalog.jsonb_typeof(normalized.normalized_metadata) = 'object'
           and normalized.normalized_metadata ? 'tableId'
           and nullif(pg_catalog.btrim(normalized.normalized_metadata->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           and pg_catalog.lower(pg_catalog.btrim(normalized.normalized_metadata->>'tableId')) = p_table_id::text
         )
         or (
           transactions.reference ~* ('^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):' || p_table_id::text || '(:.*)?$')
         )
         or exists (
           select 1
             from public.chips_transaction_idempotency registry
            where registry.transaction_id = transactions.id
              and registry.table_id is null
              and (
                registry.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || p_table_id::text || ':[^:]+(:[^:]+)*$')
                or registry.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || p_table_id::text || ':[^:]+(:[^:]+)*$')
                or registry.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || p_table_id::text || ':[^:]+(:[^:]+)*$')
              )
         )
         or exists (
           select 1
             from public.chips_entries entries
             join public.chips_accounts accounts on accounts.id = entries.account_id
            where entries.transaction_id = transactions.id
              and accounts.account_type::text = 'ESCROW'
              and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
         )
       )
  ), target_transaction_evidence as (
    select target.id as transaction_id, target.key_table_id as table_id
      from target_transactions target
     where target.key_table_id is not null

    union all

    select target.id,
           pg_catalog.lower(pg_catalog.btrim(target.normalized_metadata->>'tableId'))
      from target_transactions target
     where target.normalized_metadata is not null
       and pg_catalog.jsonb_typeof(target.normalized_metadata) = 'object'
       and target.normalized_metadata ? 'tableId'
       and nullif(pg_catalog.btrim(target.normalized_metadata->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

    union all

    select target.id,
           pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(target.reference, ':', 2)))
      from target_transactions target
     where target.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(:.*)?$'

    union all

    select target.id,
           case
             when registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 2)))
             when registry.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 3)))
             when registry.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 4)))
             else null
           end
      from target_transactions target
      join public.chips_transaction_idempotency registry on registry.transaction_id = target.id
       and registry.table_id is null
     where registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin|poker:(leave|inactive_cleanup)|poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1):'

    union all

    select target.id, p_table_id::text
      from target_transactions target
      join public.chips_entries entries on entries.transaction_id = target.id
      join public.chips_accounts accounts on accounts.id = entries.account_id
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
  ), unknown_registry_rows as (
    select registry.idempotency_key, registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
       and registry.table_id is null
       and (
         registry.transaction_id = any(coalesce(p_transaction_ids, array[]::uuid[]))
         or registry.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || p_table_id::text || ':[^:]+(:[^:]+)*$')
         or registry.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || p_table_id::text || ':[^:]+(:[^:]+)*$')
         or registry.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || p_table_id::text || ':[^:]+(:[^:]+)*$')
         or exists (
           select 1
             from target_transaction_evidence evidence
            where evidence.transaction_id = registry.transaction_id
              and evidence.table_id = p_table_id::text
         )
         or exists (
           select 1
             from public.chips_entries entries
             join public.chips_accounts accounts on accounts.id = entries.account_id
            where entries.transaction_id = registry.transaction_id
              and accounts.account_type::text = 'ESCROW'
              and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
         )
       )
  ), unknown_registry_identity_evidence as (
    select unknown.idempotency_key as identity_key,
           case
             when unknown.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(unknown.idempotency_key, ':', 2)))
             when unknown.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(unknown.idempotency_key, ':', 3)))
             when unknown.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(unknown.idempotency_key, ':', 4)))
             else null
           end as table_id
      from unknown_registry_rows unknown

    union all

    select unknown.idempotency_key, evidence.table_id
      from unknown_registry_rows unknown
      join target_transaction_evidence evidence on evidence.transaction_id = unknown.transaction_id

    union all

    select distinct unknown.idempotency_key, p_table_id::text
      from unknown_registry_rows unknown
      join public.chips_entries entries on entries.transaction_id = unknown.transaction_id
      join public.chips_accounts accounts on accounts.id = entries.account_id
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
  ), hot_identity_rows as (
    select distinct target.id as transaction_id
      from target_transactions target
     where not exists (
             select 1
               from public.chips_transaction_idempotency registry
              where registry.transaction_id = target.id
                and registry.table_id is not null
           )
        or exists (
             select 1
               from public.chips_transaction_idempotency registry
              where registry.transaction_id = target.id
                and registry.table_id is null
           )
  ), hot_identity_evidence as (
    select hot.transaction_id, evidence.table_id
      from hot_identity_rows hot
      join target_transaction_evidence evidence on evidence.transaction_id = hot.transaction_id

    union all

    select distinct hot.transaction_id,
           case
             when registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 2)))
             when registry.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 3)))
             when registry.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 4)))
             else null
           end
      from hot_identity_rows hot
      join public.chips_transaction_idempotency registry on registry.transaction_id = hot.transaction_id
       and registry.table_id is null
     where registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin|poker:(leave|inactive_cleanup)|poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1):'

    union all

    select distinct hot.transaction_id, p_table_id::text
      from hot_identity_rows hot
      join public.chips_entries entries on entries.transaction_id = hot.transaction_id
      join public.chips_accounts accounts on accounts.id = entries.account_id
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
  )
  select
    (
      select count(distinct unknown.idempotency_key)::bigint
        from unknown_registry_identity_evidence unknown
       where unknown.table_id = p_table_id::text
    ),
    (
      select count(distinct hot.transaction_id)::bigint
        from hot_identity_evidence hot
       where hot.table_id = p_table_id::text
    )
    into unknown_registry_count, unknown_hot_count;

  if unknown_registry_count <> 0 or unknown_hot_count <> 0 then
    raise exception using errcode = 'P8914', message = 'Unknown TABLE identity blocks bot-only lifecycle completion';
  end if;

  select count(*) into human_registry_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.user_id is not null;
  if human_registry_count <> 0 then raise exception using errcode = 'P8914', message = 'USER TABLE identity blocks bot-only lifecycle completion'; end if;

  select count(*) into young_registry_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.user_id is null
     and registry.transaction_created_at >= p_cutoff;
  if young_registry_count <> 0 then raise exception using errcode = 'P8915', message = 'Young TABLE identity blocks bot-only lifecycle completion'; end if;

  select count(*) into incomplete_old_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.user_id is null
     and registry.transaction_created_at < p_cutoff
     and not (
       registry.idempotency_key = any(coalesce(p_registry_keys, array[]::text[]))
       or exists (
         select 1
           from public.chips_ledger_archive_batches batches
          where batches.batch_id = registry.archive_batch_id
            and batches.format_version = 2
            and batches.source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'
            and batches.pruned_at is not null
            and batches.registry_cleaned_at is not null
       )
     );
  if incomplete_old_count <> 0 then raise exception using errcode = 'P8916', message = 'Old TABLE identity is not fully archived, pruned, and cleaned'; end if;

  select max(value) into newest_created_at
    from (
      select max(registry.transaction_created_at) as value
        from public.chips_transaction_idempotency registry
       where registry.table_id = p_table_id
      union all
      select max(batches.bot_only_newest_created_at)
        from public.chips_ledger_archive_batches batches
       where batches.bot_only_table_id = p_table_id
         and batches.format_version = 2
         and batches.source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'
         and batches.registry_cleaned_at is not null
    ) known;
  if newest_created_at is null or newest_created_at >= p_cutoff then
    raise exception using errcode = 'P8915', message = 'Newest known TABLE identity is not older than the bot-only cutoff';
  end if;

  return pg_catalog.jsonb_build_object(
    'state', 'table_complete',
    'table_id', p_table_id,
    'newest_created_at', newest_created_at,
    'unknown_registry', unknown_registry_count,
    'unknown_hot', unknown_hot_count,
    'protected_registry', human_registry_count
  );
end;
$$;

revoke all on function public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid, bigint, timestamptz, uuid[], text[])
  from public, anon, authenticated, service_role;
grant execute on function public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid, bigint, timestamptz, uuid[], text[])
  to chips_ledger_archive_pruner;

-- Replace only the proof call.  The exact function signature and call shape
-- are guarded so a future historical rewrite fails closed at migration time.
do $patch$
declare
  definition text;
  patched text;
  needle text := 'public.chips_assert_bot_only_table_lifecycle_gate(p_table_id, batch.batch_id, batch.cutoff, sorted_registry_keys)';
  replacement text := 'public.chips_assert_bot_only_archive_proof_lifecycle_gate(p_table_id, batch.batch_id, batch.cutoff, p_transaction_ids, sorted_registry_keys)';
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_register_bot_only_archive_proof(text,uuid[],bigint[],uuid,text[])'::pg_catalog.regprocedure
  ) into definition;
  if definition is null or pg_catalog.strpos(definition, needle) = 0 then
    raise exception 'bot-only proof function call shape changed; refusing proof performance patch';
  end if;
  patched := pg_catalog.replace(definition, needle, replacement);
  if patched = definition
     or pg_catalog.strpos(patched, replacement) = 0
     or pg_catalog.strpos(patched, needle) <> 0 then
    raise exception 'bot-only proof function replacement was not exact';
  end if;
  execute patched;
end;
$patch$;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;
commit;
