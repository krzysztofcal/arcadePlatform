create unique index poker_actions_accepted_request_id_key
  on public.poker_actions (table_id, request_id)
  where request_id is not null
    and btrim(request_id) <> ''
    and action_type in ('FOLD', 'CHECK', 'CALL', 'BET', 'RAISE', 'ALL_IN');

create unique index poker_actions_hand_settled_hand_id_key
  on public.poker_actions (table_id, hand_id)
  where hand_id is not null
    and btrim(hand_id) <> ''
    and action_type = 'HAND_SETTLED';
