-- Forward-only access-path correction for bot-only cleanup lifecycle checks.
-- The exact batch/proof/receipt/GO and cleanup semantics remain in the
-- already-applied cleanup function.  Only its two lifecycle-gate call sites
-- are redirected to the existing proof-bound scoped verifier.
begin;

-- Keep the existing least-privilege function owner and ACL pattern while the
-- migration replaces the exact deployed function definition.
grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

do $patch$
declare
  definition text;
  patched text;
  old_gate text := '  perform public.chips_assert_bot_only_table_lifecycle_gate(batch.bot_only_table_id, batch.batch_id, batch.cutoff, p_registry_keys);';
  replacement text := '  perform public.chips_assert_bot_only_archive_proof_lifecycle_gate(batch.bot_only_table_id, batch.batch_id, batch.cutoff, p_transaction_ids, p_registry_keys);';
  occurrence_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid,boolean,bigint)'::pg_catalog.regprocedure
  ) into definition;

  if definition is null then
    raise exception 'bot-only cleanup function was not found; refusing scoped lifecycle replacement';
  end if;

  occurrence_count := (
    pg_catalog.length(definition)
    - pg_catalog.length(pg_catalog.replace(definition, old_gate, ''))
  ) / pg_catalog.length(old_gate);

  if occurrence_count <> 2 then
    raise exception 'bot-only cleanup lifecycle gate shape changed: expected exactly two old call sites';
  end if;

  patched := pg_catalog.replace(definition, old_gate, replacement);
  if patched = definition
     or pg_catalog.strpos(patched, old_gate) > 0
     or (
       pg_catalog.length(patched)
       - pg_catalog.length(pg_catalog.replace(patched, replacement, ''))
     ) / pg_catalog.length(replacement) <> 2
     or pg_catalog.strpos(patched, 'p_transaction_ids, p_registry_keys') < 1 then
    raise exception 'bot-only cleanup scoped lifecycle replacement was not exact';
  end if;

  execute patched;
end;
$patch$;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;
commit;
