-- Seed required system accounts for chips ledger
insert into public.chips_accounts (account_type, system_key, status, balance, next_entry_seq)
values ('SYSTEM', 'TREASURY', 'active', 0, 1)
on conflict (system_key) do nothing;
