create table public.poker_hole_cards (
  table_id uuid not null references public.poker_tables (id) on delete cascade,
  hand_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  cards jsonb not null,
  created_at timestamptz not null default now(),
  unique (table_id, hand_id, user_id)
);

create index poker_hole_cards_table_id_hand_id_idx on public.poker_hole_cards (table_id, hand_id);

alter table public.poker_hole_cards enable row level security;

-- Defense-in-depth: prevent any direct client access.
revoke all on table public.poker_hole_cards from anon;
revoke all on table public.poker_hole_cards from authenticated;
