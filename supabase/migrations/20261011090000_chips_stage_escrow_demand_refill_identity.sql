begin;

-- Stage-only forward correction. No accounting DML, activation or cleanup.
-- Preserve the effective function and every guard outside textual identity;
-- fail if its reviewed pre-lock/post-lock shape has changed.
grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

do $patch$
declare
  definition text;
  registry_needle text := $registry$      or exists (
        select 1
          from pg_catalog.unnest(table_ids) as wanted(table_id)
         where pg_catalog.strpos(pg_catalog.lower(registry.idempotency_key), wanted.table_id::text) > 0
      );$registry$;
  target_needle text := $target$        on transactions.id = candidates.id
     where exists ($target$;
  proof text := $proof$  -- A table UUID inside fundingDemandId is funding context, not escrow
  -- lineage. Accept only the exact live evidence emitted by the demand producer.
  -- Recompute after account locks too; never cache proof across validation.
  select coalesce(pg_catalog.array_agg(distinct transactions.id), '{}'::uuid[]),
         coalesce(pg_catalog.array_agg(distinct transactions.idempotency_key), '{}'::text[])
    into verified_refill_ids, verified_refill_keys
    from pg_catalog.unnest(table_ids) as wanted(table_id)
    join public.chips_transactions transactions
      on pg_catalog.lower(coalesce(transactions.idempotency_key, ''))
         like '%' || wanted.table_id::text || '%'
    join public.chips_transaction_idempotency registry
      on registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
     and registry.payload_hash = transactions.payload_hash
     and registry.tx_type = transactions.tx_type
     and registry.transaction_created_at = transactions.created_at
    join public.chips_entries debit on debit.transaction_id = transactions.id
    join public.chips_accounts genesis on genesis.id = debit.account_id
    join public.chips_entries credit on credit.transaction_id = transactions.id
    join public.chips_accounts pool on pool.id = credit.account_id
   where transactions.tx_type::text = 'MINT'
     and transactions.user_id is null and transactions.created_by is null
     and transactions.description = 'Demand poker bot pool refill'
     and transactions.reference = transactions.idempotency_key
     and registry.table_id is null and registry.archive_batch_id is null
     and registry.user_id is null
     and registry.key_format is null and registry.key_format_version is null
     and registry.replay_transaction is null and registry.replay_entries is null
     and registry.replay_completed_at is null
     and transactions.metadata ->> 'purpose' = 'poker_pool_refill'
     and transactions.metadata ->> 'poolClass' in ('NORMAL', 'SLOW')
     and transactions.metadata ->> 'buyIn' in
       ('100','500','1000','5000','10000','50000','100000','500000','1000000','5000000','10000000')
     and pg_catalog.jsonb_typeof(transactions.metadata -> 'buyIn') = 'number'
     and pg_catalog.jsonb_typeof(transactions.metadata -> 'policyRevision') = 'number'
     and transactions.metadata ->> 'policyRevision' ~ '^[1-9][0-9]*$'
     and pg_catalog.jsonb_typeof(transactions.metadata -> 'amount') = 'number'
     and pg_catalog.jsonb_typeof(transactions.metadata -> 'fundingDemandId') = 'string'
     and pg_catalog.length(transactions.metadata ->> 'fundingDemandId') > 0
     and transactions.metadata ->> 'bucket' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:00:00[.]000Z$'
     and transactions.metadata ->> 'trigger' = case
       when transactions.metadata ->> 'fundingDemandId' like 'transition-hourly:%'
       then 'transition_hourly' else 'demand' end
     and transactions.metadata - array['purpose','bankrollSystemKey','buyIn','poolClass',
       'policyRevision','bucket','trigger','amount','fundingDemandId']::text[] = '{}'::jsonb
     and transactions.metadata ->> 'bankrollSystemKey' = case
       when transactions.metadata ->> 'poolClass' = 'SLOW'
       then 'POKER_BOT_SLOW_BANKROLL_' || (transactions.metadata ->> 'buyIn')
       when transactions.metadata ->> 'buyIn' = '500' then 'POKER_BOT_BANKROLL'
       else 'POKER_BOT_BANKROLL_' || (transactions.metadata ->> 'buyIn') end
     and transactions.idempotency_key = pg_catalog.format('demand-refill:%s:%s:%s:%s',
       transactions.metadata ->> 'bankrollSystemKey', transactions.metadata ->> 'policyRevision',
       transactions.metadata ->> 'bucket', transactions.metadata ->> 'fundingDemandId')
     and genesis.account_type::text = 'SYSTEM' and genesis.system_key = 'GENESIS'
     and pool.account_type::text = 'SYSTEM'
     and pool.system_key = transactions.metadata ->> 'bankrollSystemKey'
     and genesis.user_id is null and pool.user_id is null
     and debit.amount < 0 and credit.amount > 0 and debit.amount = -credit.amount
     and credit.amount::text = transactions.metadata ->> 'amount'
     and debit.metadata = '{}'::jsonb and credit.metadata = '{}'::jsonb
     and not (genesis.id = any(p_account_ids)) and not (pool.id = any(p_account_ids))
     and (select count(*) from public.chips_entries entries
           where entries.transaction_id = transactions.id) = 2
     and transactions.payload_hash = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
       pg_catalog.concat_ws('|', 'poker-pool-refill-v1', transactions.idempotency_key,
         transactions.metadata::text, genesis.id::text, debit.amount::text,
         pool.id::text, credit.amount::text), 'UTF8'), 'sha256'), 'hex');
$proof$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_retire_stage_escrow_accounts(bigint,uuid[],text,text,text,boolean,text)'::pg_catalog.regprocedure
  ) into definition;
  if definition is null
     or (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition,
       registry_needle, ''))) / pg_catalog.length(registry_needle) <> 2
     or (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition,
       target_needle, ''))) / pg_catalog.length(target_needle) <> 2
     or (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition,
       '  select count(*) into registry_count', ''))) / pg_catalog.length('  select count(*) into registry_count') <> 2
     or pg_catalog.strpos(definition, '  registry_count bigint;') = 0
     or pg_catalog.strpos(definition, 'verified_refill_ids') > 0 then
    raise exception 'Stage escrow demand-refill correction requires the reviewed two dependency guards';
  end if;
  definition := pg_catalog.replace(definition, '  registry_count bigint;',
    '  verified_refill_ids uuid[];' || chr(10) || '  verified_refill_keys text[];' || chr(10) || '  registry_count bigint;');
  definition := pg_catalog.replace(definition, '  select count(*) into registry_count',
    proof || '  select count(*) into registry_count');
  definition := pg_catalog.replace(definition, registry_needle,
    pg_catalog.replace(pg_catalog.replace(registry_needle, '      or exists (',
      '      or ((registry.idempotency_key = any(verified_refill_keys)) is not true and exists ('),
      '      );', '      ));'));
  definition := pg_catalog.replace(definition, target_needle,
    pg_catalog.replace(target_needle, '     where exists (',
      '     where not (transactions.id = any(verified_refill_ids)) and exists ('));
  execute definition;
end;
$patch$;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;
commit;
