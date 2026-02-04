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
        select array_agg(a.attname::text order by k.ordinality)
        from unnest(c.conkey) with ordinality as k(attnum, ordinality)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
      ) = array['table_id', 'request_id']::text[]
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
        select array_agg(a.attname::text order by k.ordinality)
        from unnest(idx.indkey) with ordinality as k(attnum, ordinality)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
      ) = array['table_id', 'request_id']::text[]
  loop
    execute format('drop index if exists %I', rec.index_name);
  end loop;
end $$;

create unique index if not exists poker_requests_table_kind_request_id_user_id_key
  on public.poker_requests (table_id, kind, request_id, user_id);
