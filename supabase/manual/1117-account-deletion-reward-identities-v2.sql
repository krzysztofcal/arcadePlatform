-- LOCAL PROPOSAL ONLY. Do not apply until history coverage, privacy/legal basis,
-- retention, rights handling and HMAC key continuity/rotation are approved.
-- HMAC version changes without an approved bridge lose recognition; not a reset policy.
-- Existing deleted history cannot be reconstructed. Activation needs a separately
-- reviewed historical verified-identity backfill and old-writer drain.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
-- Deliberately no seed approval. The operator supplies this singleton only after
-- reviewed historical coverage and key continuity approval. key_check is hex
-- HMAC-SHA256(secret, UTF8 "arcade:reward-key-check:v1"), never the secret/email.
-- A key/version mismatch denies payouts; this table is not a rotation bridge.
create table private.account_reward_config (
  id boolean primary key default true check (id),
  active_version text not null check (active_version ~ '^[a-zA-Z0-9_-]{1,32}$'),
  key_check text not null check (key_check ~ '^[0-9a-f]{64}$'),
  history_ready boolean not null default false
);
alter table private.account_reward_config enable row level security;
revoke all on private.account_reward_config from public, anon, authenticated;
grant select on private.account_reward_config to service_role;
create table private.account_reward_identities (
  identity_key text primary key
);
create table private.account_reward_payouts (
  identity_key text not null references private.account_reward_identities(identity_key),
  reward_scope text not null,
  period_key text not null,
  transaction_id uuid not null unique,
  paid_at timestamptz not null default clock_timestamp(),
  primary key (identity_key, reward_scope, period_key)
);
-- No Auth, campaign, or ledger FK: deletion/cascade must not reset paid evidence.
create table private.bonus_campaign_paid_totals (
  campaign_id uuid primary key,
  paid_count bigint not null check (paid_count >= 0)
);
-- Apply only while old bonus writers are drained. This seeds surviving history;
-- historical deleted claims require a separate coverage decision before activation.
insert into private.bonus_campaign_paid_totals (campaign_id, paid_count)
select campaign_id, count(*) from public.bonus_claims group by campaign_id;
alter table private.account_reward_identities enable row level security;
alter table private.account_reward_payouts enable row level security;
alter table private.bonus_campaign_paid_totals enable row level security;
revoke all on private.account_reward_identities, private.account_reward_payouts, private.bonus_campaign_paid_totals from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update on private.account_reward_identities, private.account_reward_payouts, private.bonus_campaign_paid_totals to service_role;
-- No public RPC, raw email, user UUID or client policy. Retention pruning of Daily
-- proofs must retain today's UTC day; server-side current clock prevents backdating.
commit;
