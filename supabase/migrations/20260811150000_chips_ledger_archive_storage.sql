create table public.chips_ledger_archive_batches (
  object_path text primary key,
  project_ref text not null,
  format_version integer not null,
  cutoff timestamptz not null,
  cursor_start_created_at timestamptz,
  cursor_start_id uuid,
  cursor_end_created_at timestamptz,
  cursor_end_id uuid,
  first_created_at timestamptz,
  last_created_at timestamptz,
  transaction_count bigint not null,
  entry_count bigint not null,
  tx_types jsonb not null,
  raw_bytes bigint not null,
  compressed_bytes bigint not null,
  raw_sha256 text not null,
  compressed_sha256 text not null,
  credits numeric not null,
  debits numeric not null,
  net_amount numeric not null,
  status text not null,
  created_at timestamptz not null default timezone('utc', now()),
  committed_at timestamptz,
  constraint chips_ledger_archive_batches_object_path_check
    check (object_path ~ '^v1/sha256/[0-9a-f]{64}\.jsonl\.gz$'),
  constraint chips_ledger_archive_batches_project_ref_check
    check (project_ref ~ '^[a-z0-9]{20}$'),
  constraint chips_ledger_archive_batches_format_version_check
    check (format_version > 0),
  constraint chips_ledger_archive_batches_cursor_start_pair_check
    check ((cursor_start_created_at is null) = (cursor_start_id is null)),
  constraint chips_ledger_archive_batches_cursor_end_pair_check
    check ((cursor_end_created_at is null) = (cursor_end_id is null)),
  constraint chips_ledger_archive_batches_time_range_check
    check (first_created_at is null or last_created_at is null or first_created_at <= last_created_at),
  constraint chips_ledger_archive_batches_counts_check
    check (transaction_count >= 0 and entry_count >= 0),
  constraint chips_ledger_archive_batches_sizes_check
    check (raw_bytes >= 0 and compressed_bytes >= 0),
  constraint chips_ledger_archive_batches_tx_types_check
    check (jsonb_typeof(tx_types) = 'object'),
  constraint chips_ledger_archive_batches_sha256_check
    check (raw_sha256 ~ '^[0-9a-f]{64}$' and compressed_sha256 ~ '^[0-9a-f]{64}$'),
  constraint chips_ledger_archive_batches_amounts_check
    check (credits >= 0 and debits >= 0 and credits = debits and net_amount = 0),
  constraint chips_ledger_archive_batches_status_check
    check (status in ('pending', 'committed')),
  constraint chips_ledger_archive_batches_commit_state_check
    check (
      (status = 'pending' and committed_at is null)
      or (status = 'committed' and committed_at is not null)
    )
);

alter table public.chips_ledger_archive_batches enable row level security;

revoke all on table public.chips_ledger_archive_batches from anon, authenticated;
