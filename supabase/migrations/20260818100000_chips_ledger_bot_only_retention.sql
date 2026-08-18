begin;

-- Issue #890 is deliberately additive.  Existing archive batches, the v1
-- object namespace, and stage-ledger-auto-retention-30d-v1 remain valid.
alter table public.chips_ledger_archive_batches
  drop constraint if exists chips_ledger_archive_batches_source_policy_check;

alter table public.chips_ledger_archive_batches
  add column bot_only_table_id uuid,
  add column bot_only_table_count bigint,
  add column bot_only_newest_created_at timestamptz,
  add column bot_only_registry_keys_sha256 text,
  add column bot_only_out_of_scope_keys_sha256 text,
  add column bot_only_identity_count bigint,
  add column bot_only_eligible_count bigint,
  add column registry_cleaned_at timestamptz,
  add column registry_cleaned_key_count bigint,
  add column registry_cleaned_keys_sha256 text,
  add column destructive_go_at timestamptz,
  add column destructive_go_batch_id bigint;

alter table public.chips_ledger_archive_batches
  add constraint chips_ledger_archive_batches_source_policy_check
  check (
    source_policy_id is null
    or source_policy_id in (
      'stage-ledger-auto-retention-30d-v1',
      'stage-ledger-bot-only-retention-7d-v1'
    )
  ),
  add constraint chips_ledger_archive_batches_bot_only_policy_check
    check (
      format_version <> 2
      or source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'
    ),
  add constraint chips_ledger_archive_batches_bot_only_evidence_check
    check (
      (
        format_version <> 2
        and bot_only_table_id is null
        and bot_only_table_count is null
        and bot_only_newest_created_at is null
        and bot_only_registry_keys_sha256 is null
        and bot_only_out_of_scope_keys_sha256 is null
        and bot_only_identity_count is null
        and bot_only_eligible_count is null
      ) or (
        format_version = 2
        and bot_only_table_id is not null
        and bot_only_table_count = 1
        and bot_only_newest_created_at is not null
        and bot_only_registry_keys_sha256 ~ '^[0-9a-f]{64}$'
        and bot_only_out_of_scope_keys_sha256 ~ '^[0-9a-f]{64}$'
        and bot_only_identity_count >= 1
        and bot_only_identity_count = transaction_count
        and bot_only_eligible_count = transaction_count
      )
    ),
  add constraint chips_ledger_archive_batches_cleanup_receipt_check
    check (
      (
        registry_cleaned_at is null
        and registry_cleaned_key_count is null
        and registry_cleaned_keys_sha256 is null
      ) or (
        format_version = 2
        and archive_proof_verified_at is not null
        and pruned_at is not null
        and bot_only_registry_keys_sha256 is not null
        and registry_cleaned_at is not null
        and registry_cleaned_key_count = transaction_count
        and registry_cleaned_key_count > 0
        and registry_cleaned_keys_sha256 = bot_only_registry_keys_sha256
      )
    ),
  add constraint chips_ledger_archive_batches_go_check
    check (
      (destructive_go_at is null and destructive_go_batch_id is null)
      or (destructive_go_at is not null and destructive_go_batch_id = batch_id)
    );

create index chips_ledger_archive_batches_bot_only_stage_idx
  on public.chips_ledger_archive_batches (
    project_ref,
    source_policy_id,
    status,
    pruned_at,
    registry_cleaned_at,
    created_at
  )
  where source_policy_id = 'stage-ledger-bot-only-retention-7d-v1';

alter table public.chips_transaction_idempotency
  add column table_id uuid,
  add column key_format_version integer,
  add column key_format text;

alter table public.chips_transaction_idempotency
  add constraint chips_transaction_idempotency_key_format_version_check
    check (key_format_version is null or key_format_version = 1),
  add constraint chips_transaction_idempotency_key_format_check
    check (key_format is null or length(trim(key_format)) > 0);

alter table public.poker_tables
  add column bot_only_proof_eligible boolean not null default false,
  add column bot_only_retention_complete_at timestamptz;

-- Existing false values are historical/uncertain and remain permanently
-- unqualified.  Only tables created after this migration receive the new
-- authoritative default.
alter table public.poker_tables
  alter column bot_only_proof_eligible set default true;

-- The additive migration installs both fences before runtime activation.  The
-- singleton control row is the only reversible switch; it is deliberately
-- OFF until all compatible producers have been deployed and verified.
create table public.chips_table_fence_control (
  control_id boolean primary key default true check (control_id is true),
  enforcement_active boolean not null default false,
  activated_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.chips_table_fence_control (control_id, enforcement_active)
values (true, false);

alter table public.chips_table_fence_control enable row level security;
revoke all on table public.chips_table_fence_control from public, anon, authenticated, service_role;

create or replace function public.chips_table_fence_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select control.enforcement_active
       from public.chips_table_fence_control control
      where control.control_id is true),
    false
  )
$$;

alter function public.chips_table_fence_is_active() owner to postgres;

create or replace function public.chips_guard_table_fence_control()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE'
     or old.control_id is distinct from new.control_id
     or current_user <> 'postgres'
     or coalesce(pg_catalog.current_setting('chips_table_fence_control', true), '') <> '1' then
    raise exception 'TABLE fence activation must use the owner-controlled gate';
  end if;
  return new;
end;
$$;

alter function public.chips_guard_table_fence_control() owner to postgres;

drop trigger if exists chips_table_fence_control_guard on public.chips_table_fence_control;
create trigger chips_table_fence_control_guard
before update or delete on public.chips_table_fence_control
for each row execute function public.chips_guard_table_fence_control();

