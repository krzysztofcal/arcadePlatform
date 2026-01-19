-- Draft: enforce server-only access for poker_hole_cards.
-- Service role bypasses RLS; clients should have zero policies for this table.

alter table public.poker_hole_cards enable row level security;
alter table public.poker_hole_cards force row level security;

-- No client policies are created; hole cards are server-only.
revoke select, insert, update, delete on table public.poker_hole_cards from anon;
revoke select, insert, update, delete on table public.poker_hole_cards from authenticated;
