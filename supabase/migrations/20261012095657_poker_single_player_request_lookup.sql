-- #1077 measured Quick Seat intent lookup: table_id is unknown at lookup.
-- Partial index excludes action history; preserves existing idempotency constraints.
create index if not exists poker_requests_quick_seat_user_request_idx
  on public.poker_requests (user_id, request_id)
  where kind = 'QUICK_SEAT';