create or replace function public.chips_set_table_fence_active(p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_active boolean := p_active;
begin
  if next_active is null then
    raise exception using errcode = 'P8900', message = 'TABLE fence activation cannot be NULL';
  end if;
  if not next_active and (
    exists (
      select 1 from public.chips_ledger_archive_batches batches
       where batches.registry_cleaned_at is not null
    ) or exists (
      select 1 from public.poker_tables tables
       where tables.bot_only_retention_complete_at is not null
    )
  ) then
    raise exception using errcode = 'P8900', message = 'TABLE fence cannot be deactivated after bot-only cleanup begins';
  end if;
  perform pg_catalog.set_config('chips_table_fence_control', '1', true);
  update public.chips_table_fence_control
     set enforcement_active = next_active,
         activated_at = case when next_active then coalesce(activated_at, pg_catalog.timezone('utc', pg_catalog.now())) else activated_at end,
         updated_at = pg_catalog.timezone('utc', pg_catalog.now())
   where control_id is true;
  return pg_catalog.jsonb_build_object(
    'state', case when next_active then 'active' else 'inactive' end,
    'enforcement_active', next_active
  );
end;
$$;

alter function public.chips_set_table_fence_active(boolean) owner to postgres;

create or replace function public.chips_parse_table_idempotency_key(p_key text)
returns jsonb
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  key_value text := pg_catalog.btrim(p_key);
  parts text[];
  format_name text;
  table_position integer;
  table_value text;
begin
  if key_value = '' or pg_catalog.length(key_value) > 240 then
    raise exception using
      errcode = 'P8901',
      message = 'TABLE idempotency key is empty or too long';
  end if;

  parts := pg_catalog.regexp_split_to_array(key_value, ':');
  if exists (select 1 from pg_catalog.unnest(parts) as values(value) where value = '') then
    raise exception using errcode = 'P8901', message = 'TABLE idempotency key contains an empty marker';
  end if;

  if key_value like 'join-buyin:%' then
    format_name := 'join-buyin';
    table_position := 2;
  elsif key_value like 'bot-seed-buyin:%' then
    format_name := 'bot-seed-buyin';
    table_position := 2;
  elsif key_value like 'managed-bot-seed-buyin:%' then
    format_name := 'managed-bot-seed-buyin';
    table_position := 2;
  elsif key_value like 'poker:leave:%' then
    format_name := 'poker:leave';
    table_position := 3;
  elsif key_value like 'poker:inactive_cleanup:%' then
    format_name := 'poker:inactive_cleanup';
    table_position := 3;
  elsif key_value like 'poker:rebuy:v1:%' then
    format_name := 'poker:rebuy:v1';
    table_position := 4;
  elsif key_value like 'poker:deferred-leave:v1:%' then
    format_name := 'poker:deferred-leave:v1';
    table_position := 4;
  elsif key_value like 'poker:bot-terminal-cashout:v1:%' then
    format_name := 'poker:bot-terminal-cashout:v1';
    table_position := 4;
  elsif key_value like 'poker:human-terminal-cashout:v1:%' then
    format_name := 'poker:human-terminal-cashout:v1';
    table_position := 4;
  elsif key_value like 'poker:bot-replacement-buyin:v1:%' then
    format_name := 'poker:bot-replacement-buyin:v1';
    table_position := 4;
  elsif key_value like 'poker:managed-bot-top-up:v1:%' then
    format_name := 'poker:managed-bot-top-up:v1';
    table_position := 4;
  else
    raise exception using errcode = 'P8901', message = 'TABLE idempotency key format is not supported';
  end if;

  if pg_catalog.cardinality(parts) <= table_position
     or exists (
       select 1
       from pg_catalog.generate_subscripts(parts, 1) as positions(position)
       where positions.position > table_position
         and parts[positions.position] = ''
     ) then
    raise exception using errcode = 'P8901', message = 'TABLE idempotency key suffix is incomplete';
  end if;

  table_value := pg_catalog.lower(pg_catalog.btrim(parts[table_position]));
  if table_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = 'P8901', message = 'TABLE idempotency key table id is invalid';
  end if;

  return pg_catalog.jsonb_build_object(
    'version', 1,
    'format', format_name,
    'table_id', table_value,
    'key', key_value
  );
end;
$$;

alter function public.chips_parse_table_idempotency_key(text) owner to postgres;

create or replace function public.chips_table_transaction_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parsed jsonb;
  key_table_id uuid;
  marker text;
  reference_table_id uuid;
  table_status text;
begin
  if new.tx_type::text not in ('TABLE_BUY_IN', 'TABLE_CASH_OUT') then
    return new;
  end if;
  if not public.chips_table_fence_is_active() then
    return new;
  end if;

  parsed := public.chips_parse_table_idempotency_key(new.idempotency_key);
  key_table_id := (parsed->>'table_id')::uuid;

  if new.metadata ? 'tableId' then
    marker := pg_catalog.lower(pg_catalog.btrim(new.metadata->>'tableId'));
    if marker = '' or marker !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or marker::uuid <> key_table_id then
      raise exception using
        errcode = 'P8902',
        message = 'TABLE metadata.tableId does not match the idempotency key';
    end if;
  end if;

  if new.reference is not null
     and new.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):' then
    marker := pg_catalog.lower(pg_catalog.btrim(pg_catalog.substring(new.reference, '^[^:]+:([^:]+)')));
    if marker = '' or marker !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P8902', message = 'TABLE reference marker is invalid';
    end if;
    reference_table_id := marker::uuid;
    if reference_table_id <> key_table_id then
      raise exception using errcode = 'P8902', message = 'TABLE reference does not match the idempotency key';
    end if;
  end if;

  select tables.status
    into table_status
    from public.poker_tables as tables
   where tables.id = key_table_id
   for update;
  if not found or pg_catalog.upper(coalesce(table_status, '')) <> 'OPEN' then
    raise exception using
      errcode = 'P8903',
      message = 'TABLE transaction is rejected because the table is closed or missing';
  end if;
  return new;
end;
$$;

alter function public.chips_table_transaction_before_insert() owner to postgres;

create or replace function public.chips_validate_table_transaction_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_id uuid;
  transaction_row record;
  parsed jsonb;
  key_table_id uuid;
  transaction_marker text;
  reference_table_id uuid;
  entry_count bigint;
  user_entry_count bigint;
  system_entry_count bigint;
  escrow_entry_count bigint;
  matching_escrow_count bigint;
  invalid_account_count bigint;
  invalid_entry_marker_count bigint;
  total_amount numeric;
  user_identity_count bigint;
  user_identity_mismatch_count bigint;
  buy_in_shape boolean;
  cash_out_shape boolean;
begin
  if not public.chips_table_fence_is_active() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if tg_table_name = 'chips_transactions' then
    transaction_id := new.id;
  elsif tg_op = 'DELETE' then
    transaction_id := old.transaction_id;
  else
    transaction_id := new.transaction_id;
  end if;
  select transactions.*
    into transaction_row
    from public.chips_transactions as transactions
   where transactions.id = transaction_id;
  if not found or transaction_row.tx_type::text not in ('TABLE_BUY_IN', 'TABLE_CASH_OUT') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  parsed := public.chips_parse_table_idempotency_key(transaction_row.idempotency_key);
  key_table_id := (parsed->>'table_id')::uuid;

  if transaction_row.metadata ? 'tableId' then
    transaction_marker := pg_catalog.lower(pg_catalog.btrim(transaction_row.metadata->>'tableId'));
    if transaction_marker = ''
       or transaction_marker !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or transaction_marker::uuid <> key_table_id then
      raise exception using
        errcode = 'P8904',
        message = 'TABLE transaction metadata does not bind to its idempotency key';
    end if;
  end if;

  if transaction_row.reference is not null
     and transaction_row.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):' then
    transaction_marker := pg_catalog.lower(pg_catalog.btrim(pg_catalog.substring(transaction_row.reference, '^[^:]+:([^:]+)')));
    if transaction_marker = ''
       or transaction_marker !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P8904', message = 'TABLE transaction reference marker is invalid';
    end if;
    reference_table_id := transaction_marker::uuid;
    if reference_table_id <> key_table_id then
      raise exception using errcode = 'P8904', message = 'TABLE transaction reference does not bind to its idempotency key';
    end if;
  end if;

  if not exists (
    select 1 from public.poker_tables tables where tables.id = key_table_id
  ) then
    raise exception using errcode = 'P8904', message = 'TABLE transaction table identity is missing';
  end if;

  select
    count(*),
    count(*) filter (where accounts.account_type::text = 'USER'),
    count(*) filter (where accounts.account_type::text = 'SYSTEM'),
    count(*) filter (where accounts.account_type::text = 'ESCROW'),
    count(*) filter (
      where accounts.account_type::text = 'ESCROW'
        and accounts.system_key = 'POKER_TABLE:' || key_table_id::text
    ),
    count(*) filter (where accounts.status::text <> 'active'),
    coalesce(sum(entries.amount), 0),
    count(*) filter (where accounts.account_type::text = 'USER' and accounts.user_id is not null),
    count(*) filter (
      where accounts.account_type::text = 'USER'
        and accounts.user_id is distinct from transaction_row.user_id
    )
    into entry_count, user_entry_count, system_entry_count, escrow_entry_count,
         matching_escrow_count, invalid_account_count, total_amount,
         user_identity_count, user_identity_mismatch_count
    from public.chips_entries as entries
    join public.chips_accounts as accounts on accounts.id = entries.account_id
   where entries.transaction_id = transaction_id;

  select count(*)
    into invalid_entry_marker_count
    from public.chips_entries as entries
   where entries.transaction_id = transaction_id
     and (
       entries.metadata ? 'tableId'
       and (
         entries.metadata->>'tableId' is null
         or pg_catalog.lower(pg_catalog.btrim(entries.metadata->>'tableId')) <> key_table_id::text
       )
     );

  buy_in_shape := transaction_row.tx_type::text = 'TABLE_BUY_IN'
    and (
      (user_entry_count = 1 and system_entry_count = 0 and escrow_entry_count = 1)
      or (user_entry_count = 0 and system_entry_count = 1 and escrow_entry_count = 1)
    )
    and exists (
      select 1 from public.chips_entries entries
      join public.chips_accounts accounts on accounts.id = entries.account_id
      where entries.transaction_id = transaction_id
        and accounts.account_type::text = 'ESCROW'
        and entries.amount > 0
    )
    and exists (
      select 1 from public.chips_entries entries
      join public.chips_accounts accounts on accounts.id = entries.account_id
      where entries.transaction_id = transaction_id
        and accounts.account_type::text in ('USER', 'SYSTEM')
        and entries.amount < 0
    );
  cash_out_shape := transaction_row.tx_type::text = 'TABLE_CASH_OUT'
    and (
      (user_entry_count = 1 and system_entry_count = 0 and escrow_entry_count = 1)
      or (user_entry_count = 0 and system_entry_count = 1 and escrow_entry_count = 1)
    )
    and exists (
      select 1 from public.chips_entries entries
      join public.chips_accounts accounts on accounts.id = entries.account_id
      where entries.transaction_id = transaction_id
        and accounts.account_type::text = 'ESCROW'
        and entries.amount < 0
    )
    and exists (
      select 1 from public.chips_entries entries
      join public.chips_accounts accounts on accounts.id = entries.account_id
      where entries.transaction_id = transaction_id
        and accounts.account_type::text in ('USER', 'SYSTEM')
        and entries.amount > 0
    );

  if entry_count <> 2
     or matching_escrow_count <> 1
     or invalid_account_count <> 0
     or invalid_entry_marker_count <> 0
     or total_amount <> 0
     or user_identity_mismatch_count <> 0
     or (transaction_row.user_id is null and user_entry_count <> 0)
     or (transaction_row.user_id is not null and (user_entry_count <> 1 or user_identity_count <> 1))
     or not (buy_in_shape or cash_out_shape) then
    raise exception using
      errcode = 'P8904',
      message = 'TABLE transaction entries do not bind to one authoritative ESCROW table';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function public.chips_validate_table_transaction_binding() owner to postgres;

