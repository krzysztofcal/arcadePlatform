begin;

-- Forward-only completion for the legacy_stage_allowlist_v1 lifecycle.  The
-- legacy pruner already removes the exact hot ledger and registry rows and
-- writes both receipts; this replacement commits the TABLE lifecycle marker
-- in that same transaction and makes the marker proof basis legacy-specific.
create or replace function public.chips_guard_poker_table_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.has_human_participant is true and new.has_human_participant is not true then
    raise exception using errcode = 'P8905', message = 'has_human_participant is one-way';
  end if;

  if new.bot_only_proof_eligible is distinct from old.bot_only_proof_eligible then
    raise exception using errcode = 'P8906', message = 'bot-only proof eligibility is immutable';
  end if;

  if new.bot_only_retention_complete_at is distinct from old.bot_only_retention_complete_at then
    if old.bot_only_retention_complete_at is null
       and new.bot_only_retention_complete_at is not null
       and new.has_human_participant is not true
       and new.bot_only_proof_eligible is true
       and current_user = 'chips_ledger_archive_pruner'
       and coalesce(pg_catalog.current_setting('chips.bot_only_lifecycle', true), '') = '1'
       and exists (
         select 1
           from public.chips_ledger_archive_batches batches
          where batches.bot_only_table_id = new.id
            and batches.format_version = 2
            and batches.source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'
            and batches.archive_proof_verified_at is not null
            and batches.pruned_at is not null
            and batches.registry_cleaned_at is not null
            and batches.registry_cleaned_key_count = batches.transaction_count
            and batches.registry_cleaned_keys_sha256 = batches.bot_only_registry_keys_sha256
            and not exists (
              select 1
                from public.chips_transaction_idempotency registry
               where registry.table_id = new.id
            )
       ) then
      null;
    elsif old.bot_only_retention_complete_at is null
       and new.bot_only_retention_complete_at is not null
       and new.status::text = 'CLOSED'
       and old.has_human_participant is not true
       and new.has_human_participant is false
       and new.bot_only_proof_eligible is false
       and new.bot_only_proof_eligible is not distinct from old.bot_only_proof_eligible
       and current_user = 'chips_ledger_archive_pruner'
       and coalesce(pg_catalog.current_setting('chips.legacy_stage_cleanup', true), '') = '1'
       and coalesce(pg_catalog.current_setting('chips.bot_only_prune', true), '') = '1'
       and coalesce(pg_catalog.current_setting('chips.bot_only_go', true), '') = '1'
       and coalesce(pg_catalog.current_setting('chips.bot_registry_cleanup', true), '') = '1'
       and coalesce(pg_catalog.current_setting('chips.bot_cleanup_receipt', true), '') = '1'
       and coalesce(pg_catalog.current_setting('chips.bot_only_lifecycle', true), '') = '1'
       and coalesce(pg_catalog.current_setting('chips.legacy_registry_keys_sha256', true), '') ~ '^[0-9a-f]{64}$'
       and public.chips_table_fence_is_active()
       and (
         select count(*)
           from public.chips_ledger_archive_batches batches
           join public.chips_legacy_stage_allowlist_proofs proofs
             on proofs.batch_id = batches.batch_id
          where batches.status = 'committed'
            and batches.committed_at is not null
            and batches.format_version = 2
            and batches.source_policy_id = 'legacy_stage_allowlist_v1'
            and proofs.source_policy_id = 'legacy_stage_allowlist_v1'
            and new.id = any(proofs.batch_table_ids)
       ) = 1
       and exists (
         select 1
           from public.chips_ledger_archive_batches batches
           join public.chips_legacy_stage_allowlist_proofs proofs
             on proofs.batch_id = batches.batch_id
           left join public.chips_legacy_stage_allowlist_runs runs
             on runs.run_id = batches.legacy_run_id
            and runs.plan_sha256 = batches.legacy_plan_sha256
          where batches.status = 'committed'
            and batches.committed_at is not null
            and batches.format_version = 2
            and batches.source_policy_id = 'legacy_stage_allowlist_v1'
            and batches.project_ref = 'krydukthwdvccggbyjfw'
            and batches.cutoff = '2026-08-17T16:51:28.074Z'::timestamptz
            and batches.legacy_allowlist_sha256 = '611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05'
            and batches.legacy_batch_table_ids_sha256 = proofs.batch_table_ids_sha256
            and batches.legacy_batch_number = proofs.batch_number
            and batches.legacy_batch_table_count = proofs.batch_table_count
            and public.chips_archive_uuid_ids_sha256(proofs.batch_table_ids) = proofs.batch_table_ids_sha256
            and batches.legacy_master_table_count = 974
            and batches.legacy_source_run = '32753223679'
            and batches.legacy_query_sha256 = '9bd27ff7a2749a879707e823982f708e6abf86beffcdf8f97c5deac05f00ca09'
            and batches.legacy_stage_system_identifier = '7656985631720456337'
            and proofs.project_ref = batches.project_ref
            and proofs.cutoff = batches.cutoff
            and proofs.master_table_count = 974
            and batches.legacy_master_table_ids is not null
            and batches.legacy_master_table_count = 974
            and proofs.master_table_ids is not distinct from batches.legacy_master_table_ids
            and public.chips_archive_uuid_ids_sha256(batches.legacy_master_table_ids) = batches.legacy_allowlist_sha256
            and public.chips_archive_uuid_ids_sha256(proofs.master_table_ids) = proofs.master_table_ids_sha256
            and proofs.master_table_ids_sha256 = batches.legacy_allowlist_sha256
            and pg_catalog.cardinality(proofs.master_table_ids) = 974
            and proofs.batch_table_ids is not null
            and new.id = any(proofs.batch_table_ids)
            and pg_catalog.num_nonnulls(
              batches.archived_transaction_ids_sha256,
              batches.archived_entry_ids_sha256,
              batches.archive_proof_verified_at
            ) = 3
            and batches.archived_transaction_ids_sha256 ~ '^[0-9a-f]{64}$'
            and batches.archived_entry_ids_sha256 ~ '^[0-9a-f]{64}$'
            and pg_catalog.num_nonnulls(
              batches.pruned_at,
              batches.pruned_transaction_count,
              batches.pruned_entry_count,
              batches.pruned_transaction_ids_sha256,
              batches.pruned_entry_ids_sha256
            ) = 5
            and batches.pruned_transaction_count = batches.transaction_count
            and batches.pruned_entry_count = batches.entry_count
            and batches.pruned_transaction_ids_sha256 = batches.archived_transaction_ids_sha256
            and batches.pruned_entry_ids_sha256 = batches.archived_entry_ids_sha256
            and pg_catalog.num_nonnulls(
              batches.registry_cleaned_at,
              batches.registry_cleaned_key_count,
              batches.registry_cleaned_keys_sha256
            ) = 3
            and batches.registry_cleaned_key_count = batches.transaction_count
            and batches.registry_cleaned_key_count > 0
            and batches.registry_cleaned_keys_sha256 ~ '^[0-9a-f]{64}$'
            and batches.registry_cleaned_keys_sha256 = pg_catalog.current_setting('chips.legacy_registry_keys_sha256', true)
            and (
              (
                batches.batch_id = 13
                and proofs.batch_number = 1
                and batches.legacy_batch_number = 1
                and batches.legacy_run_id is null
                and batches.legacy_plan_sha256 is null
                and batches.destructive_go_at is not null
                and batches.destructive_go_batch_id = 13
              ) or (
                batches.legacy_batch_number between 2 and 98
                and batches.legacy_run_id is not null
                and batches.legacy_plan_sha256 is not null
                and batches.destructive_go_at is not null
                and batches.destructive_go_batch_id = batches.batch_id
                and runs.status = 'authorized'
                and runs.project_ref = 'krydukthwdvccggbyjfw'
                and runs.source_policy_id = 'legacy_stage_allowlist_v1'
                and runs.stage_system_identifier = '7656985631720456337'
                and runs.cutoff = batches.cutoff
                and runs.cutoff = '2026-08-17T16:51:28.074Z'::timestamptz
                and runs.master_allowlist_sha256 = batches.legacy_allowlist_sha256
                and runs.master_manifest_sha256 = 'eb5593bdf5bd7f3c985373e6037a861d999413eae5076b923165c7f8147a79e7'
                and runs.remaining_table_ids_sha256 = 'a7bd1aea6bfe0435609cce6ccbe78f9ba55cab062e3cf55fd933fade5f029fc8'
                and runs.remaining_table_count = 964
                and runs.first_batch_number = 2
                and runs.last_batch_number = 98
                and runs.batch_count = 97
                and runs.plan_sha256 = 'f6521e7bb892c1ea3ddb566bed86bf7cac48cb305823c4c682957ef6db2d100b'
                and runs.destructive_go_at is not null
                and runs.destructive_go_confirmation = 'GO legacy-stage-allowlist-v1 remaining 2-98 ' || runs.plan_sha256
              )
            )
       )
       and not exists (
         with registry_rows as (
           select registry.table_id,
                  registry.idempotency_key,
                  case
                    when registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
                      then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 2)))
                    when registry.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
                      then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 3)))
                    when registry.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
                      then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 4)))
                    else null
                  end as key_table_id
             from public.chips_transaction_idempotency registry
         )
         select 1
           from registry_rows registry
          where registry.table_id = new.id
             or registry.key_table_id = new.id::text
       )
       and not exists (
         with table_transaction_metadata as materialized (
           select transactions.*,
                  case
                    when transactions.metadata is not null
                      and pg_catalog.jsonb_typeof(transactions.metadata) = 'object'
                      then transactions.metadata
                    when transactions.metadata is not null
                      and pg_catalog.jsonb_typeof(transactions.metadata) = 'string'
                      and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text)
                      then (transactions.metadata #>> '{}')::jsonb
                    else null::jsonb
                  end as normalized_metadata
             from public.chips_transactions transactions
            where transactions.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
         ), table_transactions as materialized (
           select metadata.*,
                  case
                    when metadata.normalized_metadata ? 'tableId'
                      and pg_catalog.lower(pg_catalog.btrim(metadata.normalized_metadata->>'tableId')) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                      then pg_catalog.lower(pg_catalog.btrim(metadata.normalized_metadata->>'tableId'))
                    else null
                  end as metadata_table_id,
                  case
                    when metadata.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(:.*)?$'
                      then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(metadata.reference, ':', 2)))
                    else null
                  end as reference_table_id,
                  case
                    when metadata.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
                      then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(metadata.idempotency_key, ':', 2)))
                    when metadata.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
                      then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(metadata.idempotency_key, ':', 3)))
                    when metadata.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
                      then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(metadata.idempotency_key, ':', 4)))
                    else null
                  end as key_table_id
             from table_transaction_metadata metadata
         )
         select 1
           from table_transactions transactions
          where transactions.metadata_table_id = new.id::text
             or transactions.reference_table_id = new.id::text
             or transactions.key_table_id = new.id::text
             or exists (
               select 1
                 from public.chips_transaction_idempotency registry
                where registry.transaction_id = transactions.id
                  and (
                    registry.table_id = new.id
                    or registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
                    and pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 2))) = new.id::text
                    or registry.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
                    and pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 3))) = new.id::text
                    or registry.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
                    and pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 4))) = new.id::text
                  )
             )
             or exists (
               select 1
                 from public.chips_entries entries
                 join public.chips_accounts accounts on accounts.id = entries.account_id
                where entries.transaction_id = transactions.id
                  and accounts.account_type::text = 'ESCROW'
                  and accounts.system_key = 'POKER_TABLE:' || new.id::text
             )
       )
       and not exists (
         select 1
           from public.chips_entries entries
           join public.chips_accounts accounts on accounts.id = entries.account_id
          where accounts.account_type::text = 'ESCROW'
            and accounts.system_key = 'POKER_TABLE:' || new.id::text
       )
       and (
         select count(*)
           from public.chips_accounts accounts
          where accounts.account_type::text = 'ESCROW'
            and accounts.system_key = 'POKER_TABLE:' || new.id::text
       ) = 1
       and (
         select count(*)
           from public.chips_accounts accounts
          where accounts.account_type::text = 'ESCROW'
            and accounts.system_key = 'POKER_TABLE:' || new.id::text
            and accounts.status::text = 'active'
            and accounts.balance = 0
       ) = 1 then
      null;
    else
      raise exception using errcode = 'P8907', message = 'bot-only table lifecycle marker transition is not authorized';
    end if;
  end if;
  return new;
