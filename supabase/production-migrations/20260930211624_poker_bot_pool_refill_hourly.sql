begin;

-- Forward-only Production equivalent for #1018 §29. This installs a dark control
-- and SECURITY INVOKER function only; it never enables pg_cron, schedules work or MINTs.
-- Apply only through the reviewed Production migration route with the exact identity below.

do $identity$
declare
  actual_system_identifier text;
begin
  select control_identity.system_identifier::text
    into actual_system_identifier
    from pg_catalog.pg_control_system() as control_identity;
  if pg_catalog.current_setting('chips.production_project_ref', true) is distinct from 'otbqfijerkieoxwpxjnm'
     or actual_system_identifier is distinct from '7575202818581710058' then
    raise exception using errcode = 'P1029', message = 'Production hourly poker refill migration identity preflight failed';
  end if;
end;
$identity$;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('poker-bot-pool-refill-hourly:otbqfijerkieoxwpxjnm', 0)
);

do $prerequisites$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20260929201500')
     or pg_catalog.to_regclass('public.poker_bot_tier_policy') is null
     or pg_catalog.to_regclass('public.chips_transaction_idempotency') is null
     or pg_catalog.to_regclass('public.chips_transactions_poker_pool_bucket_uidx') is null
     or pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode = 'P1029', message = 'Production hourly poker refill prerequisites are missing';
  end if;
  if pg_catalog.to_regclass('public.poker_bot_refill_control') is not null
     or pg_catalog.to_regprocedure('public.poker_bot_pool_refill_hourly()') is not null then
    raise exception using errcode = 'P1029', message = 'Production hourly poker refill objects already exist';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20260930211624') then
    raise exception using errcode = 'P1029', message = 'Production migration version 20260930211624 is already recorded';
  end if;
end;
$prerequisites$;

create table public.poker_bot_refill_control (
  id smallint primary key default 1,
  enabled boolean not null default false,
  expected_system_identifier text not null,
  constraint poker_bot_refill_control_singleton_chk check (id = 1)
);

insert into public.poker_bot_refill_control (id, enabled, expected_system_identifier)
values (1, false, '7575202818581710058');

alter table public.poker_bot_refill_control enable row level security;
revoke all on table public.poker_bot_refill_control from public, anon, authenticated, service_role;