drop trigger if exists chips_table_transaction_fence on public.chips_transactions;
create trigger chips_table_transaction_fence
before insert on public.chips_transactions
for each row execute function public.chips_table_transaction_before_insert();

drop trigger if exists chips_table_transaction_binding on public.chips_transactions;
create constraint trigger chips_table_transaction_binding
after insert on public.chips_transactions
deferrable initially deferred
for each row execute function public.chips_validate_table_transaction_binding();

drop trigger if exists chips_entries_table_transaction_binding on public.chips_entries;
create constraint trigger chips_entries_table_transaction_binding
after insert or update or delete on public.chips_entries
deferrable initially deferred
for each row execute function public.chips_validate_table_transaction_binding();

create or replace function public.chips_capture_transaction_idempotency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parsed jsonb;
  parsed_table_id uuid;
  fence_active boolean;
begin
  fence_active := public.chips_table_fence_is_active();
  if new.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT') then
    if fence_active then
      parsed := public.chips_parse_table_idempotency_key(new.idempotency_key);
    else
      begin
        parsed := public.chips_parse_table_idempotency_key(new.idempotency_key);
      exception when sqlstate 'P8901' then
        parsed := null;
      end;
    end if;
    parsed_table_id := (parsed->>'table_id')::uuid;
  end if;

  insert into public.chips_transaction_idempotency (
    idempotency_key,
    transaction_id,
    payload_hash,
    tx_type,
    user_id,
    transaction_created_at,
    table_id,
    key_format_version,
    key_format
  ) values (
    new.idempotency_key,
    new.id,
    new.payload_hash,
    new.tx_type,
    new.user_id,
    new.created_at,
    parsed_table_id,
    case when parsed is null then null else (parsed->>'version')::integer end,
    case when parsed is null then null else parsed->>'format' end
  );
  return new;
end;
$$;

alter function public.chips_capture_transaction_idempotency() owner to postgres;

-- Backfill only hot rows for which the authoritative transaction is still
-- available.  Unsupported historical keys intentionally remain NULL.
do $$
declare
  row_data record;
  parsed jsonb;
begin
  for row_data in
    select registry.idempotency_key, transactions.id, transactions.idempotency_key as tx_key
      from public.chips_transaction_idempotency registry
      join public.chips_transactions transactions on transactions.id = registry.transaction_id
     where transactions.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
       and registry.table_id is null
  loop
    begin
      parsed := public.chips_parse_table_idempotency_key(row_data.tx_key);
      update public.chips_transaction_idempotency
         set table_id = (parsed->>'table_id')::uuid,
             key_format_version = (parsed->>'version')::integer,
             key_format = parsed->>'format'
       where idempotency_key = row_data.idempotency_key;
    exception when others then
      -- Historical uncertainty is a deliberate fail-closed state.
      null;
    end;
  end loop;
end;
$$;

create or replace function public.chips_guard_idempotency_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if current_user = 'chips_ledger_archive_pruner'
       and pg_catalog.current_setting('chips_bot_registry_cleanup', true) = '1' then
      return old;
    end if;
    raise exception 'Idempotency registry rows are durable; DELETE is not permitted';
  end if;

  if new.idempotency_key is distinct from old.idempotency_key
    or new.transaction_id is distinct from old.transaction_id
    or new.payload_hash is distinct from old.payload_hash
    or new.tx_type is distinct from old.tx_type
    or new.user_id is distinct from old.user_id
    or new.transaction_created_at is distinct from old.transaction_created_at
    or new.created_at is distinct from old.created_at then
    raise exception 'Idempotency registry identity is immutable';
  end if;

  if old.table_id is not null
     or old.key_format_version is not null
     or old.key_format is not null then
    if new.table_id is distinct from old.table_id
       or new.key_format_version is distinct from old.key_format_version
       or new.key_format is distinct from old.key_format then
      raise exception 'Idempotency table binding cannot be replaced or cleared';
    end if;
  elsif new.table_id is not null
     or new.key_format_version is not null
     or new.key_format is not null then
    if current_user <> 'postgres' then
      raise exception 'Historical idempotency table binding may only be backfilled by migration';
    end if;
  end if;

  if old.replay_transaction is not null
    or old.replay_entries is not null
    or old.replay_completed_at is not null then
    if new.replay_transaction is distinct from old.replay_transaction
      or new.replay_entries is distinct from old.replay_entries
      or new.replay_completed_at is distinct from old.replay_completed_at then
      raise exception 'Completed idempotency replay cannot be replaced or cleared';
    end if;
  elsif not (
    new.replay_transaction is null
    and new.replay_entries is null
    and new.replay_completed_at is null
  ) and not (
    new.replay_transaction is not null
    and new.replay_entries is not null
    and new.replay_completed_at is not null
  ) then
    raise exception 'Idempotency replay must transition from empty to complete';
  end if;

  if new.archive_batch_id is distinct from old.archive_batch_id then
    if current_user <> 'chips_ledger_archive_pruner' then
      raise exception 'Idempotency archive mapping may only be written by the archive pruner';
    end if;
    if old.archive_batch_id is not null then
      raise exception 'Idempotency archive mapping cannot be replaced or cleared';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.chips_guard_poker_table_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.has_human_participant is true and new.has_human_participant is not true then
    raise exception using errcode = 'P8905', message = 'has_human_participant is one-way';
  end if;

  if new.bot_only_proof_eligible is distinct from old.bot_only_proof_eligible then
    raise exception using errcode = 'P8906', message = 'bot-only proof eligibility is immutable';
  end if;

  if new.bot_only_retention_complete_at is distinct from old.bot_only_retention_complete_at then
    if old.bot_only_retention_complete_at is not null
       or new.bot_only_retention_complete_at is null
       or new.has_human_participant is true
       or new.bot_only_proof_eligible is not true
       or current_user <> 'chips_ledger_archive_pruner'
       or coalesce(pg_catalog.current_setting('chips_bot_only_lifecycle', true), '') <> '1'
       or not exists (
         select 1
           from public.chips_ledger_archive_batches batches
          where batches.bot_only_table_id = new.id
            and batches.format_version = 2
            and batches.source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'
            and batches.archive_proof_verified_at is not null
            and batches.pruned_at is not null
            and batches.registry_cleaned_at is not null
            and batches.registry_cleaned_key_count = batches.transaction_count
            and batches.registry_cleaned_keys_sha256 = batches.bot_only_registry_keys_sha256
            and not exists (
              select 1
                from public.chips_transaction_idempotency registry
               where registry.table_id = new.id
            )
       ) then
      raise exception using errcode = 'P8907', message = 'bot-only table lifecycle marker transition is not authorized';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists poker_tables_guard_human_participant on public.poker_tables;
