alter table public.poker_seats
  add column if not exists is_bot boolean not null default false;

create index if not exists poker_seats_table_id_is_bot_idx
  on public.poker_seats (table_id, is_bot);
