alter table public.poker_tables
  add column if not exists last_activity_at timestamptz not null default now();

create index if not exists poker_tables_status_idx on public.poker_tables (status);

create index if not exists poker_tables_last_activity_idx on public.poker_tables (last_activity_at);

alter table public.poker_seats
  add column if not exists stack int,
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists joined_at timestamptz not null default now();

update public.poker_seats
  set status = 'ACTIVE'
  where status is null or status = 'SEATED';

create index if not exists poker_seats_table_id_idx on public.poker_seats (table_id);

create index if not exists poker_seats_table_id_last_seen_idx on public.poker_seats (table_id, last_seen_at);

create table if not exists public.poker_requests (
  table_id uuid not null references public.poker_tables (id) on delete cascade,
  user_id uuid not null,
  request_id text not null,
  kind text not null,
  result_json jsonb,
  created_at timestamptz not null default now(),
  unique (request_id)
);
