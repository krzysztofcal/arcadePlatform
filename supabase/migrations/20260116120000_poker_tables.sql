create table public.poker_tables (
  id uuid primary key default gen_random_uuid(),
  stakes jsonb not null default '{}'::jsonb,
  max_players int not null default 6,
  status text not null default 'OPEN',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.poker_seats (
  table_id uuid not null references public.poker_tables (id) on delete cascade,
  user_id uuid not null,
  seat_no int not null,
  status text not null default 'SEATED',
  created_at timestamptz not null default now(),
  unique (table_id, seat_no),
  unique (table_id, user_id)
);

create table public.poker_state (
  table_id uuid primary key references public.poker_tables (id) on delete cascade,
  version bigint not null default 0,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.poker_actions (
  id bigserial primary key,
  table_id uuid not null references public.poker_tables (id) on delete cascade,
  version bigint,
  user_id uuid,
  action_type text not null,
  amount int,
  created_at timestamptz not null default now()
);

create index poker_seats_table_id_idx on public.poker_seats (table_id);

create index poker_actions_table_id_created_at_idx on public.poker_actions (table_id, created_at);
