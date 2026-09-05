-- Forward-only proof access-path correction.
-- 20260905170000 is already applied on shared Stage and remains immutable.
-- Split the transaction-field fallbacks by the existing leading tx_type index
-- key without changing any proof evidence or lifecycle semantics.
begin;

grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

do $patch$
declare
  definition text;
  patched text;
  source_branch text := E'      from public.chips_transactions transactions\n     where transactions.tx_type in (''TABLE_BUY_IN''::public.chips_tx_type, ''TABLE_CASH_OUT''::public.chips_tx_type)';
  source_branch_count integer;
  replacement text := $replacement$
  with table_transaction_rows as (
    -- Use the existing (tx_type, created_at) index as the leading-key access
    -- path before applying the historical field fallback predicates.
    select transactions.id,
           transactions.idempotency_key,
           transactions.reference,
           transactions.metadata
      from public.chips_transactions transactions
     where transactions.tx_type = 'TABLE_BUY_IN'::public.chips_tx_type

    union all

    select transactions.id,
           transactions.idempotency_key,
           transactions.reference,
           transactions.metadata
      from public.chips_transactions transactions
     where transactions.tx_type = 'TABLE_CASH_OUT'::public.chips_tx_type
  ), candidate_transaction_ids as (
$replacement$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamptz,uuid[],text[])'::pg_catalog.regprocedure
  ) into definition;

  source_branch_count := (
    pg_catalog.length(definition)
    - pg_catalog.length(pg_catalog.replace(definition, source_branch, ''))
  ) / pg_catalog.length(source_branch);

  if definition is null
     or pg_catalog.strpos(definition, '  with candidate_transaction_ids as (') < 1
     or source_branch_count <> 6 then
    raise exception 'bot-only proof transaction fallback shape changed; refusing tx_type access-path correction';
  end if;

  patched := pg_catalog.replace(
    definition,
    '  with candidate_transaction_ids as (',
    replacement
  );
  patched := pg_catalog.replace(
    patched,
    source_branch,
    E'      from table_transaction_rows transactions\n     where true'
  );

  if patched = definition
     or pg_catalog.strpos(patched, source_branch) > 0
     or pg_catalog.strpos(patched, '  with table_transaction_rows as (') < 1
     or pg_catalog.strpos(patched, 'where transactions.tx_type = ''TABLE_BUY_IN''::public.chips_tx_type') < 1
     or pg_catalog.strpos(patched, 'where transactions.tx_type = ''TABLE_CASH_OUT''::public.chips_tx_type') < 1
     or pg_catalog.strpos(patched, 'from table_transaction_rows transactions') < 1
     or pg_catalog.strpos(patched, 'from candidate_transaction_ids candidates') < 1
     or pg_catalog.strpos(patched, '  ), target_transaction_evidence as (') < 1 then
    raise exception 'bot-only proof tx_type access-path correction was not exact';
  end if;

  execute patched;
end;
$patch$;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;
commit;
