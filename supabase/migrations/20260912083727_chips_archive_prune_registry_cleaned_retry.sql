begin;

-- #981 / run #803: #980 can legitimately retire the registry after v1
-- pruning. Patch the effective definition, retaining later closed-human
-- behavior and every guard outside the complete prune receipt predicate.
grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

do $prune_retry_patch$
declare
  definition text;
  needle text := $needle$      or registry_count <> transaction_count
      or matching_mapping_count <> transaction_count$needle$;
  replacement text := $replacement$      or (
        (
          pg_catalog.num_nonnulls(batch.registry_cleaned_at,
            batch.registry_cleaned_key_count, batch.registry_cleaned_keys_sha256) = 0
          and registry_count = transaction_count
          and matching_mapping_count = transaction_count
        ) or (
          batch.project_ref = 'krydukthwdvccggbyjfw'
          and batch.format_version = 1
          and batch.source_policy_id = 'stage-ledger-auto-retention-30d-v1'
          and batch.committed_at is not null
          and pg_catalog.num_nonnulls(batch.registry_cleaned_at,
            batch.registry_cleaned_key_count, batch.registry_cleaned_keys_sha256) = 3
          and batch.registry_cleaned_key_count = transaction_count
          and batch.registry_cleaned_keys_sha256 ~ '^[0-9a-f]{64}$'
          and registry_count = 0
          and matching_mapping_count = 0
        )
      ) is not true$replacement$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)'::pg_catalog.regprocedure
  ) into definition;
  if definition is null
     or (pg_catalog.length(definition)
         - pg_catalog.length(pg_catalog.replace(definition, needle, '')))
        / pg_catalog.length(needle) <> 1
     or pg_catalog.strpos(definition, 'if receipt_field_count = 5 then') = 0
     or pg_catalog.strpos(definition, 'stage-ledger-closed-human-table-retention-30d-v1') = 0
     or pg_catalog.strpos(definition, 'not is_closed_human') = 0 then
    raise exception 'Issue #981 requires the current closed-human-aware archive pruner';
  end if;
  execute pg_catalog.replace(definition, needle, replacement);
end;
$prune_retry_patch$;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

commit;
