create table public.poker_managed_table_profiles (
  profile_key text primary key,
  enabled boolean not null default false,
  desired_table_count integer not null default 0,
  min_bot_count integer not null,
  target_bot_count integer not null,
  max_bot_count integer not null,
  rotation_interval_seconds integer not null,
  postpone_interval_seconds integer not null,
  small_blind integer not null,
  big_blind integer not null,
  max_seats integer not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint poker_managed_table_profiles_key_chk check (profile_key ~ '^[A-Z0-9_]{1,64}$'),
  constraint poker_managed_table_profiles_desired_count_chk check (desired_table_count between 0 and 2),
  constraint poker_managed_table_profiles_seats_chk check (max_seats between 2 and 6),
  constraint poker_managed_table_profiles_stakes_chk check (small_blind > 0 and big_blind > small_blind and big_blind <= 1000000),
  constraint poker_managed_table_profiles_bots_chk check (
    min_bot_count between 0 and 5
    and min_bot_count <= target_bot_count
    and target_bot_count <= max_bot_count
    and max_bot_count < max_seats
  ),
  constraint poker_managed_table_profiles_rotation_chk check (rotation_interval_seconds between 60 and 86400),
  constraint poker_managed_table_profiles_postpone_chk check (postpone_interval_seconds between 30 and 3600)
);

insert into public.poker_managed_table_profiles (
  profile_key,
  enabled,
  desired_table_count,
  min_bot_count,
  target_bot_count,
  max_bot_count,
  rotation_interval_seconds,
  postpone_interval_seconds,
  small_blind,
  big_blind,
  max_seats
) values (
  'CONTINUOUS_BOT_DEFAULT',
  false,
  0,
  2,
  3,
  3,
  900,
  300,
  1,
  2,
  6
);

alter table public.poker_tables
  add column lifecycle_kind text not null default 'STANDARD',
  add column managed_profile_key text references public.poker_managed_table_profiles(profile_key) on delete restrict,
  add column rotation_due_at timestamptz,
  add constraint poker_tables_lifecycle_kind_chk check (lifecycle_kind in ('STANDARD', 'CONTINUOUS_BOT')),
  add constraint poker_tables_managed_profile_chk check (
    (lifecycle_kind = 'STANDARD' and managed_profile_key is null)
    or (lifecycle_kind = 'CONTINUOUS_BOT' and managed_profile_key is not null)
  );

create index poker_tables_open_continuous_bot_idx
  on public.poker_tables (managed_profile_key, rotation_due_at, id)
  where status = 'OPEN' and lifecycle_kind = 'CONTINUOUS_BOT';
