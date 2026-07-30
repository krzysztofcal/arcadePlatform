-- Partial index for action history cleanup queries.
-- Covers (table_id, created_at) for HAND_SETTLED rows only,
-- supporting the locked_tables EXISTS subquery that finds
-- tables with old settlements.

create index if not exists poker_actions_hand_settled_table_created_idx
  on public.poker_actions (table_id, created_at)
  where action_type = 'HAND_SETTLED';
