-- Add-if-missing poker tables/constraints and hole-cards security guarantees.

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

revoke select, insert, update, delete on table public.poker_hole_cards from anon;
revoke select, insert, update, delete on table public.poker_hole_cards from authenticated;

alter table public.poker_actions
  add column if not exists request_id text;

create unique index if not exists poker_actions_request_id_unique
  on public.poker_actions (table_id, user_id, request_id)
  where request_id is not null;
