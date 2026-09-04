begin;

-- #923 closed-human dry-run/prune evidence: the generic _internal prune
-- function keeps its SYSTEM<->ESCROW-only technical whitelist for the generic
-- policy.  For stage-ledger-closed-human-table-retention-30d-v1 it also
-- accepts the exact USER<->ESCROW shapes selected by
-- CLOSED_HUMAN_TABLE_CANDIDATE_SQL.  Branching is by the committed batch
-- source_policy_id, never by guessing from entries alone.  The public wrapper
-- chips_prune_committed_archive_batch is intentionally not replaced.
--
-- The replacement is owner-sensitive on hosted Postgres, so the migration
-- temporarily delegates to the existing pruner owner like earlier archive
-- migrations do.

grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

create or replace function public.chips_prune_committed_archive_batch_internal(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_execute boolean default false
)
returns jsonb
language plpgsql
security definer
strict
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  transaction_ids_sha256 text;
  entry_ids_sha256 text;
  transaction_count bigint := pg_catalog.cardinality(p_transaction_ids);
  entry_count bigint := pg_catalog.cardinality(p_entry_ids);
  receipt_field_count integer;
  is_closed_human boolean;
  registry_count bigint;
  matching_mapping_count bigint;
  wrong_mapping_count bigint;
  extra_mapping_count bigint;
  hot_transaction_count bigint;
  hot_entry_count bigint;
  actual_transaction_ids uuid[];
  actual_entry_ids bigint[];
  table_ids uuid[];
  account_ids uuid[];
  invalid_marker_count bigint;
  invalid_shape_count bigint;
  identity_mismatch_count bigint;
  active_table_count bigint;
  invalid_escrow_count bigint;
  user_transaction_count bigint;
  user_entry_count bigint;
  distinct_table_count bigint;
  actual_tx_types jsonb;
  actual_credits numeric;
  actual_debits numeric;
  actual_net numeric;
  actual_first_created_at timestamptz;
  actual_last_created_at timestamptz;
  actual_cursor_end_created_at timestamptz;
  actual_cursor_end_id uuid;
  accounts_before jsonb;
  accounts_after jsonb;
  mapped_count bigint;
  deleted_entry_count bigint;
  deleted_transaction_count bigint;
  receipt_count bigint;
