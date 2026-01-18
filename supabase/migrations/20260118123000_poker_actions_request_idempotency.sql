create unique index if not exists poker_actions_request_unique
  on public.poker_actions (table_id, user_id, action_type)
  where action_type like 'REQUEST:%';
