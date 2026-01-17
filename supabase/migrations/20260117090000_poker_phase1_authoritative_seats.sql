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

with ranked_seats as (
  select
    ctid,
    row_number() over (
      partition by table_id, seat_no
      order by joined_at desc nulls last, ctid desc
    ) as rn
  from public.poker_seats
  where table_id is not null and seat_no is not null
)
delete from public.poker_seats
where ctid in (select ctid from ranked_seats where rn > 1);

with ranked_users as (
  select
    ctid,
    row_number() over (
      partition by table_id, user_id
      order by joined_at desc nulls last, ctid desc
    ) as rn
  from public.poker_seats
  where table_id is not null and user_id is not null
)
delete from public.poker_seats
where ctid in (select ctid from ranked_users where rn > 1);

create unique index if not exists poker_seats_table_id_seat_no_key on public.poker_seats (table_id, seat_no);

create unique index if not exists poker_seats_table_id_user_id_key on public.poker_seats (table_id, user_id);

create table if not exists public.poker_requests (
  table_id uuid not null references public.poker_tables (id) on delete cascade,
  user_id uuid not null,
  request_id text not null,
  kind text not null,
  result_json jsonb,
  created_at timestamptz not null default now(),
  unique (table_id, request_id)
);

do $$
declare
  rec record;
begin
  for rec in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'poker_requests'
      and c.contype = 'u'
      and (
        select array_agg(a.attname order by k.ordinality)
        from unnest(c.conkey) with ordinality as k(attnum, ordinality)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
      ) = array['request_id']
  loop
    execute format('alter table public.poker_requests drop constraint %I', rec.conname);
  end loop;
end $$;

do $$
declare
  rec record;
begin
  for rec in
    select i.relname as index_name
    from pg_index idx
    join pg_class t on t.oid = idx.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_class i on i.oid = idx.indexrelid
    where n.nspname = 'public'
      and t.relname = 'poker_requests'
      and idx.indisunique
      and (
        select array_agg(a.attname order by k.ordinality)
        from unnest(idx.indkey) with ordinality as k(attnum, ordinality)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
      ) = array['request_id']
  loop
    execute format('drop index if exists %I', rec.index_name);
  end loop;
end $$;

create unique index if not exists poker_requests_table_id_request_id_key
  on public.poker_requests (table_id, request_id);

create index if not exists poker_requests_created_at_idx on public.poker_requests (created_at);
