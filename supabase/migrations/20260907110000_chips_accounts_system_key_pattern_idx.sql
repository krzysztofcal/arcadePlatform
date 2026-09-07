begin;

-- Forward-only access path for the existing escrow retention account audit.
-- Keep the audit predicate broad so malformed POKER_TABLE identities remain
-- visible to its fail-closed classification.
set local statement_timeout = '600000';
set local maintenance_work_mem = '128MB';
create index if not exists chips_accounts_system_key_pattern_idx
  on public.chips_accounts (system_key text_pattern_ops)
  where system_key is not null;

commit;
