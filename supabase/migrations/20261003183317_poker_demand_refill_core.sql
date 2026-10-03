begin;
-- §32 forward-only core: existing control/identity retained; Cron temporarily shares allowance.
-- No control activation, Cron change, or MINT during migration.
create or replace function public.poker_bot_pool_refill_demand(
  p_buy_in bigint, p_pool_class text, p_funding_demand_id text, p_required_debit_ch bigint
) returns jsonb
language plpgsql security invoker
set search_path = ''
set lock_timeout = '5s'
set statement_timeout = '10s'
as $function$
declare
  v_control public.poker_bot_refill_control%rowtype;
  v_policy public.poker_bot_tier_policy%rowtype;
  v_account public.chips_accounts%rowtype;
  v_genesis public.chips_accounts%rowtype;
  v_pool public.chips_accounts%rowtype;
  v_actual_system_identifier text;
  v_hour timestamp without time zone;
  v_bucket text;
  v_pool_key text;
  v_threshold bigint;
  v_amount bigint;
  v_cap bigint;
  v_used bigint;
  v_idempotency_key text;
  v_metadata jsonb;
  v_payload text;
  v_payload_hash text;
  v_transaction_id uuid;
  v_updated_accounts bigint;
  v_inserted_entries bigint;
begin
  if p_pool_class is null or p_pool_class not in ('NORMAL', 'SLOW')
     or p_buy_in is null or p_buy_in not in (100,500,1000,5000,10000,50000,100000,500000,1000000,5000000,10000000)
     or p_required_debit_ch is null or p_required_debit_ch <= 0 or p_required_debit_ch > 9007199254740991
     or p_funding_demand_id is null or pg_catalog.length(p_funding_demand_id) = 0 then
    return pg_catalog.jsonb_build_object('status', 'invalid_demand');
  end if;
  select * into v_control from public.poker_bot_refill_control where id = 1 for share;
  if not found then raise exception 'poker_bot_refill_control_singleton_missing'; end if;
  select system_identifier::text into v_actual_system_identifier from pg_catalog.pg_control_system();
  if v_actual_system_identifier is distinct from v_control.expected_system_identifier then
    raise exception using errcode='P1029', message='poker_bot_refill_database_identity_mismatch';
  end if;
  if v_control.enabled is not true then return pg_catalog.jsonb_build_object('status', 'disabled'); end if;
  select * into v_policy from public.poker_bot_tier_policy where buy_in = p_buy_in for share;
  if not found or v_policy.enabled is not true then return pg_catalog.jsonb_build_object('status', 'tier_disabled'); end if;
  v_pool_key := case when p_pool_class = 'NORMAL' and p_buy_in = 500 then 'POKER_BOT_BANKROLL'
    when p_pool_class = 'NORMAL' then 'POKER_BOT_BANKROLL_' || p_buy_in::text
    else 'POKER_BOT_SLOW_BANKROLL_' || p_buy_in::text end;
  v_threshold := case p_pool_class when 'NORMAL' then v_policy.normal_refill_threshold_ch else v_policy.slow_refill_threshold_ch end;
  v_amount := case p_pool_class when 'NORMAL' then v_policy.normal_refill_amount_ch else v_policy.slow_refill_amount_ch end;
  v_cap := case p_pool_class when 'NORMAL' then v_policy.normal_hourly_refill_cap_ch else v_policy.slow_hourly_refill_cap_ch end;
  if v_policy.revision <= 0 or v_threshold <= 0 or v_amount <= 0 or v_cap <= 0 then raise exception 'poker_bot_refill_policy_invalid'; end if;
  v_hour := pg_catalog.date_trunc('hour', pg_catalog.clock_timestamp() at time zone 'UTC');
  v_bucket := pg_catalog.to_char(v_hour, 'YYYY-MM-DD"T"HH24:00:00.000"Z"');
  -- Consistent ledger account lock order, shared by demand and transition wrapper.
  for v_account in select * from public.chips_accounts
    where account_type = 'SYSTEM'::public.chips_account_type and system_key in ('GENESIS', v_pool_key)
    order by case when system_key = 'GENESIS' then 0 else 1 end, id for update
  loop
    if v_account.system_key = 'GENESIS' then v_genesis := v_account; else v_pool := v_account; end if;
  end loop;
  if v_genesis.id is null or v_pool.id is null or v_genesis.status::text <> 'active' or v_pool.status::text <> 'active' then
    raise exception using errcode='P1029', message='poker_bot_refill_pool_unprovisioned';
  end if;
  if v_pool.balance < 0 then raise exception 'poker_bot_refill_pool_balance_invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('poker-refill:' || v_pool_key || ':' || v_bucket, 0));
  if pg_catalog.date_trunc('hour', pg_catalog.clock_timestamp() at time zone 'UTC') is distinct from v_hour then
    return pg_catalog.jsonb_build_object('status', 'stale_bucket');
  end if;
  v_idempotency_key := pg_catalog.format('demand-refill:%s:%s:%s:%s', v_pool_key, v_policy.revision, v_bucket, p_funding_demand_id);
  -- Also guard across policy edits: the same funding identity cannot mint twice in a bucket.
  if exists (select 1 from public.chips_transactions
    where metadata ->> 'purpose' = 'poker_pool_refill' and metadata ->> 'bankrollSystemKey' = v_pool_key
      and metadata ->> 'bucket' = v_bucket and metadata ->> 'fundingDemandId' = p_funding_demand_id)
    or exists (select 1 from public.chips_transaction_idempotency where idempotency_key = p_funding_demand_id) then
    return pg_catalog.jsonb_build_object('status', 'replay', 'poolKey', v_pool_key);
  end if;
  if v_pool.balance >= v_threshold and v_pool.balance >= p_required_debit_ch then
    return pg_catalog.jsonb_build_object('status', 'no_op', 'poolKey', v_pool_key);
  end if;
  select coalesce(sum(e.amount), 0)::bigint into v_used
    from public.chips_transactions t
    join public.chips_entries e on e.transaction_id = t.id
    join public.chips_accounts a on a.id = e.account_id
    where t.tx_type = 'MINT'::public.chips_tx_type and t.metadata ->> 'purpose' = 'poker_pool_refill'
      and t.metadata ->> 'bankrollSystemKey' = v_pool_key and t.metadata ->> 'bucket' = v_bucket
      and a.account_type = 'SYSTEM'::public.chips_account_type and a.system_key = v_pool_key
      and a.id = v_pool.id and e.amount > 0;
  if v_cap is not null then v_amount := least(v_amount, greatest(0, v_cap - v_used)); end if;
  if v_amount <= 0 then return pg_catalog.jsonb_build_object('status', 'cap_exhausted', 'poolKey', v_pool_key); end if;
  if v_pool.balance + v_amount < p_required_debit_ch then
    return pg_catalog.jsonb_build_object('status', 'insufficient_allowance', 'poolKey', v_pool_key);
  end if;
  v_metadata := pg_catalog.jsonb_build_object('purpose', 'poker_pool_refill', 'bankrollSystemKey', v_pool_key,
    'buyIn', p_buy_in, 'poolClass', p_pool_class, 'policyRevision', v_policy.revision, 'bucket', v_bucket,
    'trigger', case when p_funding_demand_id like 'transition-hourly:%' then 'transition_hourly' else 'demand' end, 'amount', v_amount, 'fundingDemandId', p_funding_demand_id);
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
              'Demand poker bot pool refill',
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


  if pg_catalog.date_trunc('hour', pg_catalog.clock_timestamp() at time zone 'UTC') is distinct from v_hour then
    raise exception 'poker_bot_refill_bucket_expired';
  end if;
  return pg_catalog.jsonb_build_object('status', 'refilled', 'poolKey', v_pool_key, 'amount', v_amount,
    'bucket', v_bucket, 'transactionId', v_transaction_id);
