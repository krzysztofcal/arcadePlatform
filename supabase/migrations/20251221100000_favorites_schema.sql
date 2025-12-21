-- Favorites schema - stores user favorite games
-- Cross-browser support via database storage (requires authentication)

-- Create favorites table if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'favorites'
  ) then
    create table public.favorites (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users (id) on delete cascade,
      game_id text not null,
      created_at timestamptz not null default timezone('utc', now())
    );
  end if;
end $$;

-- Create unique index on user_id and game_id to prevent duplicates
create unique index if not exists favorites_user_game_unique
  on public.favorites (user_id, game_id);

-- Create index for faster lookups by user_id
create index if not exists favorites_user_id_idx
  on public.favorites (user_id);

-- Create index for ordering by created_at
create index if not exists favorites_created_at_idx
  on public.favorites (user_id, created_at desc);

-- Enable Row Level Security
alter table public.favorites enable row level security;

-- Policy: Users can only see their own favorites
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'favorites' and policyname = 'favorites_select_own'
  ) then
    create policy favorites_select_own on public.favorites
      for select using (auth.uid() = user_id);
  end if;
end $$;

-- Policy: Users can only insert their own favorites
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'favorites' and policyname = 'favorites_insert_own'
  ) then
    create policy favorites_insert_own on public.favorites
      for insert with check (auth.uid() = user_id);
  end if;
end $$;

-- Policy: Users can only delete their own favorites
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'favorites' and policyname = 'favorites_delete_own'
  ) then
    create policy favorites_delete_own on public.favorites
      for delete using (auth.uid() = user_id);
  end if;
end $$;