create or replace function public.poker_bot_pool_refill_hourly()
returns jsonb
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
  v_control_enabled boolean;
  v_expected_system_identifier text;
  v_actual_system_identifier text;
  v_hour timestamp without time zone;
  v_bucket text;
  v_run_lock_acquired boolean;
  v_candidate record;
  v_policy public.poker_bot_tier_policy%rowtype;
  v_account public.chips_accounts%rowtype;
  v_genesis public.chips_accounts%rowtype;
  v_pool public.chips_accounts%rowtype;
  v_pool_key text;
  v_threshold bigint;
  v_amount bigint;
  v_idempotency_key text;
  v_metadata jsonb;
  v_payload text;
  v_payload_hash text;
  v_transaction_id uuid;
  v_existing_transaction_id uuid;
  v_updated_accounts bigint;
  v_inserted_entries bigint;
  v_sqlstate text;
  v_error text;
  v_outcome jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  select control.enabled, control.expected_system_identifier
    into v_control_enabled, v_expected_system_identifier
    from public.poker_bot_refill_control as control
   where control.id = 1
   for share;
  if not found then
    raise exception using errcode = 'P1029', message = 'poker_bot_refill_control_singleton_missing';
  end if;

  select control_identity.system_identifier::text
    into v_actual_system_identifier
    from pg_catalog.pg_control_system() as control_identity;
  if v_actual_system_identifier is distinct from v_expected_system_identifier then
    raise exception using errcode = 'P1029', message = 'poker_bot_refill_database_identity_mismatch';
  end if;

  v_hour := pg_catalog.date_trunc('hour', pg_catalog.clock_timestamp() at time zone 'UTC');
  v_bucket := pg_catalog.to_char(v_hour, 'YYYY-MM-DD"T"HH24:00:00.000"Z"');
  if v_control_enabled is not true then
    return pg_catalog.jsonb_build_object('status', 'disabled', 'bucket', v_bucket, 'pools', v_results);
  end if;

  select pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('poker-bot-pool-refill-hourly', 0)
  ) into v_run_lock_acquired;
  if v_run_lock_acquired is not true then
    return pg_catalog.jsonb_build_object('status', 'busy', 'bucket', v_bucket, 'pools', v_results);
  end if;

  for v_candidate in
    select tier.buy_in, pool.pool_class
      from (values
        (100::bigint), (500::bigint), (1000::bigint), (5000::bigint),
        (10000::bigint), (50000::bigint), (100000::bigint), (500000::bigint),
        (1000000::bigint), (5000000::bigint), (10000000::bigint)
      ) as tier(buy_in)
      join public.poker_bot_tier_policy as policy on policy.buy_in = tier.buy_in
      cross join (values ('NORMAL'::text), ('SLOW'::text)) as pool(pool_class)
     where policy.enabled is true
     order by tier.buy_in, pool.pool_class
  loop
    v_pool_key := case
      when v_candidate.pool_class = 'NORMAL' and v_candidate.buy_in = 500 then 'POKER_BOT_BANKROLL'
      when v_candidate.pool_class = 'NORMAL' then 'POKER_BOT_BANKROLL_' || v_candidate.buy_in::text
      else 'POKER_BOT_SLOW_BANKROLL_' || v_candidate.buy_in::text
    end;
    v_outcome := null;

    begin
      select policy.*
        into v_policy
        from public.poker_bot_tier_policy as policy
       where policy.buy_in = v_candidate.buy_in
       for update;
      if not found then
        raise exception using errcode = 'P1029', message = 'poker_bot_refill_policy_missing';
      end if;
      if v_policy.enabled is not true then
        v_outcome := pg_catalog.jsonb_build_object(
          'buyIn', v_candidate.buy_in, 'poolClass', v_candidate.pool_class,
          'systemKey', v_pool_key, 'status', 'disabled'
        );
      else
        v_threshold := case v_candidate.pool_class
          when 'NORMAL' then v_policy.normal_refill_threshold_ch
          else v_policy.slow_refill_threshold_ch
        end;
        v_amount := case v_candidate.pool_class
          when 'NORMAL' then v_policy.normal_refill_amount_ch
          else v_policy.slow_refill_amount_ch
        end;
        if v_policy.revision <= 0 or v_threshold <= 0 or v_amount <= 0 then
          raise exception using errcode = 'P1029', message = 'poker_bot_refill_policy_invalid';
        end if;

        v_genesis := null;
        v_pool := null;
        for v_account in
          select account.*
            from public.chips_accounts as account
           where account.account_type = 'SYSTEM'::public.chips_account_type
             and account.system_key in ('GENESIS', v_pool_key)
           order by account.id
           for update
        loop
          if v_account.system_key = 'GENESIS' then
            v_genesis := v_account;
          elsif v_account.system_key = v_pool_key then
            v_pool := v_account;
          end if;
        end loop;
        if v_genesis.id is null then
          raise exception using errcode = 'P1029', message = 'poker_bot_refill_genesis_missing';
        end if;
        if v_genesis.status::text <> 'active' then
          raise exception using errcode = 'P1029', message = 'poker_bot_refill_genesis_inactive';
        end if;
        if v_pool.id is null then
          raise exception using errcode = 'P1029', message = 'poker_bot_refill_pool_missing';
        end if;
        if v_pool.status::text <> 'active' then
          raise exception using errcode = 'P1029', message = 'poker_bot_refill_pool_inactive';
        end if;
        if v_pool.balance < 0 then
          raise exception using errcode = 'P1029', message = 'poker_bot_refill_pool_balance_invalid';
        end if;

        if pg_catalog.date_trunc('hour', pg_catalog.clock_timestamp() at time zone 'UTC') is distinct from v_hour then
          v_outcome := pg_catalog.jsonb_build_object(
            'buyIn', v_candidate.buy_in, 'poolClass', v_candidate.pool_class,
            'systemKey', v_pool_key, 'status', 'stale_bucket'
          );
        else
          select prior_tx.id
            into v_existing_transaction_id
            from public.chips_transactions as prior_tx
           where prior_tx.metadata ->> 'purpose' = 'poker_pool_refill'
             and prior_tx.metadata ->> 'bankrollSystemKey' = v_pool_key
             and prior_tx.metadata ->> 'bucket' = v_bucket
           limit 1;
          if found then
            v_outcome := pg_catalog.jsonb_build_object(
              'buyIn', v_candidate.buy_in, 'poolClass', v_candidate.pool_class,
              'systemKey', v_pool_key, 'status', 'replay',
              'transactionId', v_existing_transaction_id, 'bucket', v_bucket
            );
          elsif v_pool.balance >= v_threshold then
            v_outcome := pg_catalog.jsonb_build_object(
              'buyIn', v_candidate.buy_in, 'poolClass', v_candidate.pool_class,
              'systemKey', v_pool_key, 'status', 'no_op',
              'balance', v_pool.balance, 'threshold', v_threshold
            );
          else
            v_idempotency_key := pg_catalog.format(
              'poker-pool-refill:%s:%s:%s', v_pool_key, v_policy.revision, v_bucket
            );
            v_metadata := pg_catalog.jsonb_build_object(
              'purpose', 'poker_pool_refill',
              'bankrollSystemKey', v_pool_key,
              'buyIn', v_candidate.buy_in,
              'poolClass', v_candidate.pool_class,
              'policyRevision', v_policy.revision,
              'bucket', v_bucket
            );
            v_payload := pg_catalog.concat_ws(
              '|', 'poker-pool-refill-v1', v_idempotency_key,
              v_metadata::text, v_genesis.id::text, (-v_amount)::text,
              v_pool.id::text, v_amount::text
            );
            v_payload_hash := pg_catalog.encode(
              extensions.digest(pg_catalog.convert_to(v_payload, 'UTF8'), 'sha256'),
              'hex'
            );

            insert into public.chips_transactions (
              reference, description, metadata, idempotency_key, payload_hash,
              tx_type, user_id, created_by
            ) values (
              v_idempotency_key,
              'Hourly poker bot pool refill',
              v_metadata,
              v_idempotency_key,
              v_payload_hash,
              'MINT'::public.chips_tx_type,
              null,
              null
            ) returning id into v_transaction_id;

            update public.chips_accounts as account
               set balance = account.balance + case
                     when account.id = v_genesis.id then -v_amount
                     when account.id = v_pool.id then v_amount
                     else 0
                   end,
                   updated_at = pg_catalog.timezone('utc', pg_catalog.now())
             where account.id in (v_genesis.id, v_pool.id);
            get diagnostics v_updated_accounts = row_count;
            if v_updated_accounts <> 2 then
              raise exception using errcode = 'P1029', message = 'poker_bot_refill_account_update_incomplete';
            end if;

            insert into public.chips_entries (transaction_id, account_id, amount, metadata)
            values
              (v_transaction_id, v_genesis.id, -v_amount, '{}'::jsonb),
              (v_transaction_id, v_pool.id, v_amount, '{}'::jsonb);
            get diagnostics v_inserted_entries = row_count;
            if v_inserted_entries <> 2 then
              raise exception using errcode = 'P1029', message = 'poker_bot_refill_entries_incomplete';
            end if;
            if not exists (
              select 1
                from public.chips_transaction_idempotency as registry
               where registry.idempotency_key = v_idempotency_key
                 and registry.transaction_id = v_transaction_id
                 and registry.payload_hash = v_payload_hash
            ) then
              raise exception using errcode = 'P1029', message = 'poker_bot_refill_idempotency_registry_missing';
            end if;

            v_outcome := pg_catalog.jsonb_build_object(
              'buyIn', v_candidate.buy_in, 'poolClass', v_candidate.pool_class,
              'systemKey', v_pool_key, 'status', 'refilled',
              'amount', v_amount, 'threshold', v_threshold,
              'balanceBefore', v_pool.balance, 'policyRevision', v_policy.revision,
              'bucket', v_bucket, 'transactionId', v_transaction_id
            );
          end if;
        end if;
      end if;
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_error = message_text;
      raise warning 'poker_bot_pool_refill_hourly failed pool % (%): %', v_pool_key, v_sqlstate, v_error;
      v_outcome := pg_catalog.jsonb_build_object(
        'buyIn', v_candidate.buy_in, 'poolClass', v_candidate.pool_class,
        'systemKey', v_pool_key, 'status', 'failed',
        'sqlState', v_sqlstate, 'error', v_error
      );
    end;

    v_results := v_results || pg_catalog.jsonb_build_array(v_outcome);
  end loop;

  return pg_catalog.jsonb_build_object('status', 'processed', 'bucket', v_bucket, 'pools', v_results);
end;
$function$;

revoke all on function public.poker_bot_pool_refill_hourly() from public, anon, authenticated, service_role;

insert into supabase_migrations.schema_migrations (version)
values ('20260930211624');

commit;
