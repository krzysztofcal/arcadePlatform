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
  else
    raise notice 'poker_seats.stack has non-numeric type %, skipping default/not-null changes', col_type;
  end if;
end $$;
