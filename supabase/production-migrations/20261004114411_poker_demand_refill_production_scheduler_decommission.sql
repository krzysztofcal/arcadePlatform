-- #1018 §32 Production scheduler decommission after owner GO, compatible DB migration and exact runtime rollout.
-- Remove only the exact poker refill Cron job and temporary hourly wrapper.
-- Preserve poker_bot_refill_control, demand core, pg_cron extension, balances, policies and ledger history.
-- Apply only through the reviewed Production operator path that sets chips.production_project_ref.

begin;

do $cleanup$
declare
  v_job_id bigint;
  v_job_count integer;
  v_schedule text;
  v_active boolean;
  v_command text;
begin
  if pg_catalog.current_setting('chips.production_project_ref', true) is distinct from 'otbqfijerkieoxwpxjnm'
     or (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from '7575202818581710058' then
    raise exception using errcode = 'P1029', message = 'Production demand refill scheduler cleanup identity preflight failed';
  end if;

  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261004114411') then
    raise exception using errcode = 'P1029', message = 'Production demand refill scheduler cleanup already recorded';
  end if;

  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261003183626')
     or pg_catalog.to_regprocedure('public.poker_bot_pool_refill_demand(bigint,text,text,bigint)') is null
     or pg_catalog.to_regprocedure('public.poker_bot_pool_refill_hourly()') is null
     or not exists (
       select 1 from public.poker_bot_refill_control
       where id = 1 and enabled is true and expected_system_identifier = '7575202818581710058'
     ) then
    raise exception using errcode = 'P1029', message = 'Production demand refill scheduler cleanup prerequisites are missing';
  end if;

  select count(*)::integer, min(jobid), min(schedule), bool_and(active), min(command)
    into v_job_count, v_job_id, v_schedule, v_active, v_command
    from cron.job
   where jobname = 'poker-bot-pool-refill-hourly';

  if v_job_count <> 1
     or v_schedule is distinct from '0 * * * *'
     or v_active is not true
     or v_command is distinct from 'select public.poker_bot_pool_refill_hourly();' then
    raise exception using errcode = 'P1029', message = 'Production poker refill Cron shape mismatch';
  end if;

  perform cron.unschedule(v_job_id);
end;
$cleanup$;

drop function public.poker_bot_pool_refill_hourly();

insert into supabase_migrations.schema_migrations(version)
values ('20261004114411');

commit;
