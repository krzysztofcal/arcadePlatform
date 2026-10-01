-- #1018 T065-T067: add poker_access_policy.slow_hysteresis_bps and convert
-- slow_recovery_threshold_ch to a persisted value derived from entry and hysteresis bps.
-- Forward-only; applied migrations remain immutable.
-- Allowed hysteresis range is 100 to 5000 bps (1% - 50%), default 500 (5%).
-- Publishing this file invokes DB Stage Apply PR; Production remains separately reviewed.

alter table public.poker_access_policy
  add column if not exists slow_hysteresis_bps integer not null default 500;

update public.poker_access_policy
  set slow_hysteresis_bps = 500,
      slow_recovery_threshold_ch = floor((slow_threshold_ch::numeric * (10000 - 500)::numeric) / 10000)::bigint,
      revision = revision + 1,
      updated_at = timezone('utc', now())
where id = 1
  and (
    slow_hysteresis_bps is distinct from 500
    or slow_recovery_threshold_ch is distinct from floor((slow_threshold_ch::numeric * (10000 - 500)::numeric) / 10000)::bigint
  );

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'poker_access_policy_hysteresis_bps_chk') then
    alter table public.poker_access_policy
      add constraint poker_access_policy_hysteresis_bps_chk
      check (slow_hysteresis_bps >= 100 and slow_hysteresis_bps <= 5000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'poker_access_policy_recovery_derivation_chk') then
    alter table public.poker_access_policy
      add constraint poker_access_policy_recovery_derivation_chk
      check (slow_recovery_threshold_ch = floor((slow_threshold_ch::numeric * (10000 - slow_hysteresis_bps)::numeric) / 10000)::bigint);
  end if;
end $$;
