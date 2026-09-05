begin;

-- The one-time activation function must consume the durable canary evidence
-- left after pruning.  In particular, it must not reconstruct a successful
-- canary from hot transaction or entry rows that the canary intentionally
-- removed.  Patch the already-applied function exactly; a changed function
-- shape fails the migration closed instead of silently widening activation.
do $patch$
declare
  definition text;
  patched text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_activate_closed_human_table_retention_policy(bigint,text)'::pg_catalog.regprocedure
  ) into definition;
  if definition is null then
    raise exception 'closed-human activation function is required before post-prune patch';
  end if;

  patched := pg_catalog.replace(
    definition,
    $needle$  transaction_ids uuid[];
  entry_ids bigint[];
  registry_count bigint;
  distinct_table_count bigint;
  null_table_count bigint;
  receipt_count integer;
  cleanup_count integer;
  table_count bigint;
  dry_result jsonb;$needle$,
    $replacement$  registry_count bigint;
  distinct_table_count bigint;
  null_table_count bigint;
  exact_table_count bigint;
  receipt_count integer;
  cleanup_count integer;
  table_count bigint;$replacement$
  );
  if patched = definition then
    raise exception 'closed-human activation declaration shape changed; refusing post-prune patch';
  end if;

  patched := pg_catalog.replace(
    patched,
    $needle$  select pg_catalog.array_agg(registry.transaction_id order by transactions.created_at, transactions.id),
         pg_catalog.count(*),
         pg_catalog.count(distinct registry.table_id),
         pg_catalog.count(*) filter (where registry.table_id is null)
    into transaction_ids, registry_count, distinct_table_count, null_table_count
    from public.chips_transaction_idempotency as registry
    join public.chips_transactions as transactions on transactions.id = registry.transaction_id
   where registry.archive_batch_id = 334;
  if registry_count <> canary.transaction_count
     or distinct_table_count <> 1
     or null_table_count <> 0
     or not exists (
       select 1
         from public.chips_transaction_idempotency as registry
        where registry.archive_batch_id = 334
          and registry.table_id = 'ec3f4897-c7bb-4d92-b63d-a38401e9a5c4'::uuid
     ) then
    raise exception using errcode = 'P9264', message = 'Automatic Stage canary registry binding is not exact';
  end if;

  select pg_catalog.array_agg(entries.id order by wanted.ordinality, entries.id)
    into entry_ids
    from pg_catalog.unnest(transaction_ids) with ordinality as wanted(id, ordinality)
    join public.chips_entries as entries on entries.transaction_id = wanted.id;
  if pg_catalog.cardinality(entry_ids) <> canary.entry_count then
    raise exception using errcode = 'P9264', message = 'Automatic Stage canary entry binding is not exact';
  end if;$needle$,
    $replacement$  select pg_catalog.count(*),
         pg_catalog.count(distinct registry.table_id),
         pg_catalog.count(*) filter (where registry.table_id is null),
         pg_catalog.count(*) filter (
           where registry.table_id = 'ec3f4897-c7bb-4d92-b63d-a38401e9a5c4'::uuid
         )
    into registry_count, distinct_table_count, null_table_count, exact_table_count
    from public.chips_transaction_idempotency as registry
   where registry.archive_batch_id = 334;
  if registry_count <> canary.transaction_count
     or distinct_table_count <> 1
     or null_table_count <> 0
     or exact_table_count <> canary.transaction_count then
    raise exception using errcode = 'P9264', message = 'Automatic Stage canary durable registry binding is not exact';
  end if;$replacement$
  );
  if patched = definition
     or pg_catalog.strpos(patched, 'chips_transactions as transactions') <> 0
     or pg_catalog.strpos(patched, 'chips_entries as entries') <> 0
     or pg_catalog.strpos(patched, 'exact_table_count') = 0 then
    raise exception 'closed-human activation hot-ledger binding shape changed; refusing post-prune patch';
  end if;

  patched := pg_catalog.replace(
    patched,
    $needle$  dry_result := public.chips_prune_closed_human_table_archive_batch(
    canary.object_path,
    transaction_ids,
    entry_ids,
    'ec3f4897-c7bb-4d92-b63d-a38401e9a5c4'::uuid,
    false,
    null
  );
  if dry_result->>'state' is distinct from 'already_pruned'
     or dry_result->>'table_id' is distinct from 'ec3f4897-c7bb-4d92-b63d-a38401e9a5c4' then
    raise exception using errcode = 'P9267', message = 'Automatic Stage policy activation requires a complete canary dry-run';
  end if;$needle$,
    $replacement$  -- Proof, the complete prune receipt, and the lifecycle gate above
  -- are the durable activation evidence.  The canary's hot ledger rows are
  -- intentionally absent after successful pruning, so activation does not
  -- invoke the prune wrapper or reconstruct deleted transaction/entry IDs.$replacement$
  );
  if patched = definition
     or pg_catalog.strpos(patched, 'chips_prune_closed_human_table_archive_batch(') <> 0
     or pg_catalog.strpos(patched, 'Automatic Stage policy activation requires a complete canary dry-run') <> 0 then
    raise exception 'closed-human activation dry-run shape changed; refusing post-prune patch';
  end if;

  execute patched;
end;
$patch$;

alter function public.chips_activate_closed_human_table_retention_policy(bigint, text)
  owner to postgres;
revoke all on function public.chips_activate_closed_human_table_retention_policy(bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.chips_activate_closed_human_table_retention_policy(bigint, text)
  to postgres;

commit;
