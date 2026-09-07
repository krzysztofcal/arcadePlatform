begin;

-- A fresh automatic closed-human batch has durable registry rows before the
-- internal prune maps them to the archive batch.  Validate that complete
-- identity set first, while accepting only NULL (fresh) or this batch's own
-- mapping (already-pruned/idempotent).  The internal prune remains the only
-- place that performs the mapping and deletes hot rows.
do $patch$
declare
  definition text;
  patched text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_auto_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid)'::pg_catalog.regprocedure
  ) into definition;
  if definition is null then
    raise exception 'closed-human automatic prune function is required before P9273 binding patch';
  end if;

  patched := pg_catalog.replace(
    definition,
    $needle$  registry_count bigint;
  distinct_table_count bigint;
  null_table_count bigint;
  receipt_count integer;$needle$,
    $replacement$  registry_count bigint;
  distinct_transaction_count bigint;
  distinct_table_count bigint;
  null_table_count bigint;
  exact_table_count bigint;
  foreign_archive_mapping_count bigint;
  receipt_count integer;$replacement$
  );
  if patched = definition then
    raise exception 'closed-human automatic P9273 declaration shape changed; refusing patch';
  end if;

  patched := pg_catalog.replace(
    patched,
    $needle$  select pg_catalog.count(*),
         pg_catalog.count(distinct registry.table_id),
         pg_catalog.count(*) filter (where registry.table_id is null)
    into registry_count, distinct_table_count, null_table_count
    from public.chips_transaction_idempotency as registry
   where registry.transaction_id = any(p_transaction_ids)
     and registry.archive_batch_id = batch.batch_id;$needle$,
    $replacement$  select pg_catalog.count(*),
         pg_catalog.count(distinct registry.transaction_id),
         pg_catalog.count(distinct registry.table_id),
         pg_catalog.count(*) filter (where registry.table_id is null),
         pg_catalog.count(*) filter (where registry.table_id = p_table_id),
         pg_catalog.count(*) filter (
           where registry.archive_batch_id is not null
             and registry.archive_batch_id <> batch.batch_id
         )
    into registry_count, distinct_transaction_count, distinct_table_count,
         null_table_count, exact_table_count, foreign_archive_mapping_count
    from public.chips_transaction_idempotency as registry
   where registry.transaction_id = any(p_transaction_ids);$replacement$
  );
  if patched = definition
     or pg_catalog.strpos(patched, 'count(distinct registry.transaction_id)') = 0
     or pg_catalog.strpos(patched, 'where registry.transaction_id = any(p_transaction_ids);') = 0 then
    raise exception 'closed-human automatic P9273 query shape changed; refusing patch';
  end if;

  patched := pg_catalog.replace(
    patched,
    $needle$  if registry_count <> batch.transaction_count
     or distinct_table_count <> 1
     or null_table_count <> 0
     or not exists (
       select 1
         from public.chips_transaction_idempotency as registry
        where registry.transaction_id = any(p_transaction_ids)
          and registry.archive_batch_id = batch.batch_id
          and registry.table_id = p_table_id
     ) then$needle$,
    $replacement$  if registry_count <> batch.transaction_count
     or distinct_transaction_count <> batch.transaction_count
     or distinct_table_count <> 1
     or null_table_count <> 0
     or exact_table_count <> batch.transaction_count
     or foreign_archive_mapping_count <> 0 then$replacement$
  );
  if patched = definition
     or pg_catalog.strpos(patched, 'distinct_transaction_count') = 0
     or pg_catalog.strpos(patched, 'exact_table_count') = 0
     or pg_catalog.strpos(patched, 'foreign_archive_mapping_count') = 0
     or pg_catalog.strpos(patched, 'where registry.transaction_id = any(p_transaction_ids);') = 0
     or pg_catalog.strpos(patched, 'and registry.archive_batch_id = batch.batch_id') <> 0 then
    raise exception 'closed-human automatic P9273 guard shape changed; refusing patch';
  end if;

  execute patched;
end;
$patch$;

alter function public.chips_auto_prune_closed_human_table_archive_batch(text, uuid[], bigint[], uuid)
  owner to postgres;
revoke all on function public.chips_auto_prune_closed_human_table_archive_batch(text, uuid[], bigint[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.chips_auto_prune_closed_human_table_archive_batch(text, uuid[], bigint[], uuid)
  to postgres, chips_ledger_archive_pruner;

commit;
