create table if not exists public.poker_hole_cards (
  table_id uuid not null references public.poker_tables (id) on delete cascade,
  hand_id text not null,
  user_id uuid not null,
  cards jsonb not null,
  created_at timestamptz not null default now(),
  primary key (table_id, hand_id, user_id)
);

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
