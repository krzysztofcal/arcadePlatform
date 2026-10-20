import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const USER='11111111-1111-4111-8111-111111111111', OTHER='22222222-2222-4222-8222-222222222222';
const REQUEST='33333333-3333-4333-8333-333333333333', TABLE='44444444-4444-4444-8444-444444444444';
process.env.ACCOUNT_DELETION_ENABLED='1';
process.env.XP_TEST_MODE='1';
process.env.XP_KEY_NS='kcswh:stage:xp:v3';
process.env.XP_REDIS_ENV='stage';
process.env.XP_REDIS_VERSION='3';
let db;
after(async()=> { delete process.env.ACCOUNT_DELETION_ENABLED; await db?.close(); });
async function fixture(balance=75) {
  if (!db) {
    db=new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table bonus_campaigns(id uuid primary key,created_by uuid);
      create table bonus_campaign_eligible_users(campaign_id uuid,user_id uuid,created_by uuid);
      create table bonus_claims(campaign_id uuid,user_id uuid);
      create table user_profiles(user_id uuid,avatar_key text);
      create table favorites(user_id uuid);
      create table profile_avatar_uploads(id uuid primary key,user_id uuid,source_path text);
      create schema auth; create table auth.users(id uuid primary key,created_at timestamptz default now(),email text default 'same@example.test'); create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create table chips_accounts(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id),
        account_type text not null, system_key text, status text not null default 'active', balance bigint not null default 0,
        next_entry_seq bigint not null default 1, unique(user_id,account_type), unique(system_key),
        constraint chips_accounts_user_or_system_key check((account_type='USER' and user_id is not null and system_key is null) or (account_type<>'USER' and user_id is null and system_key is not null)),
        constraint chips_accounts_user_system_exclusive check((account_type='USER' and user_id is not null and system_key is null) or (account_type<>'USER' and user_id is null and system_key is not null)));
      create table chips_transactions(id uuid primary key default gen_random_uuid(), reference text, description text, metadata jsonb, idempotency_key text unique,
        payload_hash text, tx_type text, user_id uuid, created_by uuid, created_at timestamptz default now());
      create table chips_entries(id bigint generated always as identity, transaction_id uuid references chips_transactions(id),
        account_id uuid references chips_accounts(id), amount bigint, metadata jsonb, entry_seq bigint default 1);
      create table chips_transaction_idempotency(idempotency_key text primary key, transaction_id uuid, payload_hash text, tx_type text, user_id uuid,
        transaction_created_at timestamptz, replay_transaction jsonb, replay_entries jsonb, replay_completed_at timestamptz, created_at timestamptz default now());
      create function test_registry() returns trigger language plpgsql as $$begin
        insert into chips_transaction_idempotency(idempotency_key,transaction_id,payload_hash,tx_type,user_id,transaction_created_at)
        values(new.idempotency_key,new.id,new.payload_hash,new.tx_type,new.user_id,new.created_at); return new; end$$;
      create trigger test_registry after insert on chips_transactions for each row execute function test_registry();
      create function raise_insufficient_funds() returns boolean language plpgsql as $$begin raise exception 'insufficient'; end$$;
      create table poker_tables(id uuid primary key,status text,lifecycle_kind text,managed_profile_key text,last_activity_at timestamptz,updated_at timestamptz);
      create table poker_seats(table_id uuid,user_id uuid,seat_no int,status text,is_bot boolean,stack bigint);
      create table poker_actions(id uuid default gen_random_uuid(),table_id uuid,version bigint,user_id uuid,action_type text,amount bigint,hand_id text,request_id text,phase_from text,phase_to text,meta jsonb);
      create table poker_requests(table_id uuid,user_id uuid,request_id text,kind text,result_json jsonb,created_at timestamptz default now(),unique(table_id,user_id,request_id,kind));
      create table poker_state(table_id uuid primary key,state jsonb,version bigint default 1,updated_at timestamptz default now());`);
    await db.exec(await readFile(new URL('../supabase/manual/1117-account-deletion-requests-v2.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/manual/1117-account-deletion-wallet-retirement-v2.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/manual/1117-account-deletion-avatar-tracking-v2.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261019170000_account_avatar_manifest_guards.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261020082604_account_avatar_mvp_closure.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261020094224_account_avatar_reconciliation.sql',import.meta.url),'utf8'));
    await db.exec(`alter table bonus_campaigns add column max_total_claims bigint;
      alter table bonus_claims add column transaction_id uuid;
      create table private.bonus_campaign_paid_totals(campaign_id uuid primary key,paid_count bigint);
      create table private.account_reward_config(id boolean);
      create table private.account_reward_identities(identity_key text);
      create table private.account_reward_payouts(identity_key text);`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261020190000_account_bonus_uuid_policy.sql',import.meta.url),'utf8'));
    await db.exec('alter table public.profile_avatar_uploads enable trigger account_avatar_manifest_guard_v3');
  }
  await db.exec('truncate chips_entries,chips_transactions,chips_transaction_idempotency,chips_accounts,account_deletion_requests,poker_seats,poker_state,auth.users cascade');
  await db.query('insert into auth.users values($1),($2)',[USER,OTHER]);
  await db.query("insert into chips_accounts(user_id,account_type,balance) values($1,'USER',$2)",[USER,balance]);
  await db.exec("insert into chips_accounts(account_type,system_key,balance) values('SYSTEM','GENESIS',0)");
  await db.query(`insert into account_deletion_requests(request_id,old_user_id,status,phase,accepted_at,lease_until,lease_generation,progress)
    values($1,$2,'PROCESSING','burn',now(),now()+interval '120 seconds',1,'{"poker":{"done":true}}')`,[REQUEST,USER]);
  const adapt=client=>{
    const tx=async(strings,...values)=> (await client.query(strings.reduce((q,s,i)=>q+(i?'$'+i:'')+s,''),values)).rows;
    tx.unsafe=async(sql,params=[])=> (await client.query(sql,params)).rows; return tx;
  };
  const begin=fn=>db.transaction(client=>fn(adapt(client)));
  return {begin};
}

const {createAccountDeletionRuntime}=await import('../ws-server/poker/runtime/account-deletion.mjs');
const {requestDeletion,advanceDeletion,deleteAuthUser}=await import('../shared/account-deletion.mjs');
const {executePokerLeave,finalizeDeferredLeavesAfterSettlement}=await import('../shared/poker-domain/leave.mjs');
const {materializeShowdownAndPayout}=await import('../netlify/functions/_shared/poker-materialize-showdown.mjs');
const {awardPotsAtShowdown}=await import('../netlify/functions/_shared/poker-payout.mjs');
const {computeShowdown}=await import('../netlify/functions/_shared/poker-showdown.mjs');
const {cleanupDeletionAvatars}=await import('../shared/account-deletion-storage.mjs');
const {__createMemoryStoreForTests,guardedUserMutation,blockRedisIdentity,cleanupRedisIdentity}=await import('../netlify/functions/_shared/store-upstash.mjs');
const {createXpLedgerKeys}=await import('../netlify/functions/_shared/xp-ledger.mjs');
const {createHash}=await import('node:crypto');

test('local request → all-in showdown/side-pot → real cashout+BURN → indexed cleanup → official Auth delete, restart/retry',async()=>{
  const {begin}=await fixture(75);
  await db.exec('delete from account_deletion_requests');
  await db.query('insert into poker_tables(id,status) values($1,\'OPEN\')',[TABLE]);
  await db.query("insert into chips_accounts(account_type,system_key,balance) values('ESCROW',$1,300)",['POKER_TABLE:'+TABLE]);
  const seats=[{userId:USER,seatNo:1},{userId:OTHER,seatNo:2}];
  const community=[{r:2,s:'C'},{r:7,s:'D'},{r:9,s:'H'},{r:11,s:'S'},{r:3,s:'C'}];
  const state={tableId:TABLE,phase:'RIVER',handId:'local-hand',handSeed:'local-fixture-seed',community,communityDealt:5,pot:300,
    seats,handSeats:seats,stacks:{[USER]:0,[OTHER]:0},dealerSeatNo:1,turnUserId:null,currentBet:0,
    contributionsByUserId:{[USER]:100,[OTHER]:200},allInByUserId:{[USER]:true,[OTHER]:true},
    foldedByUserId:{[USER]:false,[OTHER]:false},leftTableByUserId:{[USER]:false,[OTHER]:false},
    actedThisRoundByUserId:{[USER]:true,[OTHER]:true},toCallByUserId:{[USER]:0,[OTHER]:0},betThisRoundByUserId:{[USER]:0,[OTHER]:0}};
  await db.query('insert into poker_state(table_id,state) values($1,$2)',[TABLE,state]);
  await db.query("insert into poker_seats values($1,$2,1,'ACTIVE',false,0),($1,$3,2,'ACTIVE',false,0)",[TABLE,USER,OTHER]);
  const namespace=process.env.XP_KEY_NS,keys=createXpLedgerKeys({namespace}),store=__createMemoryStoreForTests();
  const epochKey=namespace+':lifecycle:epoch';await store.set(epochKey,'fixture-epoch');
  for(const id of [USER,OTHER])await guardedUserMutation({store,userId:id,key:keys.profile(id),value:'private fixture',operation:'set',beginSql:begin});
  const env={ACCOUNT_DELETION_ENABLED:'1',SUPABASE_URL:'https://local-fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',
    UPSTASH_REDIS_REST_URL:'https://local-redis.invalid',ACCOUNT_DELETION_AVATAR_TRACKING_MARKER:'fixture'};
  await db.query('update account_deletion_release set redis_cutover=$1',[{namespace,epoch:'fixture-epoch',endpoint_hash:createHash('sha256').update(env.UPSTASH_REDIS_REST_URL).digest('hex'),writers_drained:true,legacy_xp_reset_verified:true,manifest_hash:'f'.repeat(64)}]);
  await db.exec("insert into private.avatar_tracking_cutover(marker,cutover_at,legacy_inventory_verified,upload_bucket,public_bucket) values('fixture',now()-interval '1 day',true,'profile-avatar-uploads','profile-avatars')");
  const request=await begin(tx=>requestDeletion(tx,USER));
  let leaveCalls=0,authCalls=0,disconnected=0,authPresent=true;
  const fetchImpl=async(url,options={})=>{
    assert.ok(url.endsWith('/admin/users/'+USER));
    assert.equal(await store.get(keys.profile(USER)),null,'Auth must follow proven cleanup');
    assert.equal((await db.query("select balance::int n from chips_accounts where account_type='USER'")).rows[0].n,0);
    if(options.method==='DELETE'){
      authCalls++;await db.query('delete from auth.users where id=$1',[USER]);authPresent=false;
      throw new Error('lost successful provider response');
    }
    return authPresent?new Response(JSON.stringify({id:USER}),{status:200}):new Response('',{status:404});
  };
  const dependencies={beginSql:begin,env,klog:()=>{},redisIsMemory:false,
    blockIdentity:id=>blockRedisIdentity(id,store),disconnectUser:async()=>{disconnected++;},
    leaveFromTable:async({tableId,userId,requestId})=>{
      leaveCalls++;
      return executePokerLeave({beginSql:begin,tableId,userId,requestId,klog:()=>{},runPostLeaveBotAutoplay:false});
    },
    cleanupAvatars:context=>cleanupDeletionAvatars({...context,fetch:async()=>{throw new Error('unexpected Storage request in no-avatar fixture');}}),
    cleanupRedis:options=>cleanupRedisIdentity({...options,store}),
    deleteAuth:options=>deleteAuthUser({...options,fetchImpl})};
  let runtime=createAccountDeletionRuntime(dependencies);
  const advance=async()=>{
    // Advance the local retry clock only, never a provider/runtime timer.
    await db.query('update account_deletion_requests set next_attempt_at=now()-interval \'1 second\' where request_id=$1',[request.request_id]);
    return advanceDeletion({beginSql:begin,requestId:request.request_id,steps:runtime.steps});
  };
  assert.equal((await advance()).advanced,true); // preparing: Redis fence + disconnect
  assert.equal(disconnected,1);
  assert.equal((await advance()).waiting,true); // Leave cannot fold/cash out an all-in
  let pending=(await db.query('select state from poker_state')).rows[0].state;
  assert.equal(pending.foldedByUserId[USER],false);
  assert.equal(pending.pendingDetachByUserId[USER],true);
  assert.equal(pending.phase,'SHOWDOWN');
  assert.equal((await db.query('select count(*)::int n from chips_transactions')).rows[0].n,0);
  const settled=materializeShowdownAndPayout({state:pending,seatUserIdsInOrder:[USER,OTHER],holeCardsByUserId:{[USER]:[{r:14,s:'S'},{r:14,s:'H'}],[OTHER]:[{r:13,s:'S'},{r:13,s:'H'}]},computeShowdown,awardPotsAtShowdown}).nextState;
  assert.equal(settled.stacks[USER],200,'eligible main pot retained');
  assert.equal(settled.stacks[OTHER],100,'side pot retained by deeper all-in');
  delete settled.holeCardsByUserId;delete settled.deck;
  await db.query('update poker_state set state=$1,version=version+1',[settled]);
  const finalized=await finalizeDeferredLeavesAfterSettlement({beginSql:begin,tableId:TABLE});
  assert.equal(finalized.ok,true);
  assert.equal((await db.query("select balance::int n from chips_accounts where account_type='USER'")).rows[0].n,275);
  runtime=createAccountDeletionRuntime(dependencies); // VPS restart: durable request, same real adapters
  for(let i=0;i<7;i++){
    const outcome=await advance();
    const row=(await db.query('select * from account_deletion_requests')).rows[0];
    assert.notEqual(row.status,'ERROR',JSON.stringify(outcome));
    if(row.status==='COMPLETED')break;
  }
  const row=(await db.query('select * from account_deletion_requests')).rows[0];
  assert.equal(row.status,'COMPLETED',JSON.stringify({phase:row.phase,error:row.error_code}));
  const txs=(await db.query('select tx_type from chips_transactions order by created_at')).rows;
  assert.deepEqual(txs.map(t=>t.tx_type),['TABLE_CASH_OUT','BURN']);
  assert.equal((await db.query("select amount::int n from chips_entries e join chips_transactions t on t.id=e.transaction_id where t.tx_type='BURN' and amount<0")).rows[0].n,-275);
  assert.equal(authCalls,1);assert.equal(leaveCalls,1);
  assert.equal(await store.get(keys.profile(USER)),null);assert.equal(await store.get(keys.profile(OTHER)),'private fixture');
  assert.equal((await db.query('select count(*)::int n from auth.users where id=$1',[OTHER])).rows[0].n,1);
  assert.equal((await advance()).advanced,false);
  assert.equal((await db.query('select count(*)::int n from chips_transactions')).rows[0].n,2);
  // Auth recreation is modelled locally, not a hosted signup/OAuth proof.
  const fresh='55555555-5555-4555-8555-555555555555';
  await db.query('insert into auth.users(id) values($1)',[fresh]);
  assert.equal(await store.get(keys.profile(fresh)),null);
  assert.equal((await db.query('select count(*)::int n from chips_accounts where user_id=$1',[fresh])).rows[0].n,0);
  await assert.rejects(guardedUserMutation({store,userId:USER,key:keys.profile(USER),value:'resurrect',operation:'set',beginSql:begin}));
  const {claimWelcomeBonus}=await import('../netlify/functions/_shared/welcome-bonus.mjs');
  const {postTransaction}=await import('../netlify/functions/_shared/chips-ledger.mjs');
  const bonusDeps={env:{ACCOUNT_DELETION_ENABLED:'1',WELCOME_BONUS_START_AT:'2020-01-01'},
    executeSql:(query,params)=>begin(tx=>tx.unsafe(query,params)),
    postTransaction:payload=>begin(tx=>postTransaction({...payload,tx}))};
  assert.equal((await claimWelcomeBonus(fresh,bonusDeps)).claimed,true);
  assert.equal((await claimWelcomeBonus(fresh,bonusDeps)).reason,'already_claimed');
  assert.equal((await db.query('select balance::int n from chips_accounts where user_id=$1',[fresh])).rows[0].n,500);
  assert.equal((await db.query("select count(*)::int n from chips_transactions where tx_type='BURN'")).rows[0].n,1);
  assert.equal((await db.query('select sum(amount)::int n from chips_entries')).rows[0].n,0);
  await guardedUserMutation({store,userId:fresh,key:keys.profile(fresh),value:'new identity',operation:'set',beginSql:begin});
  assert.equal(await store.get(keys.profile(OTHER)),'private fixture');
});
