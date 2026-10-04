begin;
-- #1018 §32 Stage-only scheduler decommission after accepted demand smoke + owner GO.
-- Keep poker_bot_refill_control as the demand-path kill switch / database identity guard.
-- Keep pg_cron installed; Production cleanup is a separate authorization.

do $$
declare
  v_job_id bigint;
begin
  if pg_catalog.to_regclass('cron.job') is not null then
    execute 'select jobid from cron.job where jobname = $1 order by jobid limit 1'
      into v_job_id
      using 'poker-bot-pool-refill-hourly';
    if v_job_id is not null then
      execute 'select cron.unschedule($1)' using v_job_id;
    end if;
  end if;
end
$$;

drop function if exists public.poker_bot_pool_refill_hourly();

commit;
