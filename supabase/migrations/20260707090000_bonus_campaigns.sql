create extension if not exists "pgcrypto";

alter type public.chips_tx_type add value if not exists 'PROMO_BONUS';

create table if not exists public.bonus_campaigns (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  title text not null,
  description text,
  campaign_type text not null,
  amount bigint not null,
  status text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  eligibility_type text not null,
  eligibility_config jsonb not null default '{}'::jsonb,
  max_total_claims bigint,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint bonus_campaigns_code_format check (code ~ '^[a-z0-9][a-z0-9_-]*$'),
  constraint bonus_campaigns_amount_positive check (amount > 0),
  constraint bonus_campaigns_status_valid check (status in ('draft', 'scheduled', 'active', 'paused', 'ended')),
  constraint bonus_campaigns_eligibility_type_valid check (eligibility_type in ('all_accounts', 'created_after', 'created_before', 'allowlist')),
  constraint bonus_campaigns_time_window_valid check (ends_at is null or ends_at > starts_at),
  constraint bonus_campaigns_max_total_claims_positive check (max_total_claims is null or max_total_claims > 0)
);

create table if not exists public.bonus_claims (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.bonus_campaigns (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null references public.chips_transactions (id) on delete restrict,
  idempotency_key text not null,
  claimed_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  constraint bonus_claims_idempotency_key_present check (length(idempotency_key) > 0),
  unique (campaign_id, user_id),
  unique (idempotency_key)
);

create table if not exists public.bonus_campaign_eligible_users (
  campaign_id uuid not null references public.bonus_campaigns (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (campaign_id, user_id)
);

create index if not exists bonus_campaigns_status_window_idx
  on public.bonus_campaigns (status, starts_at, ends_at);

create index if not exists bonus_campaigns_type_idx
  on public.bonus_campaigns (campaign_type);

create index if not exists bonus_claims_user_idx
  on public.bonus_claims (user_id, claimed_at desc);

create index if not exists bonus_claims_campaign_idx
  on public.bonus_claims (campaign_id, claimed_at desc);

create index if not exists bonus_campaign_eligible_users_user_idx
  on public.bonus_campaign_eligible_users (user_id);

create or replace function public.bonus_campaigns_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists bonus_campaigns_touch_updated_at_trg on public.bonus_campaigns;
create trigger bonus_campaigns_touch_updated_at_trg
before update on public.bonus_campaigns
for each row execute function public.bonus_campaigns_touch_updated_at();

alter table public.bonus_campaigns enable row level security;
alter table public.bonus_claims enable row level security;
alter table public.bonus_campaign_eligible_users enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'bonus_campaigns'
      and policyname = 'deny_all_bonus_campaigns'
  ) then
    create policy deny_all_bonus_campaigns on public.bonus_campaigns
      using (false)
      with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'bonus_claims'
      and policyname = 'deny_all_bonus_claims'
  ) then
    create policy deny_all_bonus_claims on public.bonus_claims
      using (false)
      with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'bonus_campaign_eligible_users'
      and policyname = 'deny_all_bonus_campaign_eligible_users'
  ) then
    create policy deny_all_bonus_campaign_eligible_users on public.bonus_campaign_eligible_users
      using (false)
      with check (false);
  end if;
end $$;

insert into public.bonus_campaigns (
  code,
  title,
  description,
  campaign_type,
  amount,
  status,
  starts_at,
  ends_at,
  eligibility_type,
  eligibility_config
)
values (
  'welcome-2026',
  '500 CH Welcome Bonus',
  'Create an account and claim your starter chips.',
  'welcome',
  500,
  'active',
  '2025-06-01T00:00:00Z',
  null,
  'created_after',
  '{"created_at_gte":"2025-06-01T00:00:00Z"}'::jsonb
)
on conflict (code) do update
set title = excluded.title,
    description = excluded.description,
    campaign_type = excluded.campaign_type,
    amount = excluded.amount,
    status = excluded.status,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    eligibility_type = excluded.eligibility_type,
    eligibility_config = excluded.eligibility_config;
