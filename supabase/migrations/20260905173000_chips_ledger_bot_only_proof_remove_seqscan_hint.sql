-- Forward-only correction for 20260905172000.
-- The UNION/type access paths are the durable proof fix.  A Stage EXPLAIN
-- showed that forcing index scans made the exact diagnostic exceed its
-- statement limit, so remove only that planner override and keep the
-- optimizer's bounded TABLE-type choice.
begin;

grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

do $patch$
declare
  definition text;
  patched text;
  needle text := E'  perform pg_catalog.set_config(''enable_seqscan'', ''off'', true);\n\n';
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamptz,uuid[],text[])'::pg_catalog.regprocedure
  ) into definition;

  if definition is null
     or pg_catalog.strpos(definition, needle) < 1 then
    raise exception 'bot-only proof seqscan override was not present; refusing forward cleanup';
  end if;

  patched := pg_catalog.replace(definition, needle, '');
  if patched = definition
     or pg_catalog.strpos(patched, needle) > 0
     or pg_catalog.strpos(patched, '  with table_transaction_rows as (') < 1
     or pg_catalog.strpos(patched, 'from candidate_transaction_ids candidates') < 1 then
    raise exception 'bot-only proof seqscan override cleanup was not exact';
  end if;

  execute patched;
end;
$patch$;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;
commit;
