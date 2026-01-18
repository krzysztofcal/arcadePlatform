alter table public.poker_seats
  add column if not exists stack int;

update public.poker_seats
  set stack = 0
  where stack is null;

alter table public.poker_seats
  alter column stack set default 0,
  alter column stack set not null;
