create table if not exists public.poker_hole_cards (
  table_id uuid not null references public.poker_tables (id) on delete cascade,
  hand_id text not null,
  user_id uuid not null,
  cards jsonb not null,
  created_at timestamptz not null default now(),
  primary key (table_id, hand_id, user_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'poker_hole_cards'
      and c.conname = 'poker_hole_cards_user_id_fkey'
  ) then
    alter table public.poker_hole_cards
      add constraint poker_hole_cards_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'poker_hole_cards'
      and c.conname = 'poker_hole_cards_cards_check'
  ) then
    alter table public.poker_hole_cards
      add constraint poker_hole_cards_cards_check
      check (jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) = 2);
  end if;
end $$;

create index if not exists poker_hole_cards_user_id_table_id_idx
  on public.poker_hole_cards (user_id, table_id);

alter table public.poker_hole_cards enable row level security;

create policy "poker_hole_cards_read_own"
  on public.poker_hole_cards
  for select
  using (auth.uid() = user_id);

create policy "poker_hole_cards_no_client_insert"
  on public.poker_hole_cards
  for insert
  with check (false);

create policy "poker_hole_cards_no_client_update"
  on public.poker_hole_cards
  for update
  using (false);

create policy "poker_hole_cards_no_client_delete"
  on public.poker_hole_cards
  for delete
  using (false);
