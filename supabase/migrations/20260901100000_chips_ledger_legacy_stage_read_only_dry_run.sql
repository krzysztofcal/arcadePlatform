begin;

-- Forward-only hardening for the legacy Stage allowlist path.
--
-- The legacy functions below have already accumulated several independent
-- proof and lifecycle hardenings.  Re-copying those large SECURITY DEFINER
-- bodies here would make this migration easy to drift from the applied
-- contract.  Instead, patch only the lock-bearing statements in the exact
-- applied definitions and abort if the expected shape is not present.  The
-- resulting functions retain their existing owners, grants, validation and
-- execute branches.

-- The exact batch function is owned by the pruner role, while the
-- orchestrated wrapper is owned by postgres.  Apply each replacement under
-- its existing owner context so this remains compatible with hosted
-- migrations where postgres is not the function owner.
grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

do $migration$
declare
  original_definition text;
  patched_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_assert_legacy_stage_allowlist_batch(text,uuid[],bigint[],uuid[],uuid[],text,text,bigint,bigint,text,text,text,timestamptz)'::pg_catalog.regprocedure
  ) into original_definition;
  if original_definition is null then
    raise exception 'legacy Stage assertion function is missing';
  end if;

  patched_definition := pg_catalog.regexp_replace(
    original_definition,
    $pattern$(select batches\.\* into batch\s+from public\.chips_ledger_archive_batches batches\s+where batches\.object_path = p_object_path\s+)(for update;)$pattern$,
    $replacement$if pg_catalog.current_setting('transaction_read_only') = 'on' then
    \1;
  else
    \1\2
  end if;$replacement$,
    1,
    1,
    'n'
  );
  if patched_definition = original_definition then
    raise exception 'legacy Stage assertion lock shape changed; refusing a blind migration';
  end if;
  execute patched_definition;
end;
$migration$;

do $migration$
declare
  original_definition text;
  patched_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_prune_legacy_stage_allowlist_batch(text,uuid[],bigint[],uuid[],text,text,text[],boolean,bigint)'::pg_catalog.regprocedure
  ) into original_definition;
  if original_definition is null then
    raise exception 'legacy Stage batch pruner function is missing';
  end if;

  -- The manifest row is locked only by execute.  The read-only branch reads
  -- the same row from its REPEATABLE READ snapshot.
  patched_definition := pg_catalog.regexp_replace(
    original_definition,
    $pattern$(select batches\.\* into batch\s+from public\.chips_ledger_archive_batches batches\s+where batches\.object_path = p_object_path\s+)(for update;)$pattern$,
    $replacement$if p_execute then
    \1\2
  else
    \1;
  end if;$replacement$,
    1,
    1,
    'n'
  );
  if patched_definition = original_definition then
    raise exception 'legacy Stage batch manifest lock shape changed; refusing a blind migration';
  end if;

  -- The exact legacy assertion above is the complete dry-run validation.  Do
  -- not call the generic pruner in the read-only branch: it intentionally
  -- takes deterministic row locks for execute.  The execute call remains
  -- unchanged and still uses that function with p_execute=true.
  patched_definition := pg_catalog.replace(
    patched_definition,
    '  perform public.chips_assert_legacy_stage_allowlist_batch(',
    '  result := public.chips_assert_legacy_stage_allowlist_batch('
  );
  patched_definition := pg_catalog.replace(
    patched_definition,
    '    result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, false);',
    '    null;'
  );
  if pg_catalog.strpos(
       patched_definition,
       '  result := public.chips_assert_legacy_stage_allowlist_batch('
     ) = 0
     or pg_catalog.strpos(
       patched_definition,
       '    result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, false);'
     ) <> 0 then
    raise exception 'legacy Stage batch read-only branch shape changed; refusing a blind migration';
  end if;
  execute patched_definition;
end;
$migration$;

reset role;

-- The wrapper is owned by postgres; keep the owner context used by the
-- previously applied orchestration migration for this replacement.

do $migration$
declare
  original_definition text;
  patched_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_prune_legacy_stage_allowlist_orchestrated_batch(bigint,text,text,uuid[],bigint[],uuid[],text,text,text[],boolean)'::pg_catalog.regprocedure
  ) into original_definition;
  if original_definition is null then
    raise exception 'legacy Stage orchestrated pruner function is missing';
  end if;

  -- The run and manifest locks are retained for execute but are not taken by
  -- p_execute=false.  In both branches the inner exact-batch function is
  -- responsible for the same proof validation as before.
  patched_definition := pg_catalog.regexp_replace(
    original_definition,
    $pattern$(select runs\.\* into run_row\s+from public\.chips_legacy_stage_allowlist_runs runs\s+where runs\.run_id = p_run_id\s+and runs\.status = 'authorized'\s+and runs\.plan_sha256 = p_plan_sha256\s+and runs\.project_ref = 'krydukthwdvccggbyjfw'\s+)(for share;)$pattern$,
    $replacement$if p_execute then
    \1\2
  else
    \1;
  end if;$replacement$,
    1,
    1,
    'n'
  );
  if patched_definition = original_definition then
    raise exception 'legacy Stage orchestration run lock shape changed; refusing a blind migration';
  end if;
  original_definition := patched_definition;
  patched_definition := pg_catalog.regexp_replace(
    patched_definition,
    $pattern$(select batches\.\* into batch\s+from public\.chips_ledger_archive_batches batches\s+where batches\.object_path = p_object_path\s+)(for update;)$pattern$,
    $replacement$if p_execute then
    \1\2
  else
    \1;
  end if;$replacement$,
    1,
    1,
    'n'
  );
  if patched_definition = original_definition then
    raise exception 'legacy Stage orchestration batch lock shape changed; refusing a blind migration';
  end if;
  execute patched_definition;
end;
$migration$;

comment on function public.chips_prune_legacy_stage_allowlist_batch(
  text, uuid[], bigint[], uuid[], text, text, text[], boolean, bigint
) is 'Legacy Stage dry-run is REPEATABLE READ READ ONLY; execute retains SERIALIZABLE row locking and full revalidation.';

comment on function public.chips_prune_legacy_stage_allowlist_orchestrated_batch(
  bigint, text, text, uuid[], bigint[], uuid[], text, text, text[], boolean
) is 'Legacy Stage p_execute=false is lock-free read-only; p_execute=true retains deterministic run and batch locks.';

revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

commit;
