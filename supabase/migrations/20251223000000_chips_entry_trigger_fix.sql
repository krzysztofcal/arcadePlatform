-- Assign per-account entry sequences atomically.
-- Safe even when multiple entries for the same account are inserted in one statement.
create or replace function public.chips_entries_assign_sequence()
returns trigger
language plpgsql
as $$
declare
  allocated_seq bigint;
begin
  -- If caller provides entry_seq, enforce it matches expected and advance.
  if new.entry_seq is not null then
    perform 1 from public.chips_accounts where id = new.account_id for update;
    if not found then
      raise exception 'account_missing' using errcode = 'P0001';
    end if;

    -- Check expected sequence
    if new.entry_seq <> (select next_entry_seq from public.chips_accounts where id = new.account_id) then
      raise exception 'entry_seq_mismatch' using errcode = 'P0001';
    end if;

    -- Advance sequence now that we're accepting it
    update public.chips_accounts
    set next_entry_seq = next_entry_seq + 1,
        updated_at = timezone('utc', now())
    where id = new.account_id;

    return new;
  end if;

  -- Normal case: allocate next sequence and advance it in one statement.
  update public.chips_accounts
  set next_entry_seq = next_entry_seq + 1,
      updated_at = timezone('utc', now())
  where id = new.account_id
  returning next_entry_seq - 1 into allocated_seq;

  if allocated_seq is null then
    raise exception 'account_missing' using errcode = 'P0001';
  end if;

  new.entry_seq := allocated_seq;
  return new;
end;
$$;

drop trigger if exists chips_entries_assign_sequence_trg on public.chips_entries;
drop trigger if exists chips_entries_advance_next_entry_seq_trg on public.chips_entries;
drop trigger if exists chips_entries_set_sequence_before_trg on public.chips_entries;
drop trigger if exists chips_entries_apply_account_delta_trg on public.chips_entries;

drop function if exists public.chips_entries_set_sequence_before();
drop function if exists public.chips_entries_assign_sequence_before();
drop function if exists public.chips_accounts_advance_next_entry_seq();
drop function if exists public.chips_entries_apply_account_delta();

create trigger chips_entries_assign_sequence_trg
before insert on public.chips_entries
for each row
execute function public.chips_entries_assign_sequence();
