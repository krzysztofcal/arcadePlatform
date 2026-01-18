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
