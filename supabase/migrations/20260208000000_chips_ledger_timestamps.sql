begin;

update public.chips_transactions
set created_at = now()
where created_at is null;

update public.chips_entries e
set created_at = coalesce(e.created_at, t.created_at, now())
from public.chips_transactions t
where e.transaction_id = t.id
  and e.created_at is null;

update public.chips_entries
set created_at = now()
where created_at is null;

alter table public.chips_transactions
  alter column created_at set default now(),
  alter column created_at set not null;

alter table public.chips_entries
  alter column created_at set default now(),
  alter column created_at set not null;

commit;
