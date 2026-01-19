alter table public.poker_actions
  add column if not exists request_id text;

create unique index if not exists poker_actions_request_id_unique
  on public.poker_actions (table_id, user_id, request_id)
  where request_id is not null;
