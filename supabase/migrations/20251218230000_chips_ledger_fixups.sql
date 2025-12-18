-- Chips ledger hardening follow-up
-- Adds idempotency, append-only protections, system account uniqueness, tx typing, and snapshot clarity.

create type if not exists public.chips_tx_type as enum ('MINT', 'BURN', 'BUY_IN', 'CASH_OUT', 'RAKE_FEE', 'PRIZE_PAYOUT');

alter table public.chips_transactions
    add column if not exists idempotency_key text not null default gen_random_uuid()::text,
    add column if not exists payload_hash text not null default encode(gen_random_bytes(16), 'hex'),
    add column if not exists tx_type public.chips_tx_type not null default 'MINT';

alter table public.chips_transactions
    add constraint chips_transactions_idempotency_key_unique unique (idempotency_key),
    add constraint chips_transactions_idempotency_key_present check (length(idempotency_key) > 0),
    add constraint chips_transactions_payload_hash_present check (length(payload_hash) > 0);

create index if not exists chips_transactions_tx_type_created_idx on public.chips_transactions (tx_type, created_at);

alter table public.chips_accounts
    add column if not exists system_key text,
    add constraint chips_accounts_user_or_system_key check (
        (account_type = 'USER' and user_id is not null and system_key is null)
        or (account_type <> 'USER' and user_id is null and system_key is not null)
    ),
    add constraint chips_accounts_system_key_unique unique (system_key);

insert into public.chips_accounts (account_type, system_key, status)
values
    ('SYSTEM', 'HOUSE', 'active'),
    ('SYSTEM', 'TREASURY', 'active')
on conflict (system_key) do nothing;

drop table if exists public.chips_account_snapshot;
create table public.chips_account_snapshot (
    account_id uuid primary key references public.chips_accounts (id) on delete cascade,
    balance bigint not null,
    last_entry_seq bigint not null,
    updated_at timestamptz not null default timezone('utc', now()),
    metadata jsonb not null default '{}'::jsonb
);

-- Append-only: block updates/deletes on ledger tables
create or replace function public.chips_reject_ledger_mutations()
returns trigger
language plpgsql
as $$
begin
    raise exception 'Ledger rows are append-only; % is not permitted on %', tg_op, tg_table_name;
end;
$$;

drop trigger if exists chips_entries_apply_account_delta_trg on public.chips_entries;
create trigger chips_entries_block_updates
before update on public.chips_entries
for each row execute function public.chips_reject_ledger_mutations();

create trigger chips_entries_block_deletes
before delete on public.chips_entries
for each row execute function public.chips_reject_ledger_mutations();

create trigger chips_transactions_block_updates
before update on public.chips_transactions
for each row execute function public.chips_reject_ledger_mutations();

create trigger chips_transactions_block_deletes
before delete on public.chips_transactions
for each row execute function public.chips_reject_ledger_mutations();

-- Apply deltas only on insert
create or replace function public.chips_entries_apply_account_delta()
returns trigger
language plpgsql
as $$
begin
    update public.chips_accounts
    set balance = balance + new.amount,
        updated_at = timezone('utc', now())
    where id = new.account_id;
    return new;
end;
$$;

create trigger chips_entries_apply_account_delta_trg
after insert on public.chips_entries
for each row execute function public.chips_entries_apply_account_delta();

-- Restore deny-all RLS on snapshots after recreation
alter table public.chips_account_snapshot enable row level security;
create policy if not exists deny_all_chips_account_snapshot on public.chips_account_snapshot
    using (false)
    with check (false);

-- Optional: user-filtered view for future safe reads
create or replace view public.v_user_chips_entries as
select e.*
from public.chips_entries e
join public.chips_accounts a on a.id = e.account_id
where a.account_type = 'USER' and a.user_id = auth.uid();
