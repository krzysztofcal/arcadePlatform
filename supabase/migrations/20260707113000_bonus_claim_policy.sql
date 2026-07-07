alter table public.bonus_campaigns
  add column if not exists claim_policy text not null default 'once';

alter table public.bonus_claims
  add column if not exists claim_period_key text not null default 'once';

alter table public.bonus_campaigns
  drop constraint if exists bonus_campaigns_claim_policy_valid;

alter table public.bonus_campaigns
  add constraint bonus_campaigns_claim_policy_valid
  check (claim_policy in ('once', 'daily', 'weekly', 'monthly'));

alter table public.bonus_claims
  drop constraint if exists bonus_claims_claim_period_key_present;

alter table public.bonus_claims
  add constraint bonus_claims_claim_period_key_present
  check (length(claim_period_key) > 0);

alter table public.bonus_claims
  drop constraint if exists bonus_claims_campaign_id_user_id_key;

alter table public.bonus_claims
  add constraint bonus_claims_campaign_user_period_key
  unique (campaign_id, user_id, claim_period_key);

create index if not exists bonus_claims_campaign_user_period_idx
  on public.bonus_claims (campaign_id, user_id, claim_period_key);