end;
$function$;
revoke all on function public.poker_bot_pool_refill_demand(bigint,text,text,bigint) from public, anon, authenticated, service_role;

-- Transition only. Remove this wrapper and exact Cron job after Stage smoke and separate GO.
create or replace function public.poker_bot_pool_refill_hourly() returns jsonb
language plpgsql security invoker set search_path = '' set lock_timeout = '5s'
as $function$
declare
  v_candidate record;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_bucket text;
  v_control public.poker_bot_refill_control%rowtype;
begin
  select * into v_control from public.poker_bot_refill_control where id = 1 for share;
  if not found then raise exception 'poker_bot_refill_control_singleton_missing'; end if;
  if v_control.expected_system_identifier is distinct from (select system_identifier::text from pg_catalog.pg_control_system()) then
    raise exception using errcode='P1029', message='poker_bot_refill_database_identity_mismatch';
  end if;
  if v_control.enabled is not true then return pg_catalog.jsonb_build_object('status','disabled','pools',v_results); end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('poker-bot-pool-refill-hourly', 0)) then
    return pg_catalog.jsonb_build_object('status','busy','pools',v_results);
  end if;
  v_bucket := pg_catalog.to_char(pg_catalog.date_trunc('hour', pg_catalog.clock_timestamp() at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:00:00.000"Z"');
  for v_candidate in select buy_in, pool_class from public.poker_bot_tier_policy
    cross join (values ('NORMAL'::text),('SLOW'::text)) as classes(pool_class) where enabled and buy_in in (100,500,1000,5000,10000,50000,100000,500000,1000000,5000000,10000000) order by buy_in, pool_class
  loop
    begin
      v_result := public.poker_bot_pool_refill_demand(v_candidate.buy_in, v_candidate.pool_class, 'transition-hourly:' || v_bucket, 1);
      v_result := v_result || pg_catalog.jsonb_build_object('buyIn',v_candidate.buy_in,'poolClass',v_candidate.pool_class,
        'systemKey',case when v_candidate.pool_class = 'NORMAL' and v_candidate.buy_in = 500 then 'POKER_BOT_BANKROLL'
          when v_candidate.pool_class = 'NORMAL' then 'POKER_BOT_BANKROLL_' || v_candidate.buy_in::text
          else 'POKER_BOT_SLOW_BANKROLL_' || v_candidate.buy_in::text end);
    exception when others then
      v_result := pg_catalog.jsonb_build_object('status','failed','buyIn',v_candidate.buy_in,'poolClass',v_candidate.pool_class,'error',sqlerrm,'sqlState',sqlstate, 'systemKey',case when v_candidate.pool_class = 'NORMAL' and v_candidate.buy_in = 500 then 'POKER_BOT_BANKROLL' when v_candidate.pool_class = 'NORMAL' then 'POKER_BOT_BANKROLL_' || v_candidate.buy_in::text else 'POKER_BOT_SLOW_BANKROLL_' || v_candidate.buy_in::text end);
    end;
    v_results := v_results || pg_catalog.jsonb_build_array(v_result);
  end loop;
  return pg_catalog.jsonb_build_object('status','processed','bucket',v_bucket,'pools',v_results);
end;
$function$;
revoke all on function public.poker_bot_pool_refill_hourly() from public, anon, authenticated, service_role;

commit;
