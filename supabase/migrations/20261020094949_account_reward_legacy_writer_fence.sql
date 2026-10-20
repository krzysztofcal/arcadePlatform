-- LOCAL ONLY. Release OFF preserves existing behavior; no history/key approval seeded.
-- Service-role legacy handlers cannot commit protected rewards without the same
-- transaction's private proof. Does not replace retirement of other old writers.
begin;
create function private.account_reward_commit_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare active boolean; scope text; policy text; family text; campaign uuid; proof private.account_reward_payouts; config private.account_reward_config; maximum bigint; paid bigint;
begin
 if new.tx_type::text not in ('WELCOME_BONUS','PROMO_BONUS') then return new; end if;
 select enabled into active from public.account_deletion_release where id=true for share;
 if active is distinct from true then return new; end if;
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

 if new.tx_type::text='WELCOME_BONUS' then scope:='welcome';
 else
   select c.campaign_id into campaign from public.bonus_claims c where c.transaction_id=new.id and c.user_id=new.user_id;
   if campaign is null then raise exception using errcode='42501',message='Atomic bonus claim required'; end if;
   select campaign_type,claim_policy,max_total_claims into family,policy,maximum from public.bonus_campaigns where id=campaign;
   if family='poker_daily' then scope:='poker_daily';
   elsif policy='once' then scope:='campaign:'||campaign::text;
   end if;
 end if;
 if scope is not null then
 select * into config from private.account_reward_config where id=true for share;
 select * into proof from private.account_reward_payouts where transaction_id=new.id and reward_scope=scope;
 if config.history_ready is distinct from true or proof.transaction_id is null
 or split_part(proof.identity_key,':',1) is distinct from config.active_version then
   raise exception using errcode='42501',message='Protected reward proof required';
 end if;
 if scope='welcome' and (select count(*) from private.account_reward_payouts where identity_key=proof.identity_key and reward_scope=scope)>3 then
   raise exception using errcode='42501',message='Welcome lifetime limit reached';
 end if;
 end if;
 if new.tx_type::text='PROMO_BONUS' then
   update private.bonus_campaign_paid_totals set paid_count=paid_count+1
   where campaign_id=campaign and (maximum is null or paid_count<maximum) returning paid_count into paid;
   if paid is null then raise exception using errcode='42501',message='Campaign quota unavailable or exhausted'; end if;
 end if;
 return new;
end $$;
revoke all on function private.account_reward_commit_guard() from public,anon,authenticated;
-- A new immutable campaign UUID has zero prior payouts. Reused IDs never
-- overwrite retained totals; existing campaigns require real reconciliation.
create function private.account_campaign_initial_total() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into private.bonus_campaign_paid_totals(campaign_id,paid_count) values(new.id,0) on conflict do nothing;
 return new;
end $$;
revoke all on function private.account_campaign_initial_total() from public,anon,authenticated;
create trigger account_campaign_initial_total after insert on public.bonus_campaigns
for each row execute function private.account_campaign_initial_total();
create constraint trigger account_reward_commit_guard after insert on public.chips_transactions
 deferrable initially deferred for each row when (new.tx_type::text in ('WELCOME_BONUS','PROMO_BONUS')) execute function private.account_reward_commit_guard();
commit;
