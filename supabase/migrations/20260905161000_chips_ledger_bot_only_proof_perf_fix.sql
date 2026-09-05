-- Forward-only correction for the proof helper installed by
-- 20260905160000.  That migration is already applied on shared Stage and
-- remains immutable.
begin;

grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

do $patch$
declare
  definition text;
  patched text;
  needle text := 'select count(distinct unknown.idempotency_key)::bigint';
  replacement text := 'select count(distinct unknown.identity_key)::bigint';
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamptz,uuid[],text[])'::pg_catalog.regprocedure
  ) into definition;
  if definition is null or pg_catalog.strpos(definition, needle) = 0 then
    raise exception 'bot-only proof helper count shape changed; refusing forward correction';
  end if;
  patched := pg_catalog.replace(definition, needle, replacement);
  if patched = definition
     or pg_catalog.strpos(patched, replacement) = 0
     or pg_catalog.strpos(patched, needle) <> 0 then
    raise exception 'bot-only proof helper count correction was not exact';
  end if;
  execute patched;
end;
$patch$;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;
commit;
