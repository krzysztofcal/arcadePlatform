alter table public.poker_actions add column if not exists hand_id text;

alter table public.poker_actions add column if not exists request_id text;

alter table public.poker_actions add column if not exists phase_from text;

alter table public.poker_actions add column if not exists phase_to text;

alter table public.poker_actions add column if not exists meta jsonb;

create index if not exists poker_actions_table_id_hand_id_created_at_idx on public.poker_actions (table_id, hand_id, created_at);

create index if not exists poker_actions_table_id_version_idx on public.poker_actions (table_id, version);
