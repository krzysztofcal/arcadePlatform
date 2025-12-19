-- Seed required system accounts for chips ledger (idempotent)
insert into public.chips_accounts (account_type, system_key, status, balance, next_entry_seq)
select 'SYSTEM', 'TREASURY', 'active', 0, 1
where not exists (
  select 1 from public.chips_accounts where system_key = 'TREASURY'
);
