-- #1018 T059-T061: add poker_access_policy.slow_recovery_threshold_ch with
-- hysteresis constraints. Forward-only; applied migrations remain immutable.
-- Initial singleton recovery threshold is 900,000,000 CH.
-- Publishing this file invokes DB Stage Apply PR; Production remains separately reviewed.

alter table public.poker_access_policy
  add column if not exists slow_recovery_threshold_ch bigint not null default 900000000;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'poker_access_policy_recovery_threshold_chk') then
    alter table public.poker_access_policy
      add constraint poker_access_policy_recovery_threshold_chk
      check (slow_recovery_threshold_ch > 0 and slow_recovery_threshold_ch <= 9007199254740991);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'poker_access_policy_threshold_order_chk') then
    alter table public.poker_access_policy
      add constraint poker_access_policy_threshold_order_chk
      check (slow_recovery_threshold_ch < slow_threshold_ch);
  end if;
end $$;

update public.poker_access_policy
  set slow_recovery_threshold_ch = 900000000
where id = 1 and slow_recovery_threshold_ch is distinct from 900000000;
