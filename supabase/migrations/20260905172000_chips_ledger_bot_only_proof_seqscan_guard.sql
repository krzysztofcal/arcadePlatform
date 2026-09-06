-- Forward-only planner guard for the already split bot-only proof paths.
-- 20260905170000 and 20260905171000 are applied on shared Stage and remain
-- immutable.  The UNION access-path rewrite remains the primary correction;
-- this local setting only prevents a low-selectivity tx_type branch from
-- reverting to a sequential scan on the existing ledger index.
begin;

grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

do $patch$
declare
  definition text;
  patched text;
  marker text := '  with table_transaction_rows as (';
  replacement text := E'  perform pg_catalog.set_config(''enable_seqscan'', ''off'', true);\n\n  with table_transaction_rows as (';
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamptz,uuid[],text[])'::pg_catalog.regprocedure
  ) into definition;

  if definition is null
     or pg_catalog.strpos(definition, marker) < 1
     or pg_catalog.strpos(definition, 'pg_catalog.set_config(''enable_seqscan''') > 0 then
    raise exception 'bot-only proof seqscan guard shape changed; refusing forward planner correction';
  end if;

  patched := pg_catalog.replace(definition, marker, replacement);
  if patched = definition
     or pg_catalog.strpos(patched, 'pg_catalog.set_config(''enable_seqscan'', ''off'', true)') < 1
     or pg_catalog.strpos(patched, marker) < 1
     or pg_catalog.strpos(patched, 'from candidate_transaction_ids candidates') < 1 then
    raise exception 'bot-only proof seqscan guard was not exact';
  end if;

  execute patched;
end;
$patch$;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;
commit;
