alter table public.poker_seats
  add column if not exists stack int;

do $$
declare
  col_type text;
begin
  select data_type into col_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'poker_seats'
    and column_name = 'stack';

  if col_type in ('integer', 'bigint', 'numeric') then
    execute 'update public.poker_seats set stack = 0 where stack is null';
    execute 'alter table public.poker_seats alter column stack set default 0';
    execute 'alter table public.poker_seats alter column stack set not null';

    if not exists (
      select 1 from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'poker_seats'
        and c.conname = 'poker_seats_stack_non_negative'
    ) then
      execute 'alter table public.poker_seats add constraint poker_seats_stack_non_negative check (stack >= 0)';
    end if;
  else
    raise notice 'poker_seats.stack has non-numeric type %, skipping default/not-null changes', col_type;
  end if;
end $$;
