begin;

-- The TABLE fence must understand both native JSONB objects and the legacy
-- JSONB strings written by the old Netlify interpolation.  Keep the stored
-- value unchanged for compatibility; normalize only inside the fence.
create or replace function public.chips_normalize_table_metadata(p_metadata jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  normalized jsonb := p_metadata;
begin
  if normalized is null then
    raise exception using
      errcode = 'P8902',
      message = 'TABLE metadata must be a JSON object';
  end if;

  if pg_catalog.jsonb_typeof(normalized) = 'string' then
    begin
      normalized := (normalized #>> '{}')::jsonb;
    exception when others then
      raise exception using
        errcode = 'P8902',
        message = 'TABLE metadata legacy JSON string is invalid';
    end;
  end if;

  if pg_catalog.jsonb_typeof(normalized) is distinct from 'object' then
    raise exception using
      errcode = 'P8902',
      message = 'TABLE metadata must be a JSON object';
  end if;

  return normalized;
end;
$$;

alter function public.chips_normalize_table_metadata(jsonb) owner to postgres;
revoke all on function public.chips_normalize_table_metadata(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.chips_normalize_table_metadata(jsonb) to postgres;

create or replace function public.chips_table_transaction_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parsed jsonb;
  normalized_metadata jsonb;
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

  normalized_metadata := public.chips_normalize_table_metadata(new.metadata);
  parsed := public.chips_parse_table_idempotency_key(new.idempotency_key);
  key_table_id := (parsed->>'table_id')::uuid;

  if normalized_metadata ? 'tableId' then
    marker := pg_catalog.lower(pg_catalog.btrim(normalized_metadata->>'tableId'));
    if marker is null
       or marker = ''
       or marker !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or marker::uuid <> key_table_id then
      raise exception using
        errcode = 'P8902',
        message = 'TABLE metadata.tableId does not match the idempotency key';
    end if;
  end if;

  if new.reference is not null then
    reference_table_id := public.chips_parse_table_reference(new.reference);
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
  target_transaction_id uuid;
  transaction_row record;
  normalized_transaction_metadata jsonb;
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
    target_transaction_id := new.id;
  elsif tg_op = 'DELETE' then
    target_transaction_id := old.transaction_id;
  else
    target_transaction_id := new.transaction_id;
  end if;
  select transactions.*
    into transaction_row
    from public.chips_transactions as transactions
   where transactions.id = target_transaction_id;
  if not found or transaction_row.tx_type::text not in ('TABLE_BUY_IN', 'TABLE_CASH_OUT') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  normalized_transaction_metadata := public.chips_normalize_table_metadata(transaction_row.metadata);
  parsed := public.chips_parse_table_idempotency_key(transaction_row.idempotency_key);
  key_table_id := (parsed->>'table_id')::uuid;

  if normalized_transaction_metadata ? 'tableId' then
    transaction_marker := pg_catalog.lower(pg_catalog.btrim(normalized_transaction_metadata->>'tableId'));
    if transaction_marker is null
       or transaction_marker = ''
       or transaction_marker !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or transaction_marker::uuid <> key_table_id then
      raise exception using
        errcode = 'P8904',
        message = 'TABLE transaction metadata does not bind to its idempotency key';
    end if;
  end if;

  if transaction_row.reference is not null then
    reference_table_id := public.chips_parse_table_reference(transaction_row.reference);
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
   where entries.transaction_id = target_transaction_id;

  select count(*)
    into invalid_entry_marker_count
    from public.chips_entries as entries
    cross join lateral (
      select public.chips_normalize_table_metadata(entries.metadata) as metadata
    ) as normalized
   where entries.transaction_id = target_transaction_id
     and (
       normalized.metadata ? 'tableId'
       and (
         normalized.metadata->>'tableId' is null
         or pg_catalog.lower(pg_catalog.btrim(normalized.metadata->>'tableId')) <> key_table_id::text
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
      where entries.transaction_id = target_transaction_id
        and accounts.account_type::text = 'ESCROW'
        and entries.amount > 0
    )
    and exists (
      select 1 from public.chips_entries entries
      join public.chips_accounts accounts on accounts.id = entries.account_id
      where entries.transaction_id = target_transaction_id
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
      where entries.transaction_id = target_transaction_id
        and accounts.account_type::text = 'ESCROW'
        and entries.amount < 0
    )
    and exists (
      select 1 from public.chips_entries entries
      join public.chips_accounts accounts on accounts.id = entries.account_id
      where entries.transaction_id = target_transaction_id
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

commit;
