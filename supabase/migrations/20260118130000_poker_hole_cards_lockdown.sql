-- Hole cards are server-only; clients must never query this table directly.
create table if not exists public.poker_hole_cards (
  table_id uuid not null,
  hand_id text not null,
  user_id uuid not null,
  cards jsonb not null,
  created_at timestamptz not null default now(),
  primary key (table_id, hand_id, user_id)
);

alter table public.poker_hole_cards enable row level security;
alter table public.poker_hole_cards force row level security;

drop policy if exists "poker_hole_cards_read_own" on public.poker_hole_cards;
drop policy if exists "poker_hole_cards_no_client_insert" on public.poker_hole_cards;
drop policy if exists "poker_hole_cards_no_client_update" on public.poker_hole_cards;
drop policy if exists "poker_hole_cards_no_client_delete" on public.poker_hole_cards;

revoke select, insert, update, delete on table public.poker_hole_cards from anon;
revoke select, insert, update, delete on table public.poker_hole_cards from authenticated;
