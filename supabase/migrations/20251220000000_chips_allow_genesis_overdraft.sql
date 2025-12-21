-- Allow GENESIS system account to go negative while keeping other accounts non-negative.
create or replace function public.chips_accounts_block_negative_balance()
returns trigger
language plpgsql
as $$
begin
  if new.balance < 0 and not (old.account_type = 'SYSTEM' and old.system_key = 'GENESIS') then
    raise exception 'insufficient_funds' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists chips_accounts_block_negative_balance_trg on public.chips_accounts;
create trigger chips_accounts_block_negative_balance_trg
before update of balance on public.chips_accounts
for each row
execute function public.chips_accounts_block_negative_balance();
