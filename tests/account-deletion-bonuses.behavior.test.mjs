import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { claimWelcomeBonus } from '../netlify/functions/_shared/welcome-bonus.mjs';
import { claimBonusCampaign } from '../netlify/functions/_shared/bonus-campaigns.mjs';
const env = { ACCOUNT_DELETION_ENABLED:'1', WELCOME_BONUS_START_AT:'2020-01-01' };
let db;
after(async()=>{await db?.close();});
async function fixture(beforeMigration) {
 if(!db){
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now(),is_anonymous boolean default false);
create table chips_transactions(id uuid primary key,user_id uuid,tx_type text,idempotency_key text unique,created_at timestamptz default now(),metadata jsonb,payload_hash text default repeat('a',64));
create table chips_entries(transaction_id uuid,amount bigint);
create table bonus_campaigns(id uuid primary key default gen_random_uuid(),code text unique,title text default 'Test',description text,campaign_type text,amount bigint default 25,status text default 'active',starts_at timestamptz default '2020-01-01',ends_at timestamptz,eligibility_type text default 'all_accounts',eligibility_config jsonb default '{}',claim_policy text,max_total_claims bigint);
create table bonus_claims(id uuid primary key default gen_random_uuid(),campaign_id uuid,user_id uuid references auth.users on delete cascade,transaction_id uuid,idempotency_key text,claim_period_key text,metadata jsonb,claimed_at timestamptz,unique(campaign_id,user_id,claim_period_key));
create table private.bonus_campaign_paid_totals(campaign_id uuid primary key,paid_count bigint not null check(paid_count>=0));
create table private.account_reward_config(id boolean);create table private.account_reward_identities(identity_key text);create table private.account_reward_payouts(identity_key text);
create table chips_transaction_idempotency(idempotency_key text primary key,transaction_id uuid,payload_hash text,tx_type text,user_id uuid,transaction_created_at timestamptz,replay_transaction jsonb,replay_completed_at timestamptz,created_at timestamptz);
create table account_deletion_release(id boolean primary key,enabled boolean);insert into account_deletion_release values(true,true);`);
  if(beforeMigration) await beforeMigration(db);
  await db.exec(await readFile(new URL('../supabase/migrations/20261020190000_account_bonus_uuid_policy.sql',import.meta.url),'utf8'));
 }
 if(beforeMigration) return;
 await db.exec('truncate private.bonus_campaign_paid_totals,bonus_claims,chips_entries,chips_transaction_idempotency,chips_transactions,bonus_campaigns,auth.users cascade');
 const executeSql=async(q,p=[]) => (await db.query(q,p)).rows;
 const deps={env,executeSql,beginSql:fn=>db.transaction(tx=>fn({unsafe:async(q,p=[]) =>(await tx.query(q,p)).rows}))};
 deps.postTransaction=async payload=>{
  if(!payload.tx)return deps.beginSql(tx=>deps.postTransaction({...payload,tx}));
  const tx=payload.tx;const [previous]=await tx.unsafe('select * from chips_transactions where idempotency_key=$1',[payload.idempotencyKey]);
  if(previous)return {transaction:previous,entries:[]};
  assert.equal(payload.entries.reduce((sum,e)=>sum+e.amount,0),0);
  const [row]=await tx.unsafe('insert into chips_transactions(id,user_id,tx_type,idempotency_key,metadata) values($1,$2,$3,$4,$5) returning *',[randomUUID(),payload.userId,payload.txType,payload.idempotencyKey,JSON.stringify(payload.metadata)]);
  for(const e of payload.entries)await tx.unsafe('insert into chips_entries values($1,$2)',[row.id,e.amount]);
  return {transaction:row,entries:payload.entries};
 };
 const user=async()=>{const id=randomUUID();await executeSql("insert into auth.users(id,email,email_confirmed_at) values($1,'same@example.test',now())",[id]);return id;};
 const campaign=async(type,policy,max=null)=>{const code=randomUUID();await executeSql('insert into bonus_campaigns(code,campaign_type,claim_policy,max_total_claims,eligibility_config) values($1,$2,$3,$4,$5)',[code,type,policy,max,JSON.stringify(type==='poker_daily'?{daily_rewards:[25,50,100,200]}:{})]);return code;};
 return {deps,executeSql,user,campaign};
}
test('Welcome is paid once per UUID including repeated same-email registrations, without HMAC or release coupling',async()=>{
 const {deps,user,executeSql}=await fixture();
 for(let i=0;i<5;i++){
  const id=await user();assert.equal((await claimWelcomeBonus(id,deps)).claimed,true);
  assert.equal((await claimWelcomeBonus(id,deps)).reason,'already_claimed');
  await executeSql('delete from auth.users where id=$1',[id]);
 }
 assert.equal((await executeSql("select count(*)::int n from chips_transactions where tx_type='WELCOME_BONUS'"))[0].n,5);
 await executeSql('update account_deletion_release set enabled=false');
 try{assert.equal((await claimWelcomeBonus(await user(),deps)).claimed,true);}finally{await executeSql('update account_deletion_release set enabled=true');}
 assert.equal((await executeSql('select coalesce(sum(amount),0)::int n from chips_entries'))[0].n,0);
 assert.equal((await executeSql("select to_regclass('private.account_reward_config') as name"))[0].name,null);
});
test('Daily UTC and once remain per UUID; a new same-email UUID has independent eligibility',async()=>{
 const {deps,user,campaign,executeSql}=await fixture();const once=await campaign('other','once'),daily=await campaign('poker_daily','daily');
 const first=await user();const day={...deps,now:'2026-10-20T23:59:00Z'};
 for(const code of [once,daily]){assert.equal((await claimBonusCampaign(first,code,day)).claimed,true);assert.equal((await claimBonusCampaign(first,code,day)).reason,'already_claimed');}
 assert.equal((await claimBonusCampaign(first,daily,{...deps,now:'2026-10-21T00:01:00Z'})).claimed,true);
 await executeSql('delete from auth.users where id=$1',[first]);const next=await user();
 for(const code of [once,daily])assert.equal((await claimBonusCampaign(next,code,day)).claimed,true);
});
test('campaign global quota survives Auth/claims cascade, release OFF and replay; ledger remains balanced',async()=>{
 const {deps,user,campaign,executeSql}=await fixture();const code=await campaign('other','once',1);const id=await user();
 await executeSql('update account_deletion_release set enabled=false');
 assert.equal((await claimBonusCampaign(id,code,deps)).claimed,true);assert.equal((await claimBonusCampaign(id,code,deps)).reason,'already_claimed');
 await executeSql('delete from auth.users where id=$1',[id]);assert.equal((await executeSql('select count(*)::int n from bonus_claims'))[0].n,0);
 assert.equal((await claimBonusCampaign(await user(),code,deps)).reason,'max_total_claims_reached');
 assert.equal((await executeSql('select paid_count from private.bonus_campaign_paid_totals'))[0].paid_count,1);
 assert.equal((await executeSql('select sum(amount)::int n from chips_entries'))[0].n,0);
});
test('failed claim or concurrent final-slot retry cannot commit a second ledger payment',async()=>{
 const {deps,user,campaign,executeSql}=await fixture();const code=await campaign('other','once',1);const id=await user();
 const broken={...deps,beginSql:fn=>deps.beginSql(tx=>fn({unsafe:(q,p)=>q.includes('insert into public.bonus_claims')?Promise.resolve([]):tx.unsafe(q,p)}))};
 await assert.rejects(claimBonusCampaign(id,code,broken),/bonus_claim_write_failed/);
 assert.equal((await executeSql('select count(*)::int n from chips_transactions'))[0].n,0);
 assert.equal((await executeSql('select paid_count from private.bonus_campaign_paid_totals'))[0].paid_count,0);
 const second=await user();const results=await Promise.all([claimBonusCampaign(id,code,deps),claimBonusCampaign(second,code,deps)]);
 assert.equal(results.filter(r=>r.claimed).length,1);assert.equal((await executeSql('select count(*)::int n from chips_transactions'))[0].n,1);
});

test('SQL quota also rejects a legacy writer bypassing HTTP preflight, without charging twice on archive replay',async()=>{
 const {deps,user,campaign,executeSql}=await fixture();const code=await campaign('other','once',1);const id=await user();const result=await claimBonusCampaign(id,code,deps);
 const [c]=await executeSql('select id from bonus_campaigns where code=$1',[code]);const other=await user();const forged=randomUUID();
 await assert.rejects(deps.beginSql(async tx=>{
  await tx.unsafe("insert into chips_transactions(id,user_id,tx_type,idempotency_key,metadata) values($1,$2,'PROMO_BONUS','legacy-over-quota',$3)",[forged,other,JSON.stringify({campaign_id:c.id})]);
  await tx.unsafe("insert into bonus_claims(campaign_id,user_id,transaction_id,claim_period_key) values($1,$2,$3,'once')",[c.id,other,forged]);
 }),/Campaign quota unavailable or exhausted/);
 const [receipt]=await executeSql('select * from chips_transactions where id=$1',[result.transactionId]);
 await executeSql("insert into chips_transaction_idempotency values($1,$2,$3,$4,$5,$6,$7,now(), '2020-01-01')",[receipt.idempotency_key,receipt.id,receipt.payload_hash,receipt.tx_type,receipt.user_id,receipt.created_at,JSON.stringify(receipt)]);
 await executeSql('delete from chips_transactions where id=$1',[receipt.id]);
 await executeSql('insert into chips_transactions(id,user_id,tx_type,idempotency_key,metadata,created_at,payload_hash) values($1,$2,$3,$4,$5,$6,$7)',[receipt.id,receipt.user_id,receipt.tx_type,receipt.idempotency_key,JSON.stringify(receipt.metadata),receipt.created_at,receipt.payload_hash]);
 assert.equal((await executeSql('select paid_count from private.bonus_campaign_paid_totals where campaign_id=$1',[c.id]))[0].paid_count,1);
});

test('forward migration preserves lifetime totals and unions surviving claims with hot/archive registry receipts',async()=>{
 await db.close();db=null;
 const campaignId=randomUUID(),retainedId=randomUUID(),txId=randomUUID(),archiveId=randomUUID();
 await fixture(async isolated=>{
  await isolated.query("insert into bonus_campaigns(id,code,campaign_type,claim_policy) values($1,'before-migration','other','once')",[campaignId]);
  await isolated.query("insert into bonus_campaigns(id,code,campaign_type,claim_policy) values($1,'retained-migration','other','once')",[retainedId]);
  await isolated.query('insert into private.bonus_campaign_paid_totals values($1,4)',[retainedId]);
  await isolated.query("insert into chips_transactions(id,tx_type,idempotency_key,metadata) values($1,'PROMO_BONUS','prior-paid',$2)",[txId,JSON.stringify({campaign_id:campaignId})]);
  await isolated.query('insert into bonus_claims(campaign_id,transaction_id) values($1,$2)',[campaignId,txId]);
  await isolated.query("insert into chips_transaction_idempotency(idempotency_key,transaction_id,tx_type,replay_transaction) values('archived-paid',$1,'PROMO_BONUS',$2)",[archiveId,JSON.stringify({metadata:{campaign_id:campaignId}})]);

 });
 assert.equal((await db.query('select paid_count from private.bonus_campaign_paid_totals where campaign_id=$1',[retainedId])).rows[0].paid_count,4,'retained lifetime count never decreases');
 assert.equal((await db.query('select paid_count from private.bonus_campaign_paid_totals where campaign_id=$1',[campaignId])).rows[0].paid_count,2,'claim/hot duplicates count once, archived receipt adds one');
});

test('forward cleanup refuses unexpected recognition data instead of silently deleting it',async()=>{
 await db.close();db=null;
 await assert.rejects(fixture(async isolated=>{
  await isolated.exec('insert into private.account_reward_config values(true)');
 }),/Unused reward identity schema is not empty/);
});
