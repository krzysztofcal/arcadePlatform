-- Ensure chips entry sequencing and balance application triggers exist

create or replace function public.chips_entries_assign_sequence()
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
    update public.chips_accounts
    set next_entry_seq = next_entry_seq + 1,
        updated_at = timezone('utc', now())
    where id = new.account_id;
    return new;
end;
$$;

drop trigger if exists chips_entries_assign_sequence_trg on public.chips_entries;
create trigger chips_entries_assign_sequence_trg
before insert on public.chips_entries
for each row execute function public.chips_entries_assign_sequence();

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

drop trigger if exists chips_entries_apply_account_delta_trg on public.chips_entries;
create trigger chips_entries_apply_account_delta_trg
after insert on public.chips_entries
for each row execute function public.chips_entries_apply_account_delta();
