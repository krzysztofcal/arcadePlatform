begin;

update public.chips_transactions
set created_at = now()
where created_at is null;

update public.chips_entries e
set created_at = coalesce(t.created_at, now())
from public.chips_transactions t
where e.transaction_id = t.id
  and e.created_at is null
;

do $$
begin
  if exists (select 1 from public.chips_transactions where created_at is null) then
    raise exception 'chips_transactions.created_at contains null values after backfill';
  end if;
  if exists (select 1 from public.chips_entries where created_at is null) then
    raise exception 'chips_entries.created_at contains null values after backfill';
  end if;
end $$;

alter table public.chips_transactions
  alter column created_at set default now(),
  alter column created_at set not null;

alter table public.chips_entries
  alter column created_at set default now(),
  alter column created_at set not null;

commit;