begin
  perform public.chips_assert_archive_prune_stage();
  if pg_catalog.current_setting('transaction_isolation') <> 'serializable' then
    raise exception 'Ledger archive pruning requires SERIALIZABLE isolation';
  end if;
  if transaction_count between 1 and 5000 is not true or entry_count < 1 then
    raise exception 'Archive prune batch size is invalid';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.unnest(p_transaction_ids) as id)
      <> (select pg_catalog.count(distinct id) from pg_catalog.unnest(p_transaction_ids) as id)
    or (select pg_catalog.count(*) from pg_catalog.unnest(p_entry_ids) as id)
      <> (select pg_catalog.count(distinct id) from pg_catalog.unnest(p_entry_ids) as id) then
    raise exception 'Archive prune batch contains duplicate IDs';
  end if;

  transaction_ids_sha256 := public.chips_archive_uuid_ids_sha256(p_transaction_ids);
  entry_ids_sha256 := public.chips_archive_bigint_ids_sha256(p_entry_ids);

  select batches.*
    into batch
    from public.chips_ledger_archive_batches as batches
    where batches.object_path = p_object_path
    for update;
  if not found then raise exception 'Committed archive manifest was not found'; end if;
  if batch.status <> 'committed' or batch.project_ref not in ('krydukthwdvccggbyjfw', 'otbqfijerkieoxwpxjnm') then
    raise exception 'Archive manifest is not committed canonical target evidence';
  end if;
  is_closed_human := batch.source_policy_id = 'stage-ledger-closed-human-table-retention-30d-v1';
  perform public.chips_assert_archive_prune_target(batch.project_ref, transaction_count);
  if batch.archive_proof_verified_at is null then
    if p_execute then raise exception 'Archive ID proof must be registered before execute'; end if;
    return pg_catalog.jsonb_build_object('state', 'proof_missing');
  end if;
  if batch.archived_transaction_ids_sha256 is distinct from transaction_ids_sha256
    or batch.archived_entry_ids_sha256 is distinct from entry_ids_sha256
    or batch.transaction_count is distinct from transaction_count
    or batch.entry_count is distinct from entry_count then
    raise exception 'Archive prune IDs do not match immutable archive proof';
  end if;

  receipt_field_count := pg_catalog.num_nonnulls(
    batch.pruned_at,
    batch.pruned_transaction_count,
    batch.pruned_entry_count,
    batch.pruned_transaction_ids_sha256,
    batch.pruned_entry_ids_sha256
  );
  if receipt_field_count not in (0, 5) then
    raise exception 'Archive prune receipt is partial';
  end if;

  select pg_catalog.count(*) into registry_count
    from public.chips_transaction_idempotency as registry
    where registry.transaction_id = any(p_transaction_ids);
  select pg_catalog.count(*) into matching_mapping_count
    from public.chips_transaction_idempotency as registry
    where registry.transaction_id = any(p_transaction_ids)
      and registry.archive_batch_id = batch.batch_id;
  select pg_catalog.count(*) into wrong_mapping_count
    from public.chips_transaction_idempotency as registry
    where registry.transaction_id = any(p_transaction_ids)
      and registry.archive_batch_id is not null
      and registry.archive_batch_id <> batch.batch_id;
  select pg_catalog.count(*) into extra_mapping_count
    from public.chips_transaction_idempotency as registry
    where registry.archive_batch_id = batch.batch_id
      and not (registry.transaction_id = any(p_transaction_ids));
  select pg_catalog.count(*) into hot_transaction_count
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids);
  select pg_catalog.count(*) into hot_entry_count
    from public.chips_entries as entries
    where entries.transaction_id = any(p_transaction_ids)
       or entries.id = any(p_entry_ids);

  if receipt_field_count = 5 then
    if batch.pruned_transaction_count is distinct from transaction_count
      or batch.pruned_entry_count is distinct from entry_count
      or batch.pruned_transaction_ids_sha256 is distinct from transaction_ids_sha256
      or batch.pruned_entry_ids_sha256 is distinct from entry_ids_sha256
      or hot_transaction_count <> 0
      or hot_entry_count <> 0
      or registry_count <> transaction_count
      or matching_mapping_count <> transaction_count
      or wrong_mapping_count <> 0
      or extra_mapping_count <> 0 then
      raise exception 'Archive already-pruned state is inconsistent';
    end if;
    return pg_catalog.jsonb_build_object(
      'state', 'already_pruned',
      'transactions', transaction_count,
      'entries', entry_count
    );
  end if;

  if matching_mapping_count <> 0 or wrong_mapping_count <> 0 or extra_mapping_count <> 0 then
    raise exception 'Archive mappings exist without a complete prune receipt';
  end if;
  if hot_transaction_count <> transaction_count or hot_entry_count <> entry_count then
    raise exception 'Archive hot ledger batch is incomplete';
  end if;
  if registry_count <> transaction_count then
    raise exception 'Archive hot ledger batch has incomplete registry identity';
  end if;

  select pg_catalog.array_agg(transactions.id order by transactions.created_at, transactions.id)
    into actual_transaction_ids
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids);
  if actual_transaction_ids is distinct from p_transaction_ids then
    raise exception 'Archive transaction order does not match the hot ledger';
  end if;

  with wanted as (
    select ids.id, ids.ordinality
      from pg_catalog.unnest(p_transaction_ids) with ordinality as ids(id, ordinality)
  )
  select pg_catalog.array_agg(entries.id order by wanted.ordinality, entries.id)
    into actual_entry_ids
    from wanted
    join public.chips_entries as entries on entries.transaction_id = wanted.id;
  if actual_entry_ids is distinct from p_entry_ids then
    raise exception 'Archive entry order does not match the hot ledger';
  end if;

  with selected as (
    select transactions.*
      from public.chips_transactions as transactions
      where transactions.id = any(p_transaction_ids)
  ), markers as (
    select selected.id as transaction_id,
           pg_catalog.lower(nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '')) as table_id
      from selected
      where nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '') is not null
    union all
    select selected.id,
           case
             when pg_catalog.lower(selected.reference) like 'table:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             when pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             else null
           end
      from selected
      where pg_catalog.lower(selected.reference) like 'table:%'
         or pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
    union all
    select selected.id,
           pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.substr(accounts.system_key, 13)), ''))
      from selected
      join public.chips_entries as entries on entries.transaction_id = selected.id
      join public.chips_accounts as accounts on accounts.id = entries.account_id
      where accounts.account_type = 'ESCROW'
        and pg_catalog.upper(accounts.system_key) like 'POKER_TABLE:%'
  ), marker_summary as (
    select markers.transaction_id,
           pg_catalog.array_agg(distinct markers.table_id) filter (where markers.table_id is not null) as table_ids,
           pg_catalog.bool_or(
             markers.table_id is null
             or markers.table_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           ) as invalid_marker
      from markers
      group by markers.transaction_id
  )
  select pg_catalog.count(*)
    into invalid_marker_count
    from selected
    left join marker_summary on marker_summary.transaction_id = selected.id
    where coalesce(marker_summary.invalid_marker, false)
       or pg_catalog.cardinality(coalesce(marker_summary.table_ids, array[]::text[])) <> 1;
  if invalid_marker_count <> 0 then
    raise exception 'Archive batch contains missing, invalid, or ambiguous table markers';
  end if;

  with selected as (
    select transactions.*
      from public.chips_transactions as transactions
      where transactions.id = any(p_transaction_ids)
  ), markers as (
    select selected.id as transaction_id,
           pg_catalog.lower(nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '')) as table_id
      from selected
      where nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '') is not null
    union all
    select selected.id,
           case
             when pg_catalog.lower(selected.reference) like 'table:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             when pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             else null
           end
      from selected
      where pg_catalog.lower(selected.reference) like 'table:%'
         or pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
    union all
    select selected.id,
           pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.substr(accounts.system_key, 13)), ''))
      from selected
      join public.chips_entries as entries on entries.transaction_id = selected.id
      join public.chips_accounts as accounts on accounts.id = entries.account_id
      where accounts.account_type = 'ESCROW'
        and pg_catalog.upper(accounts.system_key) like 'POKER_TABLE:%'
  ), marker_summary as (
    select markers.transaction_id, pg_catalog.min(markers.table_id)::uuid as table_id
      from markers
      group by markers.transaction_id
  )
  select pg_catalog.array_agg(distinct marker_summary.table_id order by marker_summary.table_id)
    into table_ids
    from marker_summary;

  select pg_catalog.array_agg(distinct entries.account_id order by entries.account_id)
    into account_ids
    from public.chips_entries as entries
    where entries.transaction_id = any(p_transaction_ids);

  perform tables.id
    from public.poker_tables as tables
    where tables.id = any(table_ids)
    order by tables.id
    for update;
  perform accounts.id
    from public.chips_accounts as accounts
    where accounts.id = any(account_ids)
    order by accounts.id
    for update;
  perform registry.idempotency_key
    from public.chips_transaction_idempotency as registry
    where registry.transaction_id = any(p_transaction_ids)
    order by registry.transaction_id, registry.idempotency_key
    for update;
  perform transactions.id
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids)
    order by transactions.created_at, transactions.id
    for update;
  perform entries.id
    from pg_catalog.unnest(p_transaction_ids) with ordinality as wanted(id, ordinality)
    join public.chips_entries as entries on entries.transaction_id = wanted.id
    order by wanted.ordinality, entries.id
    for update of entries;

  select pg_catalog.count(*) into active_table_count
    from public.poker_tables as tables
    where tables.id = any(table_ids)
      and pg_catalog.upper(tables.status) <> 'CLOSED';
  select pg_catalog.count(*) into invalid_escrow_count
    from pg_catalog.unnest(table_ids) as table_id
    left join public.chips_accounts as accounts
      on accounts.account_type = 'ESCROW'
     and accounts.system_key = 'POKER_TABLE:' || table_id::text
    where accounts.id is null
       or accounts.status <> 'active'
       or accounts.balance <> 0;
  if active_table_count <> 0 or invalid_escrow_count <> 0 then
    raise exception 'Archive batch contains an active table or non-zero/missing escrow';
  end if;

  with selected as (
    select transactions.*
      from public.chips_transactions as transactions
      where transactions.id = any(p_transaction_ids)
  ), markers as (
    select selected.id as transaction_id,
           pg_catalog.lower(nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '')) as table_id
      from selected
      where nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '') is not null
    union all
    select selected.id,
           case
             when pg_catalog.lower(selected.reference) like 'table:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             when pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             else null
           end
      from selected
      where pg_catalog.lower(selected.reference) like 'table:%'
         or pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
    union all
    select selected.id,
           pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.substr(accounts.system_key, 13)), ''))
      from selected
      join public.chips_entries as entries on entries.transaction_id = selected.id
      join public.chips_accounts as accounts on accounts.id = entries.account_id
      where accounts.account_type = 'ESCROW'
        and pg_catalog.upper(accounts.system_key) like 'POKER_TABLE:%'
  ), marker_summary as (
    select markers.transaction_id, pg_catalog.min(markers.table_id) as table_id
      from markers
      group by markers.transaction_id
  ), invalid as (
    select selected.id
      from selected
      join marker_summary on marker_summary.transaction_id = selected.id
      join public.chips_entries as entries on entries.transaction_id = selected.id
      join public.chips_accounts as accounts on accounts.id = entries.account_id
      group by selected.id, selected.tx_type, selected.user_id, selected.created_at, marker_summary.table_id
      having selected.tx_type::text not in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
         or selected.created_at >= batch.cutoff
         or not (
           (
             selected.user_id is null
             and pg_catalog.count(*) = 2
             and pg_catalog.count(*) filter (where accounts.account_type = 'USER') = 0
             and pg_catalog.count(*) filter (where accounts.account_type = 'SYSTEM') = 1
             and pg_catalog.count(*) filter (where accounts.account_type = 'ESCROW') = 1
             and pg_catalog.count(*) filter (
                  where accounts.account_type = 'ESCROW'
                    and accounts.system_key = 'POKER_TABLE:' || marker_summary.table_id
                ) = 1
             and pg_catalog.bool_and(accounts.status = 'active')
             and pg_catalog.sum(entries.amount) = 0
             and (
               (selected.tx_type::text = 'TABLE_BUY_IN'
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'SYSTEM') < 0
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'ESCROW') > 0)
               or
               (selected.tx_type::text = 'TABLE_CASH_OUT'
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'ESCROW') < 0
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'SYSTEM') > 0)
             )
           )
           or
           (
             is_closed_human
             and selected.user_id is not null
             and pg_catalog.count(*) = 2
             and pg_catalog.count(*) filter (where accounts.account_type = 'USER') = 1
             and pg_catalog.count(*) filter (where accounts.account_type = 'SYSTEM') = 0
             and pg_catalog.count(*) filter (where accounts.account_type = 'ESCROW') = 1
             and pg_catalog.count(*) filter (
                  where accounts.account_type = 'ESCROW'
                    and accounts.system_key = 'POKER_TABLE:' || marker_summary.table_id
                ) = 1
             and pg_catalog.count(*) filter (
                  where accounts.account_type = 'USER'
                    and accounts.user_id = selected.user_id
                ) = 1
             and pg_catalog.bool_and(accounts.status = 'active')
             and pg_catalog.sum(entries.amount) = 0
             and (
               (selected.tx_type::text = 'TABLE_BUY_IN'
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'USER') < 0
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'ESCROW') > 0)
               or
               (selected.tx_type::text = 'TABLE_CASH_OUT'
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'ESCROW') < 0
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'USER') > 0)
             )
           )
         )
  )
  select pg_catalog.count(*) into invalid_shape_count from invalid;
  if invalid_shape_count <> 0 then
    raise exception 'Archive batch is outside the technical TABLE_BUY_IN/TABLE_CASH_OUT whitelist';
  end if;

  select pg_catalog.count(*) into identity_mismatch_count
    from public.chips_transactions as transactions
    left join public.chips_transaction_idempotency as registry
      on registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
     and registry.payload_hash = transactions.payload_hash
     and registry.tx_type = transactions.tx_type
     and registry.user_id is not distinct from transactions.user_id
     and registry.transaction_created_at = transactions.created_at
    where transactions.id = any(p_transaction_ids)
      and registry.idempotency_key is null;
  if identity_mismatch_count <> 0 then
    raise exception 'Archive batch registry identity is incomplete or inconsistent';
  end if;

  select pg_catalog.count(*) into user_transaction_count
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids) and transactions.user_id is not null;
  select pg_catalog.count(*) into user_entry_count
    from public.chips_entries as entries
    join public.chips_accounts as accounts on accounts.id = entries.account_id
    where entries.transaction_id = any(p_transaction_ids) and accounts.account_type = 'USER';
  distinct_table_count := pg_catalog.cardinality(table_ids);

  select pg_catalog.jsonb_object_agg(types.tx_type, types.count order by types.tx_type)
    into actual_tx_types
    from (
      select transactions.tx_type::text as tx_type, pg_catalog.count(*) as count
        from public.chips_transactions as transactions
        where transactions.id = any(p_transaction_ids)
        group by transactions.tx_type::text
    ) as types;
  select
    coalesce(pg_catalog.sum(case when entries.amount > 0 then entries.amount else 0 end), 0),
    coalesce(pg_catalog.sum(case when entries.amount < 0 then -entries.amount else 0 end), 0),
    coalesce(pg_catalog.sum(entries.amount), 0)
    into actual_credits, actual_debits, actual_net
    from public.chips_entries as entries
    where entries.transaction_id = any(p_transaction_ids);
  select pg_catalog.min(transactions.created_at), pg_catalog.max(transactions.created_at)
    into actual_first_created_at, actual_last_created_at
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids);
  select transactions.created_at, transactions.id
    into actual_cursor_end_created_at, actual_cursor_end_id
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids)
    order by transactions.created_at desc, transactions.id desc
    limit 1;

  if actual_tx_types is distinct from batch.tx_types
    or actual_credits is distinct from batch.credits
    or actual_debits is distinct from batch.debits
    or actual_net is distinct from batch.net_amount
    or actual_first_created_at is distinct from batch.first_created_at
    or actual_last_created_at is distinct from batch.last_created_at
    or actual_cursor_end_created_at is distinct from batch.cursor_end_created_at
    or actual_cursor_end_id is distinct from batch.cursor_end_id
    or (not is_closed_human and (user_transaction_count <> 0 or user_entry_count <> 0)) then
    raise exception 'Archive hot ledger aggregates do not match committed evidence';
  end if;

  select pg_catalog.jsonb_object_agg(
           accounts.id::text,
           pg_catalog.jsonb_build_array(accounts.balance::text, accounts.next_entry_seq::text)
           order by accounts.id::text
         )
    into accounts_before
    from public.chips_accounts as accounts
    where accounts.id = any(account_ids);

  if not p_execute then
    return pg_catalog.jsonb_build_object(
      'state', 'ready',
      'transactions', transaction_count,
      'entries', entry_count,
      'tx_types', actual_tx_types,
      'credits', actual_credits::text,
      'debits', actual_debits::text,
      'net', actual_net::text,
      'user_transactions', user_transaction_count,
      'user_entries', user_entry_count,
      'distinct_tables', distinct_table_count
    );
  end if;

  update public.chips_transaction_idempotency as registry
     set archive_batch_id = batch.batch_id
    from public.chips_transactions as transactions
   where transactions.id = any(p_transaction_ids)
     and registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
     and registry.payload_hash = transactions.payload_hash
     and registry.tx_type = transactions.tx_type
     and registry.user_id is not distinct from transactions.user_id
     and registry.transaction_created_at = transactions.created_at
     and registry.archive_batch_id is null;
  get diagnostics mapped_count = row_count;
  if mapped_count <> transaction_count then raise exception 'Archive registry mapping count mismatch'; end if;

  delete from public.chips_entries as entries
    where entries.id = any(p_entry_ids)
      and entries.transaction_id = any(p_transaction_ids);
  get diagnostics deleted_entry_count = row_count;
  if deleted_entry_count <> entry_count then raise exception 'Archive entry DELETE count mismatch'; end if;

  delete from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids);
  get diagnostics deleted_transaction_count = row_count;
  if deleted_transaction_count <> transaction_count then raise exception 'Archive transaction DELETE count mismatch'; end if;

  select pg_catalog.jsonb_object_agg(
           accounts.id::text,
           pg_catalog.jsonb_build_array(accounts.balance::text, accounts.next_entry_seq::text)
           order by accounts.id::text
         )
    into accounts_after
    from public.chips_accounts as accounts
    where accounts.id = any(account_ids);
  if accounts_after is distinct from accounts_before then
    raise exception 'Archive pruning changed account balances or entry sequences';
  end if;
  if exists (select 1 from public.chips_transactions where id = any(p_transaction_ids))
    or exists (
      select 1 from public.chips_entries
       where transaction_id = any(p_transaction_ids) or id = any(p_entry_ids)
    ) then
    raise exception 'Archive pruning left hot ledger rows behind';
  end if;

  update public.chips_ledger_archive_batches as batches
     set pruned_at = pg_catalog.timezone('utc', pg_catalog.now()),
         pruned_transaction_count = batches.transaction_count,
         pruned_entry_count = batches.entry_count,
         pruned_transaction_ids_sha256 = batches.archived_transaction_ids_sha256,
         pruned_entry_ids_sha256 = batches.archived_entry_ids_sha256
   where batches.batch_id = batch.batch_id
     and batches.pruned_at is null;
  get diagnostics receipt_count = row_count;
  if receipt_count <> 1 then raise exception 'Archive prune receipt transition was not unique'; end if;

  return pg_catalog.jsonb_build_object(
    'state', 'pruned',
    'transactions', deleted_transaction_count,
    'entries', deleted_entry_count,
    'tx_types', actual_tx_types,
    'credits', actual_credits::text,
    'debits', actual_debits::text,
    'net', actual_net::text,
    'user_transactions', user_transaction_count,
    'user_entries', user_entry_count,
    'distinct_tables', distinct_table_count
  );
end;
$$;


reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;
commit;
