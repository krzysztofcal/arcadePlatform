-- Forward-only access-path correction for the two escrow execute guards.
-- The exact strpos checks remain authoritative; the candidate-ID branches only
-- make the same evidence discoverable through selective trigram index paths.
-- No applied migration is modified.
begin;

create extension if not exists pg_trgm;

create index if not exists chips_transactions_reference_lower_trgm_idx
  on public.chips_transactions
  using gin ((lower(coalesce(reference, ''))) gin_trgm_ops);

create index if not exists chips_transactions_idempotency_key_lower_trgm_idx
  on public.chips_transactions
  using gin ((lower(coalesce(idempotency_key, ''))) gin_trgm_ops);

create index if not exists chips_transactions_metadata_lower_trgm_idx
  on public.chips_transactions
  using gin ((lower(coalesce(metadata::text, ''))) gin_trgm_ops);

-- Replace exactly the two identical mutable-state guards while preserving the
-- existing function signature, owner, SECURITY DEFINER attributes, and every
-- other fail-closed check in chips_retire_stage_escrow_accounts.
grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

do $patch$
declare
  definition text;
  patched text;
  occurrence_count integer;
  old_guard text := E'  select count(*) into transaction_count\n'
    || E'    from public.chips_transactions transactions\n'
    || E'   where exists (\n'
    || E'     select 1\n'
    || E'       from pg_catalog.unnest(table_ids) as wanted(table_id)\n'
    || E'      where pg_catalog.strpos(pg_catalog.lower(coalesce(transactions.reference, '''')), wanted.table_id::text) > 0\n'
    || E'         or pg_catalog.strpos(pg_catalog.lower(transactions.idempotency_key), wanted.table_id::text) > 0\n'
    || E'         or pg_catalog.strpos(pg_catalog.lower(transactions.metadata::text), wanted.table_id::text) > 0\n'
    || E'   );';
  replacement text := $replacement$
  with wanted as materialized (
    -- table_ids was already derived and validated by the existing exact
    -- archive/proof binding.  Keep that canonical set as the sole scope.
    select ids.table_id
      from pg_catalog.unnest(table_ids) as ids(table_id)
  ), candidate_transaction_ids as materialized (
    -- Each branch is an independent parameterized LIKE lookup.  The three
    -- expression GIN indexes make the field scans selective; UNION removes
    -- overlap before the exact primary-key validation below.
    select candidates.id
      from wanted
      cross join lateral (
        select transactions.id
          from public.chips_transactions transactions
         where pg_catalog.lower(coalesce(transactions.reference, ''))
               like '%' || wanted.table_id::text || '%'
      ) as candidates

    union

    select candidates.id
      from wanted
      cross join lateral (
        select transactions.id
          from public.chips_transactions transactions
         where pg_catalog.lower(coalesce(transactions.idempotency_key, ''))
               like '%' || wanted.table_id::text || '%'
      ) as candidates

    union

    select candidates.id
      from wanted
      cross join lateral (
        select transactions.id
          from public.chips_transactions transactions
         where pg_catalog.lower(coalesce(transactions.metadata::text, ''))
               like '%' || wanted.table_id::text || '%'
      ) as candidates
  ), target_transactions as (
    -- Rejoin by the transaction primary key, then repeat the historical
    -- strpos predicates exactly.  LIKE is only a candidate prefilter and
    -- cannot widen the accepted evidence or alter fail-closed behavior.
    select transactions.id
      from candidate_transaction_ids candidates
      join public.chips_transactions transactions
        on transactions.id = candidates.id
     where exists (
       select 1
         from wanted
        where pg_catalog.strpos(pg_catalog.lower(coalesce(transactions.reference, '')), wanted.table_id::text) > 0
           or pg_catalog.strpos(pg_catalog.lower(transactions.idempotency_key), wanted.table_id::text) > 0
           or pg_catalog.strpos(pg_catalog.lower(transactions.metadata::text), wanted.table_id::text) > 0
     )
  )
  select count(*) into transaction_count
    from target_transactions;
$replacement$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_retire_stage_escrow_accounts(bigint,uuid[],text,text,text,boolean,text)'::pg_catalog.regprocedure
  ) into definition;

  occurrence_count := (
    pg_catalog.length(definition)
    - pg_catalog.length(pg_catalog.replace(definition, old_guard, ''))
  ) / pg_catalog.length(old_guard);

  if definition is null or occurrence_count <> 2 then
    raise exception 'escrow execute guard shape changed: expected exactly two identical guards';
  end if;

  patched := pg_catalog.replace(definition, old_guard, replacement);
  if patched = definition
     or pg_catalog.strpos(patched, 'with wanted as materialized (') < 1
     or pg_catalog.strpos(patched, 'candidate_transaction_ids as materialized (') < 1
     or pg_catalog.strpos(patched, 'like ''%'' || wanted.table_id::text || ''%''') < 1
     or pg_catalog.strpos(patched, 'from candidate_transaction_ids candidates') < 1
     or pg_catalog.strpos(patched, 'pg_catalog.strpos(pg_catalog.lower(coalesce(transactions.reference, '''')), wanted.table_id::text) > 0') < 1
     or pg_catalog.strpos(patched, old_guard) > 0 then
    raise exception 'escrow execute candidate-ID correction was not exact';
  end if;

  execute patched;
end;
$patch$;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;
commit;
