-- Forward-only access-path correction for Stage retention.
-- Applied migrations 20260905160000 and 20260905161000 remain immutable.
-- The proof replacement preserves the historical evidence branches and only
-- changes how candidate transaction IDs are found before the PK join.
begin;

-- Build the helper and replacement as the archive-pruner owner, following the
-- existing migration ACL pattern.  The migration runner is not assumed to be
-- able to SET ROLE until membership is granted in this transaction.
grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

-- The legacy metadata-string representation can contain malformed JSON.  Keep
-- that historical fallback fail-closed while giving the index a truly
-- immutable, deterministic expression to evaluate.
create or replace function public.chips_bot_proof_metadata_table_id(p_metadata jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  normalized jsonb;
begin
  if p_metadata is null then
    return null;
  end if;
  if pg_catalog.jsonb_typeof(p_metadata) = 'object' then
    return p_metadata->>'tableId';
  end if;
  if pg_catalog.jsonb_typeof(p_metadata) <> 'string' then
    return null;
  end if;
  begin
    normalized := (p_metadata #>> '{}')::jsonb;
  exception when others then
    return null;
  end;
  if pg_catalog.jsonb_typeof(normalized) = 'object' then
    return normalized->>'tableId';
  end if;
  return null;
end;
$function$;

revoke all on function public.chips_bot_proof_metadata_table_id(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.chips_bot_proof_metadata_table_id(jsonb) to chips_ledger_archive_pruner;

-- The transaction-field fallbacks are still required proof evidence.  These
-- narrow partial indexes let their independent UNION branches avoid the
-- global TABLE_BUY_IN/TABLE_CASH_OUT scan that the historical OR caused.
create index if not exists chips_transactions_bot_proof_idempotency_prefix_idx
  on public.chips_transactions (pg_catalog.lower(idempotency_key) text_pattern_ops)
  where tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type);

create index if not exists chips_transactions_bot_proof_reference_prefix_idx
  on public.chips_transactions (pg_catalog.lower(reference) text_pattern_ops)
  where tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type);

create index if not exists chips_transactions_bot_proof_metadata_table_id_idx
  on public.chips_transactions (
    pg_catalog.lower(pg_catalog.btrim(
      public.chips_bot_proof_metadata_table_id(metadata)
    ))
  )
  where tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type);

