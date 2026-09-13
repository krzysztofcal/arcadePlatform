begin;

-- E2 is an owner-gated follow-up.  PR A ships this contract but never applies
-- it automatically and never enables the Production fence by merge.
do $identity$
declare
  actual_system_identifier text;
  confirmation text;
  evidence_sha text;
begin
  select system_identifier::text into actual_system_identifier from pg_catalog.pg_control_system();
  confirmation := current_setting('chips.production_fence_confirmation', true);
  evidence_sha := current_setting('chips.production_runtime_evidence_sha256', true);
  if actual_system_identifier is distinct from '7575202818581710058'
     or current_setting('chips.production_project_ref', true) is distinct from 'otbqfijerkieoxwpxjnm'
     or confirmation !~ '^ACTIVATE TABLE FENCE otbqfijerkieoxwpxjnm [0-9a-f]{64}$'
     or evidence_sha !~ '^[0-9a-f]{64}$'
     or confirmation <> 'ACTIVATE TABLE FENCE otbqfijerkieoxwpxjnm ' || evidence_sha then
    raise exception using errcode = 'P8916', message = 'Production TABLE fence activation evidence is missing or mismatched';
  end if;
  if to_regclass('public.chips_production_retention_control') is null
     or to_regclass('public.chips_table_fence_control') is null
     or not exists (select 1 from public.chips_production_retention_control where control_id is true and enabled is false and max_transactions = 2)
     or not exists (select 1 from public.chips_table_fence_control where control_id is true and enforcement_active is false)
     or not exists (select 1 from public.chips_production_bot_only_retention_policy where policy_id = 'production-ledger-bot-only-retention-7d-v1' and enabled is false)
     or not exists (select 1 from public.chips_production_closed_human_table_retention_policy where policy_id = 'production-ledger-closed-human-table-retention-30d-v1' and enabled is false)
     or not exists (select 1 from public.chips_production_escrow_account_retention_policy where policy_id = 'production-ledger-escrow-account-retention-v1' and enabled is false) then
    raise exception using errcode = 'P8916', message = 'Production E1 contract is not present in the required OFF state';
  end if;
end;
$identity$;

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm', 0));

do $catalog$
begin
  if not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.poker_tables'::pg_catalog.regclass and attname = 'bot_only_proof_eligible' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.poker_tables'::pg_catalog.regclass and attname = 'bot_only_retention_complete_at' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.poker_tables'::pg_catalog.regclass and attname = 'human_retention_complete_at' and not attisdropped) then
    raise exception using errcode = 'P8916', message = 'Production E1 lifecycle columns are missing';
  end if;
end;
$catalog$;

select pg_catalog.set_config('chips.production_fence_confirmation', current_setting('chips.production_fence_confirmation', true), true);
select public.chips_set_table_fence_active(true);

alter table public.poker_tables alter column bot_only_proof_eligible set default true;

do $history$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'insert into supabase_migrations.schema_migrations(version) values ($1) on conflict do nothing' using '20260914091000';
  end if;
end;
$history$;

commit;
