alter table public.poker_tables
  add column if not exists buy_in integer;

update public.poker_tables
set buy_in = 100
where buy_in is null;

alter table public.poker_tables
  alter column buy_in set default 100,
  alter column buy_in set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'poker_tables'
      and c.conname = 'poker_tables_buy_in_positive_chk'
  ) then
    alter table public.poker_tables
      add constraint poker_tables_buy_in_positive_chk check (buy_in > 0);
  end if;
end $$;
