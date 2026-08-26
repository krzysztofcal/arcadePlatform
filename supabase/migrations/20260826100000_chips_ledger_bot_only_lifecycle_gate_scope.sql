-- P1 fix: scope NULL TABLE identities to evidence that can bind them to the
-- table currently being completed.  The original migration is already
-- applied on shared Stage and remains immutable.
create or replace function public.chips_assert_bot_only_table_lifecycle_gate(
  p_table_id uuid,
  p_batch_id bigint,
  p_cutoff timestamptz,
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

  -- Match the selector's normalization before deciding whether a NULL
  -- registry identity can block this table.  Every untrusted marker remains
  -- text until it has passed the selector's UUID regex; the raising parser is
  -- intentionally not called for historical unsupported keys.
  with table_transaction_metadata as materialized (
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
           end as key_format_from_key,
           case
             when metadata.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(metadata.idempotency_key, ':', 2)))
             when metadata.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(metadata.idempotency_key, ':', 3)))
             when metadata.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(metadata.idempotency_key, ':', 4)))
             else null
           end as key_table_id_from_key
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
           registry.tx_type,
           registry.table_id
      from public.chips_transaction_idempotency registry
  ), unknown_registry_rows as materialized (
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
           end as key_table_id_from_registry,
           transactions.key_table_id_from_key as transaction_key_table_id,
           transactions.metadata_table_id,
           transactions.reference_table_id
      from registry_rows registry
      left join table_transactions transactions on transactions.id = registry.transaction_id
     where registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
       and registry.table_id is null
  ), unknown_registry_identity_evidence as (
    select unknown.idempotency_key as identity_key,
           evidence.table_id
      from unknown_registry_rows unknown
      cross join lateral (
        values
          (unknown.key_table_id_from_registry),
          (unknown.transaction_key_table_id),
          (unknown.metadata_table_id),
          (unknown.reference_table_id)
      ) evidence(table_id)
     where evidence.table_id is not null

    union all

    select distinct unknown.idempotency_key,
           pg_catalog.lower(pg_catalog.btrim(pg_catalog.substring(accounts.system_key, 13)))
      from unknown_registry_rows unknown
      join public.chips_entries entries on entries.transaction_id = unknown.transaction_id
      join public.chips_accounts accounts on accounts.id = entries.account_id
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key ~* '^POKER_TABLE:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ), hot_identity_rows as materialized (
    select distinct transactions.id as transaction_id,
           transactions.idempotency_key,
           transactions.key_table_id_from_key,
           transactions.metadata_table_id,
           transactions.reference_table_id
      from table_transactions transactions
     where not exists (
             select 1
               from registry_rows registry
              where registry.transaction_id = transactions.id
                and registry.table_id is not null
           )
        or exists (
             select 1
               from registry_rows registry
              where registry.transaction_id = transactions.id
                and registry.table_id is null
           )
  ), hot_identity_evidence as (
    select hot.transaction_id,
           evidence.table_id
      from hot_identity_rows hot
      cross join lateral (
        values
          (hot.key_table_id_from_key),
          (hot.metadata_table_id),
          (hot.reference_table_id)
      ) evidence(table_id)
     where evidence.table_id is not null

    union all

    select distinct hot.transaction_id,
           pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 2)))
      from hot_identity_rows hot
      join registry_rows registry on registry.transaction_id = hot.transaction_id
       and registry.table_id is null
     where registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'

    union all

    select distinct hot.transaction_id,
           pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 3)))
      from hot_identity_rows hot
      join registry_rows registry on registry.transaction_id = hot.transaction_id
       and registry.table_id is null
     where registry.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'

    union all

    select distinct hot.transaction_id,
           pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 4)))
      from hot_identity_rows hot
      join registry_rows registry on registry.transaction_id = hot.transaction_id
       and registry.table_id is null
     where registry.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'

    union all

    select distinct hot.transaction_id,
           pg_catalog.lower(pg_catalog.btrim(pg_catalog.substring(accounts.system_key, 13)))
      from hot_identity_rows hot
      join public.chips_entries entries on entries.transaction_id = hot.transaction_id
      join public.chips_accounts accounts on accounts.id = entries.account_id
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key ~* '^POKER_TABLE:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
  select
    (
      select count(*)::bigint
        from unknown_registry_rows unknown
       where exists (
         select 1
           from unknown_registry_identity_evidence evidence
          where evidence.identity_key = unknown.idempotency_key
            and evidence.table_id = p_table_id::text
       )
    ),
    (
      select count(*)::bigint
        from hot_identity_rows hot
       where exists (
         select 1
           from hot_identity_evidence evidence
          where evidence.transaction_id = hot.transaction_id
            and evidence.table_id = p_table_id::text
       )
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
