create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  handle text not null,
  display_name text not null,
  bio text not null default '',
  avatar_key text,
  avatar_variant text not null,
  handle_customized_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_profiles_handle_normalized check (handle = lower(handle)),
  constraint user_profiles_handle_format check (handle ~ '^[a-z0-9][a-z0-9_-]{2,23}$'),
  constraint user_profiles_handle_not_reserved check (handle not in (
    'admin', 'admin-api', 'about', 'account', 'api', 'assets', 'auth', 'contact', 'game', 'games',
    'help', 'leaderboard', 'legal', 'login', 'logout', 'me', 'poker', 'privacy', 'profile', 'register',
    'settings', 'signup', 'static', 'support', 'terms', 'user', 'users', 'xp'
  )),
  constraint user_profiles_display_name_length check (char_length(btrim(display_name)) between 2 and 40),
  constraint user_profiles_bio_length check (char_length(bio) <= 160)
);

create unique index if not exists user_profiles_handle_lower_unique
  on public.user_profiles (lower(handle));

create or replace function public.user_profiles_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists user_profiles_touch_updated_at_trg on public.user_profiles;
create trigger user_profiles_touch_updated_at_trg
before update on public.user_profiles
for each row execute function public.user_profiles_touch_updated_at();

alter table public.user_profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_profiles'
      and policyname = 'deny_all_user_profiles'
  ) then
    create policy deny_all_user_profiles on public.user_profiles
      using (false)
      with check (false);
  end if;
end $$;