-- CREATE OR REPLACE FUNCTION public.chips_assert_bot_only_archive_proof_lifecycle_gate
-- is executed from the guarded definition below so every non-target proof
-- CTE and its exact lifecycle semantics remain byte-for-byte unchanged.
do $patch$
declare
  definition text;
  patched text;
  replacement text := $replacement$
  with candidate_transaction_ids as (
    -- Exact archive IDs use the chips_transactions primary key path.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.id = any(coalesce(p_transaction_ids, array[]::uuid[]))
       and transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)

    union

    -- Transaction idempotency-key evidence remains an independent indexed
    -- fallback path; the regex remains the authoritative exact validator.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(transactions.idempotency_key) like any (array[
         'join-buyin:' || p_table_id::text || ':%',
         'bot-seed-buyin:' || p_table_id::text || ':%',
         'managed-bot-seed-buyin:' || p_table_id::text || ':%'
       ])
       and transactions.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(transactions.idempotency_key) like any (array[
         'poker:leave:' || p_table_id::text || ':%',
         'poker:inactive_cleanup:' || p_table_id::text || ':%'
       ])
       and transactions.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(transactions.idempotency_key) like any (array[
         'poker:rebuy:v1:' || p_table_id::text || ':%',
         'poker:deferred-leave:v1:' || p_table_id::text || ':%',
         'poker:bot-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:human-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:bot-replacement-buyin:v1:' || p_table_id::text || ':%',
         'poker:managed-bot-top-up:v1:' || p_table_id::text || ':%'
       ])
       and transactions.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    -- Metadata tableId normalization is unchanged, but its expression is
    -- indexed independently from the other transaction-field fallbacks.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(pg_catalog.btrim(
         public.chips_bot_proof_metadata_table_id(transactions.metadata)
       )) = p_table_id::text
       and (
         (
           transactions.metadata is not null
           and pg_catalog.jsonb_typeof(transactions.metadata) = 'object'
           and transactions.metadata ? 'tableId'
           and nullif(pg_catalog.btrim(transactions.metadata->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           and pg_catalog.lower(pg_catalog.btrim(transactions.metadata->>'tableId')) = p_table_id::text
         )
         or (
           transactions.metadata is not null
           and pg_catalog.jsonb_typeof(transactions.metadata) = 'string'
           and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text)
           and pg_catalog.jsonb_typeof((transactions.metadata #>> '{}')::jsonb) = 'object'
           and ((transactions.metadata #>> '{}')::jsonb) ? 'tableId'
           and nullif(pg_catalog.btrim(((transactions.metadata #>> '{}')::jsonb)->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           and pg_catalog.lower(pg_catalog.btrim(((transactions.metadata #>> '{}')::jsonb)->>'tableId')) = p_table_id::text
         )
       )

    union

    -- Reference evidence is a separate indexed prefix path with the old
    -- case-insensitive reference grammar retained as the final check.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(transactions.reference) like any (array[
         'table:' || p_table_id::text || '%',
         'poker-rebuy:' || p_table_id::text || '%',
         'bot_seed_buy_in:' || p_table_id::text || '%',
         'bot_replacement_buy_in:' || p_table_id::text || '%',
         'managed_bot_top_up:' || p_table_id::text || '%'
       ])
       and transactions.reference ~* ('^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):' || p_table_id::text || '(:.*)?$')

    union

    -- Registry table binding is the selective indexed path.
    select registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and registry.table_id = p_table_id

    union

    -- NULL-table registry fallback remains exact and is constrained first by
    -- the existing table/tx_type registry access path.
    select registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and registry.table_id is null
       and pg_catalog.lower(registry.idempotency_key) like any (array[
         'join-buyin:' || p_table_id::text || ':%',
         'bot-seed-buyin:' || p_table_id::text || ':%',
         'managed-bot-seed-buyin:' || p_table_id::text || ':%',
         'poker:leave:' || p_table_id::text || ':%',
         'poker:inactive_cleanup:' || p_table_id::text || ':%',
         'poker:rebuy:v1:' || p_table_id::text || ':%',
         'poker:deferred-leave:v1:' || p_table_id::text || ':%',
         'poker:bot-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:human-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:bot-replacement-buyin:v1:' || p_table_id::text || ':%',
         'poker:managed-bot-top-up:v1:' || p_table_id::text || ':%'
       ])
       and registry.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    select registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and registry.table_id is null
       and pg_catalog.lower(registry.idempotency_key) like any (array[
         'poker:leave:' || p_table_id::text || ':%',
         'poker:inactive_cleanup:' || p_table_id::text || ':%'
       ])
       and registry.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    select registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and registry.table_id is null
       and pg_catalog.lower(registry.idempotency_key) like any (array[
         'poker:rebuy:v1:' || p_table_id::text || ':%',
         'poker:deferred-leave:v1:' || p_table_id::text || ':%',
         'poker:bot-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:human-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:bot-replacement-buyin:v1:' || p_table_id::text || ':%',
         'poker:managed-bot-top-up:v1:' || p_table_id::text || ':%'
       ])
       and registry.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    -- ESCROW entry evidence resolves the exact system account first and
    -- reaches transaction IDs through chips_entries_account_idx.
    select entries.transaction_id
      from public.chips_entries entries
      join public.chips_accounts accounts on accounts.id = entries.account_id
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
  ), target_transactions as (
    -- Only this final join reads transaction payload columns, and it is by
    -- the primary key over the deduplicated candidate ID set.
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
      from candidate_transaction_ids candidates
      join public.chips_transactions transactions on transactions.id = candidates.id
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
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
$replacement$;
  start_pos integer;
  marker_offset integer;
  marker_pos integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamptz,uuid[],text[])'::pg_catalog.regprocedure
  ) into definition;
  start_pos := pg_catalog.strpos(definition, 'with target_transactions as (');
  marker_offset := case
    when start_pos > 0 then pg_catalog.strpos(
      pg_catalog.substr(definition, start_pos),
      '  ), target_transaction_evidence as ('
    )
    else 0
  end;
  if definition is null
     or start_pos < 1
     or marker_offset < 1
     or pg_catalog.strpos(definition, 'transactions.idempotency_key ~*') < 1
     or pg_catalog.strpos(definition, 'public.chips_entries') < 1 then
    raise exception 'bot-only proof target CTE shape changed; refusing forward access-path replacement';
  end if;
  marker_pos := start_pos + marker_offset - 1;
  patched := pg_catalog.left(definition, start_pos - 1)
    || replacement
    || pg_catalog.substr(definition, marker_pos);
  if patched = definition
     or pg_catalog.strpos(patched, 'candidate_transaction_ids as (') < 1
     or pg_catalog.strpos(patched, 'from candidate_transaction_ids candidates') < 1
     or pg_catalog.strpos(patched, '  ), target_transaction_evidence as (') < 1 then
    raise exception 'bot-only proof access-path replacement was not exact';
  end if;
  execute patched;
end;
$patch$;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;
commit;