create trigger poker_tables_guard_human_participant
before update of has_human_participant, bot_only_proof_eligible, bot_only_retention_complete_at
on public.poker_tables
for each row execute function public.chips_guard_poker_table_mutations();

-- The existing v1 proof/prune guard remains in place, but now also protects
-- v2 evidence, the cleanup receipt, and the exact-batch GO latch.
create or replace function public.chips_guard_archive_batch_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_proof_count integer;
  new_proof_count integer;
  old_receipt_count integer;
  new_receipt_count integer;
  old_bot_proof_count integer;
  new_bot_proof_count integer;
  old_cleanup_count integer;
  new_cleanup_count integer;
  proof_changed boolean;
  receipt_changed boolean;
  bot_proof_changed boolean;
  cleanup_changed boolean;
  go_changed boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'Archive batch rows are durable; DELETE is not permitted';
  end if;

  if new.object_path is distinct from old.object_path
    or new.batch_id is distinct from old.batch_id
    or new.project_ref is distinct from old.project_ref
    or new.format_version is distinct from old.format_version
    or new.cutoff is distinct from old.cutoff
    or new.cursor_start_created_at is distinct from old.cursor_start_created_at
    or new.cursor_start_id is distinct from old.cursor_start_id
    or new.cursor_end_created_at is distinct from old.cursor_end_created_at
    or new.cursor_end_id is distinct from old.cursor_end_id
    or new.first_created_at is distinct from old.first_created_at
    or new.last_created_at is distinct from old.last_created_at
    or new.transaction_count is distinct from old.transaction_count
    or new.entry_count is distinct from old.entry_count
    or new.tx_types is distinct from old.tx_types
    or new.raw_bytes is distinct from old.raw_bytes
    or new.compressed_bytes is distinct from old.compressed_bytes
    or new.raw_sha256 is distinct from old.raw_sha256
    or new.compressed_sha256 is distinct from old.compressed_sha256
    or new.credits is distinct from old.credits
    or new.debits is distinct from old.debits
    or new.net_amount is distinct from old.net_amount
    or new.created_at is distinct from old.created_at
    or new.source_policy_id is distinct from old.source_policy_id then
    raise exception 'Archive batch proof fields are immutable';
  end if;

  proof_changed := new.archived_transaction_ids_sha256 is distinct from old.archived_transaction_ids_sha256
    or new.archived_entry_ids_sha256 is distinct from old.archived_entry_ids_sha256
    or new.archive_proof_verified_at is distinct from old.archive_proof_verified_at;
  receipt_changed := new.pruned_at is distinct from old.pruned_at
    or new.pruned_transaction_count is distinct from old.pruned_transaction_count
    or new.pruned_entry_count is distinct from old.pruned_entry_count
    or new.pruned_transaction_ids_sha256 is distinct from old.pruned_transaction_ids_sha256
    or new.pruned_entry_ids_sha256 is distinct from old.pruned_entry_ids_sha256;
  bot_proof_changed := new.bot_only_table_id is distinct from old.bot_only_table_id
    or new.bot_only_table_count is distinct from old.bot_only_table_count
    or new.bot_only_newest_created_at is distinct from old.bot_only_newest_created_at
    or new.bot_only_registry_keys_sha256 is distinct from old.bot_only_registry_keys_sha256
    or new.bot_only_out_of_scope_keys_sha256 is distinct from old.bot_only_out_of_scope_keys_sha256
    or new.bot_only_identity_count is distinct from old.bot_only_identity_count
    or new.bot_only_eligible_count is distinct from old.bot_only_eligible_count;
  cleanup_changed := new.registry_cleaned_at is distinct from old.registry_cleaned_at
    or new.registry_cleaned_key_count is distinct from old.registry_cleaned_key_count
    or new.registry_cleaned_keys_sha256 is distinct from old.registry_cleaned_keys_sha256;
  go_changed := new.destructive_go_at is distinct from old.destructive_go_at
    or new.destructive_go_batch_id is distinct from old.destructive_go_batch_id;

  if receipt_changed and cleanup_changed then
    raise exception 'Archive prune receipt and registry cleanup receipt require separate transitions';
  end if;
  if receipt_changed
     and new.format_version = 2
     and (
       coalesce(pg_catalog.current_setting('chips_bot_only_prune', true), '') <> '1'
       or new.destructive_go_at is null
       or new.destructive_go_batch_id is distinct from new.batch_id
     ) then
    raise exception using
      errcode = 'P8911',
      message = 'Schema-v2 bot-only batches require the exact lifecycle operator and batch GO';
  end if;
  if (proof_changed or bot_proof_changed) and current_user <> 'chips_ledger_archive_pruner' then
    raise exception 'Archive proof may only be written by the archive pruner';
  end if;
  if bot_proof_changed
     and coalesce(pg_catalog.current_setting('chips_bot_only_proof', true), '') <> '1' then
    raise exception 'Bot-only proof may only be written by the lifecycle proof operator';
  end if;
  if (receipt_changed or cleanup_changed) and current_user <> 'chips_ledger_archive_pruner' then
    raise exception 'Archive receipt may only be written by the archive pruner';
  end if;
  if cleanup_changed
     and coalesce(pg_catalog.current_setting('chips_bot_cleanup_receipt', true), '') <> '1' then
    raise exception 'Bot-only cleanup receipt may only be written by the lifecycle cleanup operator';
  end if;
  if go_changed and not (
    current_user = 'postgres'
    and coalesce(pg_catalog.current_setting('chips_bot_only_go', true), '') = '1'
  ) then
    raise exception 'Bot-only destructive GO may only be written by the exact authorization function';
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'pending' or new.status <> 'committed'
      or old.committed_at is not null or new.committed_at is null then
      raise exception 'Archive batch status may only transition pending to committed';
    end if;
  elsif new.committed_at is distinct from old.committed_at then
    raise exception 'Archive batch committed_at is immutable';
  end if;

  old_proof_count := pg_catalog.num_nonnulls(old.archived_transaction_ids_sha256, old.archived_entry_ids_sha256, old.archive_proof_verified_at);
  new_proof_count := pg_catalog.num_nonnulls(new.archived_transaction_ids_sha256, new.archived_entry_ids_sha256, new.archive_proof_verified_at);
  if old_proof_count = 0 then
    if new_proof_count not in (0, 3) then raise exception 'Archive ID proof must transition from empty to complete'; end if;
    if new_proof_count = 3 and new.status <> 'committed' then raise exception 'Archive ID proof requires a committed batch'; end if;
  elsif proof_changed then
    raise exception 'Archive ID proof cannot be replaced or cleared';
  end if;

  old_receipt_count := pg_catalog.num_nonnulls(old.pruned_at, old.pruned_transaction_count, old.pruned_entry_count, old.pruned_transaction_ids_sha256, old.pruned_entry_ids_sha256);
  new_receipt_count := pg_catalog.num_nonnulls(new.pruned_at, new.pruned_transaction_count, new.pruned_entry_count, new.pruned_transaction_ids_sha256, new.pruned_entry_ids_sha256);
  if old_receipt_count = 0 then
    if new_receipt_count not in (0, 5) then raise exception 'Archive prune receipt must transition from empty to complete'; end if;
    if new_receipt_count = 5 and new_proof_count <> 3 then raise exception 'Archive prune receipt requires an immutable ID proof'; end if;
  elsif receipt_changed then
    raise exception 'Archive prune receipt cannot be replaced or cleared';
  end if;

  old_bot_proof_count := pg_catalog.num_nonnulls(old.bot_only_table_id, old.bot_only_table_count, old.bot_only_newest_created_at, old.bot_only_registry_keys_sha256, old.bot_only_out_of_scope_keys_sha256, old.bot_only_identity_count, old.bot_only_eligible_count);
  new_bot_proof_count := pg_catalog.num_nonnulls(new.bot_only_table_id, new.bot_only_table_count, new.bot_only_newest_created_at, new.bot_only_registry_keys_sha256, new.bot_only_out_of_scope_keys_sha256, new.bot_only_identity_count, new.bot_only_eligible_count);
  if old_bot_proof_count = 0 then
    if new_bot_proof_count not in (0, 7) then raise exception 'Bot-only proof must transition from empty to complete'; end if;
    if new_bot_proof_count = 7 and (new.status <> 'committed' or new.format_version <> 2) then raise exception 'Bot-only proof requires a committed schema-v2 batch'; end if;
  elsif bot_proof_changed then
    raise exception 'Bot-only proof cannot be replaced or cleared';
  end if;

  old_cleanup_count := pg_catalog.num_nonnulls(old.registry_cleaned_at, old.registry_cleaned_key_count, old.registry_cleaned_keys_sha256);
  new_cleanup_count := pg_catalog.num_nonnulls(new.registry_cleaned_at, new.registry_cleaned_key_count, new.registry_cleaned_keys_sha256);
  if old_cleanup_count = 0 then
    if new_cleanup_count not in (0, 3) then raise exception 'Registry cleanup receipt must transition from empty to complete'; end if;
    if new_cleanup_count = 3 and (new_bot_proof_count <> 7 or new_receipt_count <> 5) then raise exception 'Registry cleanup receipt requires bot-only proof and ledger prune receipt'; end if;
  elsif cleanup_changed then
    raise exception 'Registry cleanup receipt cannot be replaced or cleared';
  end if;

  if old.destructive_go_at is not null and go_changed then
    raise exception 'Bot-only destructive GO cannot be replaced or cleared';
  end if;
  return new;
