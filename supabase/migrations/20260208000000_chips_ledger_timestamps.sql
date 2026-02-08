begin;

update public.chips_entries e
set created_at = t.created_at
from public.chips_transactions t
where e.transaction_id = t.id
  and e.created_at is null
  and t.created_at is not null;

update public.chips_transactions t
set created_at = sub.min_entry_created_at
from (
  select transaction_id, min(created_at) as min_entry_created_at
  from public.chips_entries
  where created_at is not null
  group by transaction_id
) sub
where t.id = sub.transaction_id
  and t.created_at is null;

update public.chips_transactions
set created_at = now()
where created_at is null;

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
