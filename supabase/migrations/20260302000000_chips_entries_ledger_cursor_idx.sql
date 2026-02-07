-- Support cursor paging for chips ledger history.
drop index if exists chips_entries_account_created_idx;
create index if not exists chips_entries_account_created_seq_idx
  on public.chips_entries (account_id, created_at desc, entry_seq desc);
