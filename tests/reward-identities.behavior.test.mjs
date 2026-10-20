import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { rewardIdentityFromUser } from '../netlify/functions/_shared/reward-identities.mjs';
import { claimWelcomeBonus } from '../netlify/functions/_shared/welcome-bonus.mjs';
import { claimBonusCampaign } from '../netlify/functions/_shared/bonus-campaigns.mjs';
const env = { ACCOUNT_DELETION_ENABLED: '1', ACCOUNT_DELETION_REWARD_HMAC_KEY: 'local-test-key-32-bytes-long-only!', ACCOUNT_DELETION_REWARD_HMAC_VERSION: 'v1', WELCOME_BONUS_START_AT: '2020-01-01' };
let db;
after(async () => { if (db) await db.close(); });
async function fixture() {
  if (!db) {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, created_at timestamptz default now(), is_anonymous boolean default false);
create table public.chips_transactions(id uuid primary key, user_id uuid references auth.users on delete cascade, tx_type text, idempotency_key text unique, created_at timestamptz default now(), metadata jsonb);
create table public.bonus_campaigns(id uuid primary key default gen_random_uuid(), code text unique, title text default 'Test', description text, campaign_type text, amount bigint default 25, status text default 'active', starts_at timestamptz default '2020-01-01', ends_at timestamptz, eligibility_type text default 'all_accounts', eligibility_config jsonb default '{}', claim_policy text, max_total_claims bigint);
create table public.bonus_claims(id uuid primary key default gen_random_uuid(), campaign_id uuid, user_id uuid references auth.users on delete cascade, transaction_id uuid, idempotency_key text, claim_period_key text, metadata jsonb, claimed_at timestamptz, unique(campaign_id,user_id,claim_period_key));`);
    await db.exec(await readFile(new URL('../supabase/manual/1117-account-deletion-reward-identities-v2.sql', import.meta.url), 'utf8'));
    await db.exec("alter table public.chips_transactions add column payload_hash text default repeat('a',64); create table public.chips_transaction_idempotency(idempotency_key text primary key,transaction_id uuid,payload_hash text,tx_type text,user_id uuid,transaction_created_at timestamptz,replay_transaction jsonb,replay_completed_at timestamptz,created_at timestamptz)");
    await db.exec('create table public.account_deletion_release(id boolean primary key,enabled boolean); insert into public.account_deletion_release values(true,true)');
    await db.exec(await readFile(new URL('../supabase/migrations/20261020094949_account_reward_legacy_writer_fence.sql',import.meta.url),'utf8'));
  }
  await db.exec('truncate private.account_reward_config, private.account_reward_payouts, private.account_reward_identities, private.bonus_campaign_paid_totals, public.bonus_claims, public.chips_transaction_idempotency, public.chips_transactions, public.bonus_campaigns, auth.users cascade');
  const executeSql = async (q,p = []) => (await db.query(q,p)).rows;
  await executeSql('insert into private.account_reward_config(id,active_version,key_check,history_ready) values(true,$1,$2,true)',
    [env.ACCOUNT_DELETION_REWARD_HMAC_VERSION, createHmac('sha256',env.ACCOUNT_DELETION_REWARD_HMAC_KEY).update('arcade:reward-key-check:v1').digest('hex')]);
  const deps = { env, executeSql, beginSql: (fn) => db.transaction((tx) => fn({ unsafe: async (q,p=[]) => (await tx.query(q,p)).rows })),
    postTransaction: async (payload) => {
      assert.ok(payload.tx, 'ledger shares proof transaction');
      const id = randomUUID();
      const rows = await payload.tx.unsafe('insert into public.chips_transactions(id,user_id,tx_type,idempotency_key,metadata) values($1,$2,$3,$4,$5) returning *', [id,payload.userId,payload.txType,payload.idempotencyKey,JSON.stringify(payload.metadata)]);
      return { transaction: rows[0], entries: payload.entries };
    } };
  const user = async (email = 'same@example.test', confirmed = true) => {
    const id = randomUUID();
    await executeSql('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)', [id,email,confirmed ? '2025-01-01' : null]);
    return id;
  };
  const campaign = async (type, policy, max = null) => {
    const code = randomUUID();
    await executeSql('insert into public.bonus_campaigns(code,campaign_type,claim_policy,max_total_claims,eligibility_config) values($1,$2,$3,$4,$5)', [code,type,policy,max,JSON.stringify(type === 'poker_daily' ? { daily_rewards: [25,50,100,200] } : {})]);
    return code;
  };
  return { deps, user, campaign, executeSql };
}

test('common versioned HMAC normalizes email and fails closed without verified Auth email or key', async () => {
  const user = { email: ' SAME@Example.Test ', email_confirmed_at: '2025-01-01', is_anonymous: false };
  const identity = rewardIdentityFromUser(user,env);
  assert.match(identity,/^v1:[a-f0-9]{64}$/);
  assert.equal(identity,rewardIdentityFromUser({...user,email:'same@example.test'},env));
  assert.throws(() => rewardIdentityFromUser({...user,email_confirmed_at:null},env), /verified_email_required/);
  assert.throws(() => rewardIdentityFromUser(user,{}), /reward_identity_unavailable/);
  const { deps, user: createUser } = await fixture();
  await assert.rejects(claimWelcomeBonus(await createUser('new@example.test',false),deps), /verified_email_required/);
});

test('Welcome allows three committed payouts across UUIDs with no cooldown, concurrent fourth denied; proof failure rolls ledger back', async () => {
  const { deps, user, executeSql } = await fixture();
  const ids = await Promise.all(Array.from({length:4},() => user()));
  const out = await Promise.all(ids.map(id => claimWelcomeBonus(id,deps)));
  assert.equal(out.filter(x=>x.claimed).length,3);
  assert.equal(out.filter(x=>x.reason==='welcome_limit_reached').length,1);
  const proofs=await executeSql("select period_key,transaction_id from private.account_reward_payouts where reward_scope='welcome'");
  assert.ok(proofs.every(row=>row.period_key===row.transaction_id),'new private proofs use transaction reference, not old UUID');
  await executeSql("update private.account_reward_payouts set period_key='welcome-bonus:'||$1 where transaction_id=$2",[ids[0],proofs[0].transaction_id]);
  await executeSql('delete from auth.users');
  assert.equal((await claimWelcomeBonus(await user(),deps)).reason,'welcome_limit_reached');
  const fresh = await user('different@example.test');
  const broken = { ...deps, beginSql: (fn) => deps.beginSql(tx => fn({unsafe:(q,p) => q.includes('insert into private.account_reward_payouts') ? Promise.resolve([]) : tx.unsafe(q,p)})) };
  await assert.rejects(claimWelcomeBonus(fresh,broken),/reward_proof_write_failed/);
  assert.equal((await executeSql('select count(*)::int as n from public.chips_transactions where user_id=$1',[fresh]))[0].n,0);
  assert.equal((await claimWelcomeBonus(fresh,deps)).claimed,true);
});

test('Daily family and once receipts survive re-registration; new UUID next-day streak starts fresh and unrelated daily remains unchanged', async () => {
  const { deps, user, campaign, executeSql } = await fixture();
  const daily = await campaign('poker_daily','daily');
  const once = await campaign('promo','once');
  const unrelated = await campaign('other','daily');
  const first = await user();
  assert.equal((await claimBonusCampaign(first,daily,deps)).streakDay,1);
  assert.equal((await claimBonusCampaign(first,once,deps)).claimed,true);
  await executeSql('delete from auth.users where id=$1',[first]);
  const second = await user();
  assert.equal((await claimBonusCampaign(second,daily,deps)).alreadyClaimed,true);
  assert.equal((await claimBonusCampaign(second,once,deps)).alreadyClaimed,true);
  const renamed = randomUUID();
  await executeSql('update public.bonus_campaigns set code=$1 where code=$2',[renamed,once]);
  assert.equal((await claimBonusCampaign(second,renamed,deps)).alreadyClaimed,true);
  assert.equal((await claimBonusCampaign(second,await campaign('poker_daily','daily'),deps)).alreadyClaimed,true);
  assert.equal((await claimBonusCampaign(second,unrelated,deps)).claimed,true);
  const tomorrow = new Date(Date.now()+86400000).toISOString();
  const next = await claimBonusCampaign(second,daily,{...deps, now:tomorrow});
  assert.equal(next.claimed,true); assert.equal(next.streakDay,1);
});

test('campaign quota survives Auth cascade and receipt failure atomically rolls back ledger, proof and quota', async () => {
  const { deps, user, campaign, executeSql } = await fixture();
  const limited = await campaign('promo','once',1);
  const first = await user();
  assert.equal((await claimBonusCampaign(first,limited,deps)).claimed,true);
  await executeSql('delete from auth.users where id=$1',[first]);
  assert.equal((await claimBonusCampaign(await user('other@example.test'),limited,deps)).reason,'max_total_claims_reached');
  const failing = await campaign('promo','once');
  const next = await user('fresh@example.test');
  const broken = {...deps, beginSql: (fn) => deps.beginSql(tx=>fn({unsafe:(q,p)=> q.includes('insert into public.bonus_claims') ? Promise.resolve([]) : tx.unsafe(q,p)}))};
  await assert.rejects(claimBonusCampaign(next,failing,broken),/bonus_claim_write_failed/);
  assert.equal((await executeSql('select count(*)::int as n from public.chips_transactions where user_id=$1',[next]))[0].n,0);
  assert.equal((await claimBonusCampaign(next,failing,deps)).claimed,true);
});


test('missing/unapproved history or changed key/version fails closed before any protected payout', async () => {
  const { deps, user, campaign, executeSql } = await fixture();
  const id = await user();
  const once = await campaign('promo','once');
  const daily = await campaign('poker_daily','daily');
  for (const changed of [
    { ACCOUNT_DELETION_REWARD_HMAC_VERSION:'v2' },
    { ACCOUNT_DELETION_REWARD_HMAC_KEY:'different-local-test-secret-32-bytes!' },
  ]) {
    const mismatched = { ...deps, env:{...env,...changed} };
    await assert.rejects(claimWelcomeBonus(id,mismatched),/reward_identity_unavailable/);
    await assert.rejects(claimBonusCampaign(id,once,mismatched),/reward_identity_unavailable/);
    await assert.rejects(claimBonusCampaign(id,daily,mismatched),/reward_identity_unavailable/);
  }
  await executeSql('update private.account_reward_config set history_ready=false');
  await assert.rejects(claimWelcomeBonus(id,deps),/reward_identity_unavailable/);
  await executeSql('delete from private.account_reward_config');
  await assert.rejects(claimBonusCampaign(id,once,deps),/reward_identity_unavailable/);
  assert.equal((await executeSql('select count(*)::int n from public.chips_transactions'))[0].n,0);
  assert.equal((await executeSql('select count(*)::int n from private.account_reward_identities'))[0].n,0);
});

test('release SQL fence rejects legacy protected ledger writers without atomic proof, canonical payout still commits',async()=>{
  const {deps,user,executeSql,campaign}=await fixture();
  const id=await user('legacy-writer@example.test');
  await assert.rejects(executeSql("insert into public.chips_transactions(id,user_id,tx_type,idempotency_key,metadata) values($1,$2,'WELCOME_BONUS','legacy-probe','{}')",[randomUUID(),id]),/reward proof required/);
  assert.equal((await executeSql('select count(*)::int n from public.chips_transactions'))[0].n,0);
  assert.equal((await claimWelcomeBonus(id,deps)).claimed,true);
  const code=await campaign('promo','once');
  assert.equal((await claimBonusCampaign(id,code,deps)).claimed,true);
  await executeSql('update public.account_deletion_release set enabled=false');
  await executeSql("insert into public.chips_transactions(id,user_id,tx_type,idempotency_key,metadata) values($1,$2,'WELCOME_BONUS','legacy-release-off','{}')",[randomUUID(),id]);
  await executeSql('update public.account_deletion_release set enabled=true');
});

test('legacy unrelated campaign writer advances durable SQL quota once; Auth cascade cannot reset its global cap',async()=>{
  const {deps,user,campaign,executeSql}=await fixture();
  const id=await user('legacy-recurring@example.test');const code=await campaign('other','daily',1);
  const [{id:campaignId}]=await executeSql('select id from public.bonus_campaigns where code=$1',[code]);
  const txId=randomUUID();
  await deps.beginSql(async tx=>{
    await tx.unsafe("insert into public.chips_transactions(id,user_id,tx_type,idempotency_key,metadata) values($1,$2,'PROMO_BONUS','legacy-recurring','{}')",[txId,id]);
    await tx.unsafe("insert into public.bonus_claims(campaign_id,user_id,transaction_id,claim_period_key) values($1,$2,$3,'fixture-period')",[campaignId,id,txId]);
  });
  assert.equal((await executeSql('select paid_count from private.bonus_campaign_paid_totals where campaign_id=$1',[campaignId]))[0].paid_count,1);
  await executeSql('delete from auth.users where id=$1',[id]);
  assert.equal((await claimBonusCampaign(await user('different-new@example.test'),code,deps)).reason,'max_total_claims_reached');
});

test('runtime protection ON with database release OFF rejects payout before SQL quota guard can be bypassed',async()=>{
  const {deps,user,campaign,executeSql}=await fixture();const id=await user();const code=await campaign('other','daily',1);
  await executeSql('update public.account_deletion_release set enabled=false');
  try {
    await assert.rejects(claimBonusCampaign(id,code,deps),/reward_identity_unavailable/);
    await assert.rejects(claimWelcomeBonus(id,deps),/reward_identity_unavailable/);
    assert.equal((await executeSql('select count(*)::int n from public.chips_transactions'))[0].n,0);
  } finally {await executeSql('update public.account_deletion_release set enabled=true');}
});

test('exact historical registry replay restores ledger without a new payout proof or quota increment',async()=>{
  const {user,executeSql}=await fixture();const id=await user('archive-test@example.test');const txId=randomUUID();
  await executeSql("insert into public.chips_transaction_idempotency(idempotency_key,transaction_id,payload_hash,tx_type,user_id,transaction_created_at,replay_transaction,replay_completed_at,created_at) values('historical-replay',$1,repeat('a',64),'WELCOME_BONUS',$2,'2020-01-01',$3,'2020-01-01','2020-01-01')",[txId,id,JSON.stringify({metadata:{source:'historical'},id:txId})]);
  await executeSql("insert into public.chips_transactions(id,user_id,tx_type,idempotency_key,metadata,created_at) values($1,$2,'WELCOME_BONUS','historical-replay','{\"source\":\"historical\"}','2020-01-01')",[txId,id]);
  assert.equal((await executeSql('select count(*)::int n from private.account_reward_payouts'))[0].n,0);
});
