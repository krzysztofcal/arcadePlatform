-- Forward-only bot-only proof candidate access-path correction.
-- Applied proof and lifecycle migrations remain immutable.  Replace only the
-- broad shared transaction CTE with equivalent independent candidate branches
-- so the existing chips_transactions trigram indexes can be used.
begin;

grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

do $patch$
declare
  definition text;
  patched text;
  old_source_branch text := E'      from table_transaction_rows transactions\n     where true';
  source_branch_count integer;
  start_pos integer;
  marker_offset integer;
  marker_pos integer;
  replacement text := $replacement$
  with candidate_transaction_ids as (
    -- Exact archive IDs use the chips_transactions primary-key path.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.id = any(coalesce(p_transaction_ids, array[]::uuid[]))
       and transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)

    union

    -- The regex remains the authoritative key validator.  LIKE is only a
    -- selective prefilter for the existing lower(idempotency_key) trigram
    -- access path.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.idempotency_key, '')) like any (array[
         'join-buyin:' || p_table_id::text || ':%',
         'bot-seed-buyin:' || p_table_id::text || ':%',
         'managed-bot-seed-buyin:' || p_table_id::text || ':%'
       ])
       and transactions.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.idempotency_key, '')) like any (array[
         'poker:leave:' || p_table_id::text || ':%',
         'poker:inactive_cleanup:' || p_table_id::text || ':%'
       ])
       and transactions.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.idempotency_key, '')) like any (array[
         'poker:rebuy:v1:' || p_table_id::text || ':%',
         'poker:deferred-leave:v1:' || p_table_id::text || ':%',
         'poker:bot-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:human-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:bot-replacement-buyin:v1:' || p_table_id::text || ':%',
         'poker:managed-bot-top-up:v1:' || p_table_id::text || ':%'
       ])
       and transactions.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    -- Metadata LIKE is only a candidate prefilter.  The historical JSON
    -- object checks remain the authoritative validator below it.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.metadata::text, '')) like '%' || p_table_id::text || '%'
       and transactions.metadata is not null
       and pg_catalog.jsonb_typeof(transactions.metadata) = 'object'
       and transactions.metadata ? 'tableId'
       and nullif(pg_catalog.btrim(transactions.metadata->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and pg_catalog.lower(pg_catalog.btrim(transactions.metadata->>'tableId')) = p_table_id::text

    union

    -- Keep safe validation for string-encoded JSON; the metadata trigram
    -- prefilter cannot widen this exact evidence branch.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.metadata::text, '')) like '%' || p_table_id::text || '%'
       and transactions.metadata is not null
       and pg_catalog.jsonb_typeof(transactions.metadata) = 'string'
       and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text)
       and pg_catalog.jsonb_typeof((transactions.metadata #>> '{}')::jsonb) = 'object'
       and ((transactions.metadata #>> '{}')::jsonb) ? 'tableId'
       and nullif(pg_catalog.btrim(((transactions.metadata #>> '{}')::jsonb)->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and pg_catalog.lower(pg_catalog.btrim(((transactions.metadata #>> '{}')::jsonb)->>'tableId')) = p_table_id::text

    union

    -- The old case-insensitive reference grammar remains the authoritative
    -- check after the existing lower(reference) trigram prefilter.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.reference, '')) like any (array[
         'table:' || p_table_id::text || '%',
         'poker-rebuy:' || p_table_id::text || '%',
         'bot_seed_buy_in:' || p_table_id::text || '%',
         'bot_replacement_buy_in:' || p_table_id::text || '%',
         'managed_bot_top_up:' || p_table_id::text || '%'
       ])
       and transactions.reference ~* ('^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):' || p_table_id::text || '(:.*)?$')

    union

    -- Registry table binding remains an independent exact evidence branch.
    select registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and registry.table_id = p_table_id

    union

    -- Registry NULL-table key branches are intentionally unchanged here;
    -- escrow registry chunking is a separate follow-up.
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
    -- reaches transaction IDs through the existing entries access path.
    select entries.transaction_id
      from public.chips_entries entries
      join public.chips_accounts accounts on accounts.id = entries.account_id
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
$replacement$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamptz,uuid[],text[])'::pg_catalog.regprocedure
  ) into definition;

  source_branch_count := (
    pg_catalog.length(definition)
    - pg_catalog.length(pg_catalog.replace(definition, old_source_branch, ''))
  ) / pg_catalog.length(old_source_branch);
  start_pos := pg_catalog.strpos(definition, '  with table_transaction_rows as (');
  marker_offset := case
    when start_pos > 0 then pg_catalog.strpos(
      pg_catalog.substr(definition, start_pos),
      '  ), target_transactions as ('
    )
    else 0
  end;

  if definition is null
     or start_pos < 1
     or marker_offset < 1
     or source_branch_count <> 6
     or pg_catalog.strpos(definition, '  ), target_transaction_evidence as (') < 1
     or pg_catalog.strpos(definition, 'unknown_registry_rows as (') < 1
     or pg_catalog.strpos(definition, 'hot_identity_rows as (') < 1 then
    raise exception 'bot-only proof candidate shape changed; refusing query-shape correction';
  end if;

  marker_pos := start_pos + marker_offset - 1;
  patched := pg_catalog.left(definition, start_pos - 1)
    || replacement
    || pg_catalog.substr(definition, marker_pos);

  if patched = definition
     or pg_catalog.strpos(patched, 'table_transaction_rows') > 0
     or pg_catalog.strpos(patched, 'from candidate_transaction_ids candidates') < 1
     or pg_catalog.strpos(patched, 'pg_catalog.lower(coalesce(transactions.idempotency_key, '''')) like any') < 1
     or pg_catalog.strpos(patched, 'pg_catalog.lower(coalesce(transactions.metadata::text, '''')) like ''%'' || p_table_id::text || ''%''') < 1
     or pg_catalog.strpos(patched, 'pg_catalog.lower(coalesce(transactions.reference, '''')) like any') < 1
     or pg_catalog.strpos(patched, 'transactions.idempotency_key ~*') < 1
     or pg_catalog.strpos(patched, 'jsonb_typeof(transactions.metadata) = ''object''') < 1
     or pg_catalog.strpos(patched, 'transactions.reference ~*') < 1
     or pg_catalog.strpos(patched, '  ), target_transaction_evidence as (') < 1
     or pg_catalog.strpos(patched, 'unknown_registry_rows as (') < 1
     or pg_catalog.strpos(patched, 'hot_identity_rows as (') < 1 then
    raise exception 'bot-only proof candidate query-shape correction was not exact';
  end if;

  execute patched;
end;
$patch$;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;
commit;