end;
$$;

alter function public.chips_guard_poker_table_mutations() owner to postgres;

grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

create or replace function public.chips_prune_legacy_stage_allowlist_batch(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_batch_table_ids uuid[],
  p_allowlist_sha256 text,
  p_batch_table_ids_sha256 text,
  p_registry_keys text[],
  p_execute boolean default false,
  p_approved_batch_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  proof public.chips_legacy_stage_allowlist_proofs%rowtype;
  expected_registry_keys text[];
  actual_registry_keys text[];
  registry_keys_sha256 text;
  remaining_registry_count bigint;
  deleted_registry_count bigint;
  hot_transaction_count bigint;
  hot_entry_count bigint;
  existing_table_count bigint;
  unmarked_table_count bigint;
  marked_table_count bigint;
  updated_table_count bigint;
  result jsonb;
begin
  if p_execute is null
     or p_transaction_ids is null
     or p_entry_ids is null
     or p_registry_keys is null
     or p_batch_table_ids is null
     or pg_catalog.cardinality(p_batch_table_ids) not between 1 and 10
     or (select count(*) from pg_catalog.unnest(p_batch_table_ids) as ids(id))
        <> (select count(distinct id) from pg_catalog.unnest(p_batch_table_ids) as ids(id))
     or p_batch_table_ids is distinct from (
       select pg_catalog.array_agg(ids.id order by ids.id)
         from pg_catalog.unnest(p_batch_table_ids) as ids(id)
     )
     or pg_catalog.cardinality(p_registry_keys) < 1
     or pg_catalog.cardinality(p_registry_keys) <> pg_catalog.cardinality(p_transaction_ids)
     or (select count(*) from pg_catalog.unnest(p_registry_keys) as ids(id))
        <> (select count(distinct id) from pg_catalog.unnest(p_registry_keys) as ids(id))
     or p_registry_keys is distinct from (
       select pg_catalog.array_agg(ids.id order by ids.id)
         from pg_catalog.unnest(p_registry_keys) as ids(id)
     ) then
    raise exception using errcode = 'P8938', message = 'Legacy Stage registry key proof is invalid';
  end if;

  registry_keys_sha256 := public.chips_archive_text_ids_sha256(p_registry_keys);
  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.object_path = p_object_path
   for update;
  if not found
     or batch.source_policy_id <> 'legacy_stage_allowlist_v1'
     or batch.format_version <> 2
     or batch.project_ref <> 'krydukthwdvccggbyjfw'
     or batch.legacy_allowlist_sha256 is distinct from p_allowlist_sha256
     or batch.legacy_batch_table_ids_sha256 is distinct from p_batch_table_ids_sha256 then
    raise exception using errcode = 'P8934', message = 'Legacy Stage prune target is not exact';
  end if;

  select proofs.* into proof
    from public.chips_legacy_stage_allowlist_proofs proofs
   where proofs.batch_id = batch.batch_id;
  if not found
     or proof.master_table_ids_sha256 is distinct from p_allowlist_sha256
     or proof.batch_table_ids_sha256 is distinct from p_batch_table_ids_sha256
     or proof.batch_table_ids is distinct from p_batch_table_ids then
    raise exception using errcode = 'P8934', message = 'Legacy Stage prune proof is missing or differs';
  end if;

  if batch.pruned_at is not null then
    if pg_catalog.num_nonnulls(
         batch.archived_transaction_ids_sha256,
         batch.archived_entry_ids_sha256,
         batch.archive_proof_verified_at
       ) <> 3
       or batch.archived_transaction_ids_sha256 is distinct from public.chips_archive_uuid_ids_sha256(p_transaction_ids)
       or batch.archived_entry_ids_sha256 is distinct from public.chips_archive_bigint_ids_sha256(p_entry_ids)
       or batch.pruned_transaction_count is distinct from batch.transaction_count
       or batch.pruned_entry_count is distinct from batch.entry_count
       or batch.transaction_count <> pg_catalog.cardinality(p_transaction_ids)
       or batch.entry_count <> pg_catalog.cardinality(p_entry_ids)
       or batch.pruned_transaction_ids_sha256 is distinct from public.chips_archive_uuid_ids_sha256(p_transaction_ids)
       or batch.pruned_entry_ids_sha256 is distinct from public.chips_archive_bigint_ids_sha256(p_entry_ids)
       or batch.pruned_transaction_ids_sha256 is distinct from batch.archived_transaction_ids_sha256
       or batch.pruned_entry_ids_sha256 is distinct from batch.archived_entry_ids_sha256
       or batch.registry_cleaned_at is null
       or batch.registry_cleaned_key_count is distinct from pg_catalog.cardinality(p_registry_keys)
       or batch.registry_cleaned_keys_sha256 is distinct from registry_keys_sha256 then
      raise exception using errcode = 'P8934', message = 'Existing legacy Stage cleanup receipt differs';
    end if;

    select count(*) into remaining_registry_count
      from public.chips_transaction_idempotency registry
     where registry.archive_batch_id = batch.batch_id
        or registry.table_id = any(p_batch_table_ids)
        or registry.idempotency_key = any(p_registry_keys);
    with transaction_metadata as materialized (
      select transactions.*,
             case
               when transactions.metadata is not null
                 and pg_catalog.jsonb_typeof(transactions.metadata) = 'object'
                 then transactions.metadata
               when transactions.metadata is not null
                 and pg_catalog.jsonb_typeof(transactions.metadata) = 'string'
                 and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text)
                 then (transactions.metadata #>> '{}')::jsonb
               else null::jsonb
             end as normalized_metadata
        from public.chips_transactions transactions
    )
    select count(*) into hot_transaction_count
      from transaction_metadata transactions
     where transactions.id = any(p_transaction_ids)
        or (
          transactions.normalized_metadata ? 'tableId'
          and pg_catalog.lower(pg_catalog.btrim(transactions.normalized_metadata->>'tableId')) = any(
            select pg_catalog.lower(ids.id::text)
              from pg_catalog.unnest(p_batch_table_ids) as ids(id)
          )
        )
        or (
          transactions.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(:.*)?$'
          and pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.reference, ':', 2))) = any(
            select pg_catalog.lower(ids.id::text)
              from pg_catalog.unnest(p_batch_table_ids) as ids(id)
          )
        )
        or exists (
          select 1
            from public.chips_transaction_idempotency registry
           where registry.transaction_id = transactions.id
             and (
               registry.table_id = any(p_batch_table_ids)
               or (
                 registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
                 and pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 2))) = any(
                   select pg_catalog.lower(ids.id::text)
                     from pg_catalog.unnest(p_batch_table_ids) as ids(id)
                 )
               )
               or (
                 registry.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
                 and pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 3))) = any(
                   select pg_catalog.lower(ids.id::text)
                     from pg_catalog.unnest(p_batch_table_ids) as ids(id)
                 )
               )
               or (
                 registry.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
                 and pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 4))) = any(
                   select pg_catalog.lower(ids.id::text)
                     from pg_catalog.unnest(p_batch_table_ids) as ids(id)
                 )
               )
             )
        )
        or exists (
          select 1
            from public.chips_entries entries
            join public.chips_accounts accounts on accounts.id = entries.account_id
           where entries.transaction_id = transactions.id
             and accounts.account_type::text = 'ESCROW'
             and accounts.system_key = any(
               select 'POKER_TABLE:' || ids.id::text
                 from pg_catalog.unnest(p_batch_table_ids) as ids(id)
             )
        );
    select count(*) into hot_entry_count
      from public.chips_entries entries
     where entries.transaction_id = any(p_transaction_ids)
        or entries.id = any(p_entry_ids)
        or exists (
          select 1
            from public.chips_accounts accounts
           where accounts.id = entries.account_id
             and accounts.account_type::text = 'ESCROW'
             and accounts.system_key = any(
               select 'POKER_TABLE:' || ids.id::text
                 from pg_catalog.unnest(p_batch_table_ids) as ids(id)
             )
        );
    if remaining_registry_count <> 0 or hot_transaction_count <> 0 or hot_entry_count <> 0 then
      raise exception using errcode = 'P8938', message = 'Existing legacy Stage cleanup left hot ledger or registry rows';
    end if;

    if p_execute then
      select count(*) filter (where tables.bot_only_retention_complete_at is null),
             count(*)
        into unmarked_table_count, existing_table_count
        from public.poker_tables tables
       where tables.id = any(p_batch_table_ids);
      if unmarked_table_count > 0 then
        if p_approved_batch_id is distinct from batch.batch_id
           or batch.destructive_go_batch_id is distinct from batch.batch_id
           or batch.destructive_go_at is null then
          raise exception using errcode = 'P8935', message = 'Exact legacy Stage batch GO is required before lifecycle repair';
        end if;
        perform public.chips_lock_table_fence_for_legacy_cleanup();
        if not coalesce(public.chips_table_fence_is_active(), false) then
          raise exception using errcode = 'P8937', message = 'Active TABLE fence is required before legacy lifecycle repair';
        end if;
        perform pg_catalog.set_config('chips.bot_only_go', '1', true);
        perform pg_catalog.set_config('chips.legacy_stage_cleanup', '1', true);
        perform pg_catalog.set_config('chips.bot_only_prune', '1', true);
        perform pg_catalog.set_config('chips.bot_registry_cleanup', '1', true);
        perform pg_catalog.set_config('chips.bot_cleanup_receipt', '1', true);
        perform pg_catalog.set_config('chips.bot_only_lifecycle', '1', true);
        perform pg_catalog.set_config('chips.legacy_registry_keys_sha256', registry_keys_sha256, true);
        update public.poker_tables tables
           set bot_only_retention_complete_at = coalesce(
             tables.bot_only_retention_complete_at,
             pg_catalog.timezone('utc', pg_catalog.now())
           )
         where tables.id = any(p_batch_table_ids)
           and tables.bot_only_retention_complete_at is null;
        get diagnostics updated_table_count = row_count;
        if updated_table_count <> unmarked_table_count then
          raise exception using errcode = 'P8938', message = 'Legacy Stage lifecycle repair transition was not exact';
        end if;
        select count(*) filter (where tables.bot_only_retention_complete_at is null),
               count(*) filter (where tables.bot_only_retention_complete_at is not null),
               count(*)
          into unmarked_table_count, marked_table_count, existing_table_count
          from public.poker_tables tables
         where tables.id = any(p_batch_table_ids);
        if unmarked_table_count <> 0 or marked_table_count <> existing_table_count then
          raise exception using errcode = 'P8938', message = 'Legacy Stage lifecycle repair marker verification failed';
        end if;
      end if;
    end if;
    return pg_catalog.jsonb_build_object(
      'state', 'already_pruned',
      'mode', 'execute',
      'batch_id', batch.batch_id,
      'registry_keys', pg_catalog.cardinality(p_registry_keys),
      'registry_keys_sha256', registry_keys_sha256,
      'remaining_registry_count', remaining_registry_count
    );
  end if;

  perform public.chips_assert_legacy_stage_allowlist_batch(
    p_object_path, p_transaction_ids, p_entry_ids, p_batch_table_ids, proof.master_table_ids,
    p_allowlist_sha256, p_batch_table_ids_sha256, proof.master_table_count, proof.batch_number,
    proof.source_run, proof.query_sha256, proof.postgres_system_identifier, batch.cutoff
  );

  select count(*) into existing_table_count
    from public.poker_tables tables
   where tables.id = any(p_batch_table_ids);
  select count(*) into marked_table_count
    from public.poker_tables tables
   where tables.id = any(p_batch_table_ids)
     and tables.bot_only_retention_complete_at is not null;
  if existing_table_count <> pg_catalog.cardinality(p_batch_table_ids)
     or marked_table_count <> 0 then
    raise exception using errcode = 'P8938', message = 'Legacy Stage lifecycle table scope is not fresh';
  end if;

  select pg_catalog.array_agg(registry.idempotency_key order by registry.idempotency_key)
    into expected_registry_keys
    from public.chips_transaction_idempotency registry
   where registry.transaction_id = any(p_transaction_ids);
  if expected_registry_keys is distinct from p_registry_keys then
    raise exception using errcode = 'P8938', message = 'Legacy Stage registry key set differs from immutable proof';
  end if;

  if not p_execute then
    result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, false);
    return result || pg_catalog.jsonb_build_object(
      'state', 'ready',
      'mode', 'prepare-only',
      'batch_id', batch.batch_id,
      'registry_keys', pg_catalog.cardinality(p_registry_keys),
      'registry_keys_sha256', registry_keys_sha256,
      'remaining_registry_count', pg_catalog.cardinality(p_registry_keys)
    );
  end if;

  -- Serialize a fence toggle with the destructive section.  The explicit
  -- function call remains authoritative; the lock closes the race with the
  -- owner-controlled fence toggle.
  perform public.chips_lock_table_fence_for_legacy_cleanup();
  if not coalesce(public.chips_table_fence_is_active(), false) then
    raise exception using errcode = 'P8937', message = 'Active TABLE fence is required before legacy destructive cleanup';
  end if;
  if p_approved_batch_id is distinct from batch.batch_id
     or batch.destructive_go_batch_id is distinct from batch.batch_id
     or batch.destructive_go_at is null then
    raise exception using errcode = 'P8935', message = 'Exact legacy Stage batch GO is required before execution';
  end if;

  -- Re-establish the per-call proof contexts only after exact persisted GO and
  -- the active fence have been checked.
  perform pg_catalog.set_config('chips.bot_only_go', '1', true);
  perform pg_catalog.set_config('chips.legacy_stage_cleanup', '1', true);
  perform pg_catalog.set_config('chips.bot_only_prune', '1', true);
  result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, true);

  select pg_catalog.array_agg(registry.idempotency_key order by registry.idempotency_key)
    into actual_registry_keys
    from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id;
  if actual_registry_keys is distinct from p_registry_keys then
    raise exception using errcode = 'P8938', message = 'Legacy Stage mapped registry set differs from immutable proof';
  end if;

  perform pg_catalog.set_config('chips.bot_registry_cleanup', '1', true);
  delete from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id
     and registry.idempotency_key = any(p_registry_keys);
  get diagnostics deleted_registry_count = row_count;
  if deleted_registry_count <> pg_catalog.cardinality(p_registry_keys) then
    raise exception using errcode = 'P8938', message = 'Legacy Stage registry DELETE count mismatch';
  end if;

  select count(*) into remaining_registry_count
    from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id;
  if remaining_registry_count <> 0 then
    raise exception using errcode = 'P8938', message = 'Legacy Stage cleanup left registry mappings';
  end if;

  perform pg_catalog.set_config('chips.bot_cleanup_receipt', '1', true);
  update public.chips_ledger_archive_batches batches
     set registry_cleaned_at = pg_catalog.timezone('utc', pg_catalog.now()),
         registry_cleaned_key_count = pg_catalog.cardinality(p_registry_keys),
         registry_cleaned_keys_sha256 = registry_keys_sha256
   where batches.batch_id = batch.batch_id
     and batches.registry_cleaned_at is null;
  if not found then
    raise exception using errcode = 'P8938', message = 'Legacy Stage cleanup receipt transition was not unique';
  end if;

  -- The marker transition is the final lifecycle proof.  It is deliberately
  -- after the complete registry receipt and remains atomic with all deletes.
  perform pg_catalog.set_config('chips.bot_only_lifecycle', '1', true);
  perform pg_catalog.set_config('chips.legacy_registry_keys_sha256', registry_keys_sha256, true);
  update public.poker_tables tables
     set bot_only_retention_complete_at = coalesce(
       tables.bot_only_retention_complete_at,
       pg_catalog.timezone('utc', pg_catalog.now())
     )
   where tables.id = any(p_batch_table_ids)
     and tables.bot_only_retention_complete_at is null;
  get diagnostics updated_table_count = row_count;
  if updated_table_count <> pg_catalog.cardinality(p_batch_table_ids) then
    raise exception using errcode = 'P8938', message = 'Legacy Stage lifecycle marker transition was not exact';
  end if;

  select count(*) filter (where tables.bot_only_retention_complete_at is not null),
         count(*)
    into marked_table_count, existing_table_count
    from public.poker_tables tables
   where tables.id = any(p_batch_table_ids);
  if existing_table_count <> pg_catalog.cardinality(p_batch_table_ids)
     or marked_table_count <> pg_catalog.cardinality(p_batch_table_ids) then
    raise exception using errcode = 'P8938', message = 'Legacy Stage lifecycle marker verification failed';
  end if;

  return result || pg_catalog.jsonb_build_object(
    'state', 'pruned',
    'mode', 'execute',
    'batch_id', batch.batch_id,
    'registry_keys', deleted_registry_count,
    'registry_keys_sha256', registry_keys_sha256,
    'remaining_registry_count', remaining_registry_count,
    'lifecycle_table_count', marked_table_count
  );
end;
$$;

reset role;

alter function public.chips_prune_legacy_stage_allowlist_batch(
  text, uuid[], bigint[], uuid[], text, text, text[], boolean, bigint
) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_legacy_stage_allowlist_batch(
  text, uuid[], bigint[], uuid[], text, text, text[], boolean, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.chips_prune_legacy_stage_allowlist_batch(
  text, uuid[], bigint[], uuid[], text, text, text[], boolean, bigint
) to postgres;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

commit;