end;
$$;

drop trigger if exists poker_tables_guard_human_participant on public.poker_tables;
create trigger poker_tables_guard_human_participant
before update of has_human_participant, bot_only_proof_eligible, bot_only_retention_complete_at
on public.poker_tables
for each row execute function public.chips_guard_poker_table_mutations();

drop trigger if exists chips_ledger_archive_batches_guard on public.chips_ledger_archive_batches;
create trigger chips_ledger_archive_batches_guard
before update or delete on public.chips_ledger_archive_batches
for each row execute function public.chips_guard_archive_batch_mutations();

grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

create or replace function public.chips_archive_text_ids_sha256(p_ids text[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  payload text;
begin
  if p_ids is null or (pg_catalog.array_ndims(p_ids) is not null and pg_catalog.array_ndims(p_ids) <> 1)
     or pg_catalog.array_position(p_ids, null) is not null then
    raise exception 'Text ID proof requires a one-dimensional non-null text array';
  end if;
  select coalesce(pg_catalog.string_agg(value || E'\n', '' order by value), '')
    into payload
    from pg_catalog.unnest(p_ids) as values(value);
  return pg_catalog.encode(extensions.digest(pg_catalog.convert_to(payload, 'UTF8'), 'sha256'), 'hex');
end;
$$;

reset role;

-- Recreate the public wrapper so the unchanged 30-day pruner cannot be used
-- to execute a schema-v2 bot-only batch without the lifecycle operator.
-- The existing wrapper remains owned by the established pruner role.  The
-- archive-batch guard above blocks its destructive schema-v2 path by code
-- P8911; the existing 30-day path is unchanged.

-- This gate is intentionally never called by automation in this change.  A
-- future owner action must name the exact batch and use the exact confirmation
-- string, so GO cannot roll forward to a different object.
create or replace function public.chips_authorize_bot_only_archive_batch(
  p_batch_id bigint,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
begin
  if p_confirmation is distinct from ('GO ' || p_batch_id::text) then
    raise exception using errcode = 'P8912', message = 'Exact bot-only batch GO confirmation is required';
  end if;
  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.batch_id = p_batch_id
   for update;
  if not found or batch.status <> 'committed'
     or batch.format_version <> 2
     or batch.source_policy_id <> 'stage-ledger-bot-only-retention-7d-v1'
     or batch.project_ref <> 'krydukthwdvccggbyjfw'
     or batch.archive_proof_verified_at is null
     or batch.bot_only_table_id is null
     or batch.pruned_at is not null
     or batch.registry_cleaned_at is not null then
    raise exception using errcode = 'P8912', message = 'Only one exact committed Stage bot-only batch may be authorized';
  end if;
  perform public.chips_assert_archive_prune_target(batch.project_ref, batch.transaction_count);
  perform pg_catalog.set_config('chips_bot_only_go', '1', true);
  update public.chips_ledger_archive_batches
     set destructive_go_at = pg_catalog.timezone('utc', pg_catalog.now()),
         destructive_go_batch_id = batch.batch_id
   where chips_ledger_archive_batches.batch_id = batch.batch_id
     and destructive_go_at is null;
  return pg_catalog.jsonb_build_object('state', 'authorized', 'batch_id', batch.batch_id);
end;
$$;

set role chips_ledger_archive_pruner;

create or replace function public.chips_assert_bot_only_table_lifecycle_gate(
  p_table_id uuid,
  p_batch_id bigint,
  p_cutoff timestamptz,
  p_registry_keys text[]
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  table_row record;
  escrow_count bigint;
  unknown_registry_count bigint;
  unknown_hot_count bigint;
  human_registry_count bigint;
  young_registry_count bigint;
  incomplete_old_count bigint;
  newest_created_at timestamptz;
begin
  if not public.chips_table_fence_is_active() then
    raise exception using errcode = 'P8913', message = 'Bot-only lifecycle gate requires the active TABLE fence';
  end if;
  if p_batch_id is null or not exists (
    select 1
      from public.chips_ledger_archive_batches batches
     where batches.batch_id = p_batch_id
       and batches.status = 'committed'
       and batches.format_version = 2
       and batches.source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'
       and batches.cutoff = p_cutoff
  ) then
    raise exception using errcode = 'P8913', message = 'Bot-only lifecycle gate requires the exact committed schema-v2 batch';
  end if;
  select tables.id, tables.status, tables.has_human_participant, tables.bot_only_proof_eligible, tables.bot_only_retention_complete_at
    into table_row
    from public.poker_tables tables
   where tables.id = p_table_id
   for update;
  if not found then raise exception using errcode = 'P8913', message = 'Bot-only table is missing'; end if;
  if pg_catalog.upper(table_row.status::text) <> 'CLOSED' then raise exception using errcode = 'P8913', message = 'Bot-only table is not CLOSED'; end if;
  if table_row.has_human_participant is true then raise exception using errcode = 'P8913', message = 'Human-participant table is outside bot-only retention'; end if;
  if table_row.bot_only_proof_eligible is not true then raise exception using errcode = 'P8913', message = 'Historical bot-only proof is uncertain'; end if;

  select count(*) into escrow_count
    from public.chips_accounts accounts
   where accounts.account_type::text = 'ESCROW'
     and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
     and accounts.status::text = 'active'
     and accounts.balance = 0;
  if escrow_count <> 1 then raise exception using errcode = 'P8913', message = 'Bot-only table escrow is not active and zero'; end if;

  select count(*) into unknown_registry_count
    from public.chips_transaction_idempotency registry
   where registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.table_id is null;
  select count(*) into unknown_hot_count
    from public.chips_transactions transactions
    left join public.chips_transaction_idempotency registry on registry.transaction_id = transactions.id
   where transactions.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.table_id is null;
  if unknown_registry_count <> 0 or unknown_hot_count <> 0 then
    raise exception using errcode = 'P8914', message = 'Unknown TABLE identity blocks bot-only lifecycle completion';
  end if;

  select count(*) into human_registry_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.user_id is not null;
  if human_registry_count <> 0 then raise exception using errcode = 'P8914', message = 'USER TABLE identity blocks bot-only lifecycle completion'; end if;

  select count(*) into young_registry_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.user_id is null
     and registry.transaction_created_at >= p_cutoff;
  if young_registry_count <> 0 then raise exception using errcode = 'P8915', message = 'Young TABLE identity blocks bot-only lifecycle completion'; end if;

  select count(*) into incomplete_old_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.user_id is null
     and registry.transaction_created_at < p_cutoff
     and not (
       registry.idempotency_key = any(coalesce(p_registry_keys, array[]::text[]))
       or exists (
         select 1
           from public.chips_ledger_archive_batches batches
          where batches.batch_id = registry.archive_batch_id
            and batches.format_version = 2
            and batches.source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'
            and batches.pruned_at is not null
            and batches.registry_cleaned_at is not null
       )
     );
  if incomplete_old_count <> 0 then raise exception using errcode = 'P8916', message = 'Old TABLE identity is not fully archived, pruned, and cleaned'; end if;

  select max(value) into newest_created_at
    from (
      select max(registry.transaction_created_at) as value
        from public.chips_transaction_idempotency registry
       where registry.table_id = p_table_id
      union all
      select max(batches.bot_only_newest_created_at)
        from public.chips_ledger_archive_batches batches
       where batches.bot_only_table_id = p_table_id
         and batches.format_version = 2
         and batches.source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'
         and batches.registry_cleaned_at is not null
    ) known;
  if newest_created_at is null or newest_created_at >= p_cutoff then
    raise exception using errcode = 'P8915', message = 'Newest known TABLE identity is not older than the bot-only cutoff';
  end if;

  return pg_catalog.jsonb_build_object(
    'state', 'table_complete',
    'table_id', p_table_id,
    'newest_created_at', newest_created_at,
    'unknown_registry', unknown_registry_count,
    'unknown_hot', unknown_hot_count,
    'protected_registry', human_registry_count
  );
end;
$$;

create or replace function public.chips_register_bot_only_archive_proof(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_table_id uuid,
  p_registry_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  actual_transaction_ids uuid[];
  actual_entry_ids bigint[];
  actual_registry_keys text[];
  sorted_registry_keys text[];
  out_of_scope_keys text[];
  transaction_ids_sha256 text;
  entry_ids_sha256 text;
  registry_keys_sha256 text;
  out_of_scope_keys_sha256 text;
  expected_transaction_count bigint;
  expected_entry_count bigint;
  actual_table_count bigint;
  actual_identity_count bigint;
  actual_eligible_count bigint;
  invalid_registry_binding_count bigint;
  newest_created_at timestamptz;
  table_row record;
  invalid_shape_count bigint;
  updated_count bigint;
begin
  perform public.chips_assert_archive_prune_target('krydukthwdvccggbyjfw', pg_catalog.cardinality(p_transaction_ids));
  if p_transaction_ids is null or p_entry_ids is null or p_registry_keys is null
     or pg_catalog.cardinality(p_transaction_ids) < 1
     or pg_catalog.cardinality(p_transaction_ids) > 5000
     or pg_catalog.cardinality(p_entry_ids) < 1
     or pg_catalog.cardinality(p_registry_keys) <> pg_catalog.cardinality(p_transaction_ids) then
    raise exception using errcode = 'P8917', message = 'Bot-only proof batch arrays are invalid';
  end if;
  if (select count(*) from pg_catalog.unnest(p_transaction_ids) as values(value)) <> (select count(distinct value) from pg_catalog.unnest(p_transaction_ids) as values(value))
     or (select count(*) from pg_catalog.unnest(p_entry_ids) as values(value)) <> (select count(distinct value) from pg_catalog.unnest(p_entry_ids) as values(value))
     or (select count(*) from pg_catalog.unnest(p_registry_keys) as values(value)) <> (select count(distinct value) from pg_catalog.unnest(p_registry_keys) as values(value)) then
    raise exception using errcode = 'P8917', message = 'Bot-only proof batch arrays contain duplicates';
  end if;

  transaction_ids_sha256 := public.chips_archive_uuid_ids_sha256(p_transaction_ids);
  entry_ids_sha256 := public.chips_archive_bigint_ids_sha256(p_entry_ids);

  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.object_path = p_object_path
   for update;
  if not found then raise exception using errcode = 'P8917', message = 'Committed bot-only archive manifest was not found'; end if;
  if batch.status <> 'committed'
     or batch.project_ref <> 'krydukthwdvccggbyjfw'
     or batch.format_version <> 2
     or batch.source_policy_id <> 'stage-ledger-bot-only-retention-7d-v1' then
    raise exception using errcode = 'P8917', message = 'Bot-only proof requires a committed canonical Stage schema-v2 batch';
  end if;
  if batch.object_path <> ('v1/sha256/' || batch.compressed_sha256 || '.jsonl.gz') then
    raise exception using errcode = 'P8917', message = 'Bot-only object path does not match compressed SHA-256';
  end if;
  if batch.transaction_count <> pg_catalog.cardinality(p_transaction_ids)
     or batch.entry_count <> pg_catalog.cardinality(p_entry_ids) then
    raise exception using errcode = 'P8917', message = 'Bot-only proof counts do not match the manifest';
  end if;

  select pg_catalog.array_agg(transactions.id order by transactions.created_at, transactions.id)
    into actual_transaction_ids
    from public.chips_transactions transactions
   where transactions.id = any(p_transaction_ids);
  if actual_transaction_ids is distinct from p_transaction_ids then raise exception using errcode = 'P8917', message = 'Bot-only transaction order does not match the hot ledger'; end if;

  with wanted as (
    select ids.id, ids.ordinality from pg_catalog.unnest(p_transaction_ids) with ordinality ids(id, ordinality)
  )
  select pg_catalog.array_agg(entries.id order by wanted.ordinality, entries.id)
    into actual_entry_ids
    from wanted join public.chips_entries entries on entries.transaction_id = wanted.id;
  if actual_entry_ids is distinct from p_entry_ids then raise exception using errcode = 'P8917', message = 'Bot-only entry order does not match the hot ledger'; end if;

  select tables.id, tables.status, tables.has_human_participant, tables.bot_only_proof_eligible
    into table_row
    from public.poker_tables tables
   where tables.id = p_table_id
   for update;
  if not found or pg_catalog.upper(coalesce(table_row.status::text, '')) <> 'CLOSED' or table_row.has_human_participant is true or table_row.bot_only_proof_eligible is not true then
    raise exception using errcode = 'P8918', message = 'Bot-only proof requires an authoritative closed bot-only table';
  end if;

  select count(*) into actual_table_count
    from (
      select distinct (public.chips_parse_table_idempotency_key(transactions.idempotency_key)->>'table_id')::uuid as table_id
        from public.chips_transactions transactions
       where transactions.id = any(p_transaction_ids)
    ) tables;
  if actual_table_count <> 1 or exists (
    select 1
      from public.chips_transactions transactions
     where transactions.id = any(p_transaction_ids)
       and (public.chips_parse_table_idempotency_key(transactions.idempotency_key)->>'table_id')::uuid <> p_table_id
  ) then
    raise exception using errcode = 'P8918', message = 'Bot-only proof has more than one table identity';
  end if;

  select count(*) into invalid_shape_count
    from (
      select transactions.id
        from public.chips_transactions transactions
        join public.chips_entries entries on entries.transaction_id = transactions.id
        join public.chips_accounts accounts on accounts.id = entries.account_id
       where transactions.id = any(p_transaction_ids)
       group by transactions.id, transactions.tx_type, transactions.user_id, transactions.created_at,
                transactions.metadata, transactions.reference
      having transactions.tx_type::text not in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
          or transactions.user_id is not null
          or transactions.created_at >= batch.cutoff
          or (transactions.metadata ? 'tableId'
              and pg_catalog.lower(pg_catalog.btrim(transactions.metadata->>'tableId')) <> p_table_id::text)
          or (transactions.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):'
              and pg_catalog.lower(pg_catalog.substring(transactions.reference, '^[^:]+:([^:]+)')) <> p_table_id::text)
          or count(*) <> 2
          or count(*) filter (where accounts.account_type::text = 'USER') <> 0
          or count(*) filter (where accounts.account_type::text = 'SYSTEM') <> 1
          or count(*) filter (where accounts.account_type::text = 'ESCROW') <> 1
          or count(*) filter (where accounts.account_type::text = 'ESCROW' and accounts.system_key = 'POKER_TABLE:' || p_table_id::text) <> 1
          or not bool_and(accounts.status::text = 'active')
          or sum(entries.amount) <> 0
          or (transactions.tx_type::text = 'TABLE_BUY_IN' and (sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM') >= 0 or sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW') <= 0))
          or (transactions.tx_type::text = 'TABLE_CASH_OUT' and (sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW') >= 0 or sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM') <= 0))
    ) invalid;
  if invalid_shape_count <> 0 then raise exception using errcode = 'P8918', message = 'Bot-only proof is outside the technical TABLE whitelist'; end if;

  select pg_catalog.array_agg(registry.idempotency_key order by registry.idempotency_key)
    into actual_registry_keys
    from public.chips_transaction_idempotency registry
   where registry.transaction_id = any(p_transaction_ids)
     and registry.table_id = p_table_id
     and registry.archive_batch_id is null;
  select pg_catalog.array_agg(value order by value)
    into sorted_registry_keys
    from pg_catalog.unnest(p_registry_keys) as values(value);
  if actual_registry_keys is distinct from sorted_registry_keys then raise exception using errcode = 'P8919', message = 'Bot-only registry key proof does not match the hot registry'; end if;
  select count(*)
    into invalid_registry_binding_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and (
       registry.key_format_version is distinct from 1
       or registry.key_format is distinct from (
         public.chips_parse_table_idempotency_key(registry.idempotency_key)->>'format'
       )
     );
  if invalid_registry_binding_count <> 0 then
    raise exception using errcode = 'P8919', message = 'Bot-only registry format does not match the server-verifiable key';
  end if;
  registry_keys_sha256 := public.chips_archive_text_ids_sha256(sorted_registry_keys);

  select pg_catalog.array_agg(registry.idempotency_key order by registry.idempotency_key)
    into out_of_scope_keys
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and not (registry.idempotency_key = any(sorted_registry_keys));
  out_of_scope_keys := coalesce(out_of_scope_keys, array[]::text[]);
  out_of_scope_keys_sha256 := public.chips_archive_text_ids_sha256(out_of_scope_keys);
  select count(*) into actual_identity_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id;
  actual_eligible_count := pg_catalog.cardinality(p_transaction_ids);
  if actual_identity_count <> actual_eligible_count then
    raise exception using errcode = 'P8919', message = 'Bot-only registry identity count does not match the complete eligible set';
  end if;
  select max(registry.transaction_created_at) into newest_created_at
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id;
  if newest_created_at is null or newest_created_at >= batch.cutoff then raise exception using errcode = 'P8915', message = 'Bot-only proof newest identity has not crossed the seven-day cutoff'; end if;

  perform public.chips_assert_bot_only_table_lifecycle_gate(p_table_id, batch.batch_id, batch.cutoff, sorted_registry_keys);

  if batch.archive_proof_verified_at is not null then
    if batch.archived_transaction_ids_sha256 is distinct from transaction_ids_sha256
       or batch.archived_entry_ids_sha256 is distinct from entry_ids_sha256
       or batch.bot_only_table_id is distinct from p_table_id
       or batch.bot_only_registry_keys_sha256 is distinct from registry_keys_sha256 then
      raise exception using errcode = 'P8920', message = 'Existing bot-only proof differs from the requested evidence';
    end if;
    return pg_catalog.jsonb_build_object('state', 'proof_exists', 'transactions', batch.transaction_count, 'entries', batch.entry_count);
  end if;

  perform pg_catalog.set_config('chips_bot_only_proof', '1', true);
  update public.chips_ledger_archive_batches batches
     set archived_transaction_ids_sha256 = transaction_ids_sha256,
         archived_entry_ids_sha256 = entry_ids_sha256,
         archive_proof_verified_at = pg_catalog.timezone('utc', pg_catalog.now()),
         bot_only_table_id = p_table_id,
         bot_only_table_count = 1,
         bot_only_newest_created_at = newest_created_at,
         bot_only_registry_keys_sha256 = registry_keys_sha256,
         bot_only_out_of_scope_keys_sha256 = out_of_scope_keys_sha256,
         bot_only_identity_count = actual_identity_count,
         bot_only_eligible_count = actual_eligible_count
   where batches.batch_id = batch.batch_id
     and batches.archive_proof_verified_at is null;
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then raise exception using errcode = 'P8920', message = 'Bot-only proof transition was not unique'; end if;
  return pg_catalog.jsonb_build_object('state', 'proof_registered', 'transactions', batch.transaction_count, 'entries', batch.entry_count, 'table_id', p_table_id, 'registry_keys_sha256', registry_keys_sha256);
end;
$$;

create or replace function public.chips_prune_and_cleanup_bot_only_archive_batch(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_registry_keys text[],
  p_table_id uuid,
  p_execute boolean default false,
  p_approved_batch_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  registry_keys_sha256 text;
  prune_result jsonb;
  deleted_registry_count bigint;
begin
  if p_execute is null then raise exception using errcode = 'P8921', message = 'Bot-only execute flag must not be NULL'; end if;
  if p_registry_keys is null
     or pg_catalog.cardinality(p_registry_keys) < 1
     or pg_catalog.cardinality(p_registry_keys) <> pg_catalog.cardinality(p_transaction_ids) then
    raise exception using errcode = 'P8921', message = 'Bot-only cleanup registry key set is invalid';
  end if;
  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.object_path = p_object_path
   for update;
  if not found or batch.project_ref <> 'krydukthwdvccggbyjfw' or batch.format_version <> 2 or batch.source_policy_id <> 'stage-ledger-bot-only-retention-7d-v1' then
    raise exception using errcode = 'P8921', message = 'Bot-only cleanup requires a canonical Stage schema-v2 batch';
  end if;
  perform public.chips_assert_archive_prune_target(batch.project_ref, pg_catalog.cardinality(p_transaction_ids));
  if batch.bot_only_table_id is distinct from p_table_id
     or batch.transaction_count <> pg_catalog.cardinality(p_transaction_ids)
     or batch.entry_count <> pg_catalog.cardinality(p_entry_ids)
     or batch.archive_proof_verified_at is null
     or batch.archived_transaction_ids_sha256 <> public.chips_archive_uuid_ids_sha256(p_transaction_ids)
     or batch.archived_entry_ids_sha256 <> public.chips_archive_bigint_ids_sha256(p_entry_ids) then
    raise exception using errcode = 'P8921', message = 'Bot-only cleanup arguments do not match immutable proof';
  end if;
  registry_keys_sha256 := public.chips_archive_text_ids_sha256(p_registry_keys);
  if registry_keys_sha256 <> batch.bot_only_registry_keys_sha256 then raise exception using errcode = 'P8921', message = 'Bot-only cleanup keys do not match immutable proof'; end if;

  if batch.registry_cleaned_at is not null then
    if batch.registry_cleaned_key_count <> pg_catalog.cardinality(p_registry_keys)
       or batch.registry_cleaned_keys_sha256 <> registry_keys_sha256 then
      raise exception using errcode = 'P8922', message = 'Existing bot-only cleanup receipt differs from the retry';
    end if;
    return pg_catalog.jsonb_build_object('state', 'already_cleaned', 'transactions', batch.transaction_count, 'registry_keys', batch.registry_cleaned_key_count);
  end if;

  perform public.chips_assert_bot_only_table_lifecycle_gate(batch.bot_only_table_id, batch.batch_id, batch.cutoff, p_registry_keys);
  if not p_execute then
    prune_result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, false);
    return prune_result || pg_catalog.jsonb_build_object('cleanup', 'prepare_only', 'table_id', batch.bot_only_table_id);
  end if;
  if p_approved_batch_id is distinct from batch.batch_id or batch.destructive_go_batch_id is distinct from batch.batch_id or batch.destructive_go_at is null then
    raise exception using errcode = 'P8923', message = 'Exact bot-only batch GO is required before destructive cleanup';
  end if;

  perform pg_catalog.set_config('chips_bot_only_prune', '1', true);
  prune_result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, true);
  perform public.chips_assert_bot_only_table_lifecycle_gate(batch.bot_only_table_id, batch.batch_id, batch.cutoff, p_registry_keys);
  select count(*) into deleted_registry_count
    from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id
     and registry.idempotency_key = any(p_registry_keys);
  if deleted_registry_count <> pg_catalog.cardinality(p_registry_keys) then raise exception using errcode = 'P8924', message = 'Bot-only registry cleanup set is incomplete'; end if;

  perform pg_catalog.set_config('chips_bot_registry_cleanup', '1', true);
  delete from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id
     and registry.idempotency_key = any(p_registry_keys);
  get diagnostics deleted_registry_count = row_count;
  if deleted_registry_count <> pg_catalog.cardinality(p_registry_keys) then raise exception using errcode = 'P8924', message = 'Bot-only registry DELETE count mismatch'; end if;

  perform pg_catalog.set_config('chips_bot_cleanup_receipt', '1', true);
  update public.chips_ledger_archive_batches batches
     set registry_cleaned_at = pg_catalog.timezone('utc', pg_catalog.now()),
         registry_cleaned_key_count = pg_catalog.cardinality(p_registry_keys),
         registry_cleaned_keys_sha256 = registry_keys_sha256
   where batches.batch_id = batch.batch_id
     and batches.registry_cleaned_at is null;
  if not found then raise exception using errcode = 'P8924', message = 'Bot-only cleanup receipt transition was not unique'; end if;

  update public.poker_tables tables
     set bot_only_retention_complete_at = coalesce(tables.bot_only_retention_complete_at, pg_catalog.timezone('utc', pg_catalog.now()))
   where tables.id = batch.bot_only_table_id
     and tables.bot_only_retention_complete_at is null;
  return prune_result || pg_catalog.jsonb_build_object('state', 'cleaned', 'registry_keys', deleted_registry_count, 'table_id', batch.bot_only_table_id);
end;
$$;

reset role;

-- The existing archive-pruner role is reused; no second destructive role is
-- introduced.  Column grants and RLS policies keep the new path narrow.
grant select on public.chips_ledger_archive_batches, public.chips_transaction_idempotency, public.poker_tables to chips_ledger_archive_pruner;
grant update (
  bot_only_table_id,
  bot_only_table_count,
  bot_only_newest_created_at,
  bot_only_registry_keys_sha256,
  bot_only_out_of_scope_keys_sha256,
  bot_only_identity_count,
  bot_only_eligible_count,
  registry_cleaned_at,
  registry_cleaned_key_count,
  registry_cleaned_keys_sha256
) on public.chips_ledger_archive_batches to chips_ledger_archive_pruner;
grant delete on public.chips_transaction_idempotency to chips_ledger_archive_pruner;
grant update (bot_only_retention_complete_at) on public.poker_tables to chips_ledger_archive_pruner;

drop policy if exists chips_archive_pruner_tables_marker_update on public.poker_tables;
create policy chips_archive_pruner_tables_marker_update
  on public.poker_tables
  for update to chips_ledger_archive_pruner
  using (true)
  with check (has_human_participant is not true and bot_only_retention_complete_at is not null);

drop policy if exists chips_archive_pruner_registry_delete on public.chips_transaction_idempotency;
create policy chips_archive_pruner_registry_delete
  on public.chips_transaction_idempotency
  for delete to chips_ledger_archive_pruner
  using (true);

revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

revoke all on function public.chips_authorize_bot_only_archive_batch(bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.chips_authorize_bot_only_archive_batch(bigint, text) to postgres;
revoke all on function public.chips_table_fence_is_active() from public, anon, authenticated, service_role;
grant execute on function public.chips_table_fence_is_active() to postgres, chips_ledger_archive_pruner;
revoke all on function public.chips_set_table_fence_active(boolean) from public, anon, authenticated, service_role;
grant execute on function public.chips_set_table_fence_active(boolean) to postgres;
revoke all on function public.chips_register_bot_only_archive_proof(text, uuid[], bigint[], uuid, text[]) from public, anon, authenticated, service_role;
grant execute on function public.chips_register_bot_only_archive_proof(text, uuid[], bigint[], uuid, text[]) to postgres;
revoke all on function public.chips_prune_and_cleanup_bot_only_archive_batch(text, uuid[], bigint[], text[], uuid, boolean, bigint) from public, anon, authenticated, service_role;
grant execute on function public.chips_prune_and_cleanup_bot_only_archive_batch(text, uuid[], bigint[], text[], uuid, boolean, bigint) to postgres;
revoke all on function public.chips_assert_bot_only_table_lifecycle_gate(uuid, bigint, timestamptz, text[]) from public, anon, authenticated, service_role;
revoke all on function public.chips_archive_text_ids_sha256(text[]) from public, anon, authenticated, service_role;
grant execute on function public.chips_archive_text_ids_sha256(text[]) to postgres, chips_ledger_archive_pruner;
revoke all on function public.chips_parse_table_idempotency_key(text) from public, anon, authenticated, service_role;
grant execute on function public.chips_parse_table_idempotency_key(text) to postgres, chips_ledger_archive_pruner;

commit;
