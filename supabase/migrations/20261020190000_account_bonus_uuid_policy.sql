-- #1117: original UUID bonus semantics; cross-account anti-farming deferred to #1131.
-- Forward-only removal of UNUSED applied-schema proposals; never alter old hashes.
begin;
lock table public.bonus_campaigns, public.chips_transactions, public.bonus_claims in share row exclusive mode;
-- Do not silently discard any unexpectedly populated recognition evidence.
do $$ begin
 if exists(select 1 from private.account_reward_config)
 or exists(select 1 from private.account_reward_payouts)
 or exists(select 1 from private.account_reward_identities) then
  raise exception 'Unused reward identity schema is not empty; review before removal';
 end if;
end $$;
drop table private.account_reward_payouts;
drop table private.account_reward_identities;
drop table private.account_reward_config;

-- Union real transaction IDs, not email guesses or surviving claims alone.
-- Never decrease an existing retained total. No balance/ledger/history mutation.
insert into private.bonus_campaign_paid_totals(campaign_id,paid_count)
select c.id,count(distinct p.transaction_id)
from public.bonus_campaigns c left join (
 select campaign_id::text as campaign_id,transaction_id from public.bonus_claims
 union
 select metadata->>'campaign_id',id from public.chips_transactions where tx_type::text='PROMO_BONUS'
 union
 select replay_transaction->'metadata'->>'campaign_id',transaction_id
 from public.chips_transaction_idempotency where tx_type::text='PROMO_BONUS'
) p on p.campaign_id=c.id::text group by c.id
on conflict(campaign_id) do update set paid_count=greatest(private.bonus_campaign_paid_totals.paid_count,excluded.paid_count);

create function private.account_campaign_quota_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare campaign uuid; maximum bigint; paid bigint;
begin
 -- Restoring an already paid, immutable registry receipt is not a new reward.
 -- The registry identity predates this transaction and must match the exact
 -- ledger identity/payload; a freshly created registry row cannot take this path.
 if exists(select 1 from public.chips_transaction_idempotency r
 where r.idempotency_key=new.idempotency_key and r.transaction_id=new.id
 and r.payload_hash=new.payload_hash and r.tx_type=new.tx_type
 and r.user_id is not distinct from new.user_id and r.transaction_created_at=new.created_at
 and r.created_at<transaction_timestamp() and r.replay_completed_at is not null
 and r.replay_transaction->>'id'=new.id::text
 and r.replay_transaction->'metadata'=new.metadata) then return new; end if;


 select c.campaign_id into campaign from public.bonus_claims c where c.transaction_id=new.id and c.user_id=new.user_id;
 if campaign is null then raise exception using errcode='42501',message='Atomic bonus claim required'; end if;
 select max_total_claims into maximum from public.bonus_campaigns where id=campaign;
 update private.bonus_campaign_paid_totals set paid_count=paid_count+1
 where campaign_id=campaign and (maximum is null or paid_count<maximum) returning paid_count into paid;
 if paid is null then raise exception using errcode='42501',message='Campaign quota unavailable or exhausted'; end if;
 return new;
end $$;
revoke all on function private.account_campaign_quota_guard() from public,anon,authenticated;
create constraint trigger account_campaign_quota_guard after insert on public.chips_transactions
 deferrable initially deferred for each row when (new.tx_type::text='PROMO_BONUS') execute function private.account_campaign_quota_guard();

create function private.account_campaign_initial_total() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into private.bonus_campaign_paid_totals(campaign_id,paid_count) values(new.id,0) on conflict do nothing;
 return new;
end $$;
revoke all on function private.account_campaign_initial_total() from public,anon,authenticated;
create trigger account_campaign_initial_total after insert on public.bonus_campaigns
for each row execute function private.account_campaign_initial_total();
commit;
