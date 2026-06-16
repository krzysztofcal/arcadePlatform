-- Support cursor paging for chips ledger history.
create index if not exists chips_entries_account_created_seq_idx
  on public.chips_entries (account_id, created_at desc, entry_seq desc);
