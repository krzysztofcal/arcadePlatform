alter table public.poker_managed_table_profiles
  drop constraint poker_managed_table_profiles_desired_count_chk,
  add constraint poker_managed_table_profiles_desired_count_chk
    check (desired_table_count between 0 and 100);
