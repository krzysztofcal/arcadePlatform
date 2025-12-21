-- Ensure chips account triggers avoid tuple re-updates and keep GENESIS overdraft semantics deterministic.

-- Guard: prevent non-GENESIS accounts from going negative.
create or replace function public.chips_accounts_block_negative_balance()
returns trigger
language plpgsql
as $$
begin
  if new.balance < 0 and not (new.account_type = 'SYSTEM' and new.system_key = 'GENESIS') then
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

-- Assign per-account entry sequences without updating the account row in a BEFORE trigger.
create or replace function public.chips_entries_set_sequence_before()
returns trigger
language plpgsql
as $$
declare
  next_seq bigint;
begin
  select next_entry_seq into next_seq from public.chips_accounts where id = new.account_id for update;
  if new.entry_seq is null then
    new.entry_seq := next_seq;
  elsif new.entry_seq <> next_seq then
    raise exception 'Entry sequence must match expected value (%) for account %.', next_seq, new.account_id;
  end if;
  return new;
end;
$$;

-- Advance next_entry_seq after the entry is recorded to avoid tuple re-updates within a single command.
create or replace function public.chips_accounts_advance_next_entry_seq()
returns trigger
language plpgsql
as $$
begin
  update public.chips_accounts
  set next_entry_seq = next_entry_seq + 1,
      updated_at = timezone('utc', now())
  where id = new.account_id;
  return new;
end;
$$;

drop trigger if exists chips_entries_assign_sequence_trg on public.chips_entries;
drop trigger if exists chips_entries_advance_next_entry_seq_trg on public.chips_entries;

create trigger chips_entries_assign_sequence_trg
before insert on public.chips_entries
for each row execute function public.chips_entries_set_sequence_before();

create trigger chips_entries_advance_next_entry_seq_trg
after insert on public.chips_entries
for each row execute function public.chips_accounts_advance_next_entry_seq();
