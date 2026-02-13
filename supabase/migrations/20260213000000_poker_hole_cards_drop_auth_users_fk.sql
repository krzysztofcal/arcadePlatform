do $$
declare
  fk record;
begin
  for fk in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_class rt on rt.oid = c.confrelid
    join pg_namespace rn on rn.oid = rt.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relname = 'poker_hole_cards'
      and rn.nspname = 'auth'
      and rt.relname = 'users'
      and exists (
        select 1
        from unnest(c.conkey) as ck(attnum)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = ck.attnum
        where a.attname = 'user_id'
      )
  loop
    execute format('alter table public.poker_hole_cards drop constraint if exists %I', fk.conname);
  end loop;
end $$;
