alter table public.poker_seats
  add column if not exists bot_profile text null,
  add column if not exists leave_after_hand boolean not null default false;

create index if not exists poker_seats_leave_after_hand_idx
  on public.poker_seats(table_id, leave_after_hand)
  where leave_after_hand = true;
