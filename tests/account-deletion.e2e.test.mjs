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
      create table poker_tables(id uuid primary key,created_by uuid,status text,lifecycle_kind text,managed_profile_key text,last_activity_at timestamptz,updated_at timestamptz);
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
  await db.exec('truncate chips_entries,chips_transactions,chips_transaction_idempotency,chips_accounts,account_deletion_requests,poker_seats,poker_state,poker_requests,auth.users cascade');
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
    assert.equal((await db.query("select balance::int n from chips_accounts where account_type='USER' and coalesce(user_id,retired_user_id)=$1",[USER])).rows[0].n,0);
    if(options.method==='DELETE'){
      authCalls++;await db.query('delete from auth.users where id=$1',[USER]);authPresent=false;
      throw new Error('lost successful provider response');
    }
    return authPresent?new Response(JSON.stringify({id:USER}),{status:200}):new Response('',{status:404});
  };
  const dependencies={beginSql:begin,env,klog:()=>{},redisIsMemory:false,
    coordinatePokerPrivacy:async(context,tableId,run)=>run(),
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
  assert.equal((await db.query("select balance::int n from chips_accounts where account_type='USER' and coalesce(user_id,retired_user_id)=$1",[USER])).rows[0].n,275);
  // The remaining player leaves through the canonical executor, reaching the
  // terminal boundary before private historical projection is removed.
  await executePokerLeave({beginSql:begin,tableId:TABLE,userId:OTHER,requestId:'peer-final-leave',klog:()=>{},runPostLeaveBotAutoplay:false});
  const originalSettlement=(await db.query('select state from poker_state where table_id=$1',[TABLE])).rows[0].state.handSettlement;
  runtime=createAccountDeletionRuntime(dependencies); // VPS restart: durable request, same real adapters
  for(let i=0;i<12;i++){
    const outcome=await advance();
    const row=(await db.query('select * from account_deletion_requests')).rows[0];
    assert.notEqual(row.status,'ERROR',JSON.stringify(outcome));
    if(row.status==='COMPLETED')break;
  }
  const row=(await db.query('select * from account_deletion_requests')).rows[0];
  assert.equal(row.status,'COMPLETED',JSON.stringify({phase:row.phase,error:row.error_code}));
  assert.deepEqual(row.progress.pokerPrivacyFinancialReceipts[TABLE],originalSettlement,'retain exact original financial proof');
  const txs=(await db.query('select tx_type from chips_transactions order by created_at')).rows;
  assert.deepEqual(txs.map(t=>t.tx_type),['TABLE_CASH_OUT','TABLE_CASH_OUT','BURN']);
  assert.equal((await db.query("select amount::int n from chips_entries e join chips_transactions t on t.id=e.transaction_id where t.tx_type='BURN' and amount<0")).rows[0].n,-275);
  assert.equal(authCalls,1);assert.equal(leaveCalls,1);
  assert.equal(await store.get(keys.profile(USER)),null);assert.equal(await store.get(keys.profile(OTHER)),'private fixture');
  assert.equal((await db.query('select count(*)::int n from auth.users where id=$1',[OTHER])).rows[0].n,1);
  assert.equal((await advance()).advanced,false);
  assert.equal((await db.query('select count(*)::int n from chips_transactions')).rows[0].n,3);
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

test('closed inactive zero-stack history is not a Poker obligation; uncertain/live value still blocks BURN',async()=>{
  const {begin}=await fixture(75);
  await db.query("insert into poker_tables(id,status) values($1,'CLOSED') on conflict(id) do update set status='CLOSED'",[TABLE]);
  await db.query("insert into chips_accounts(account_type,system_key,balance) values('ESCROW',$1,0)",['POKER_TABLE:'+TABLE]);
  await db.query("insert into poker_seats values($1,$2,1,'INACTIVE',false,0)",[TABLE,USER]);
  await db.query('insert into poker_state(table_id,state) values($1,$2)',[TABLE,{tableId:TABLE,phase:'HAND_DONE',seats:[{userId:USER,seatNo:1}],stacks:{}}]);
  const {assertDeletionLease}=await import('../shared/account-deletion.mjs');
  const runtime=createAccountDeletionRuntime({beginSql:begin,klog:()=>{},redisIsMemory:false,
    leaveFromTable:async()=>{throw new Error('must not cash out unproven stack');}});
  const context=phase=>({userId:USER,requestId:REQUEST,generation:1,progress:{},
    assertLease:tx=>assertDeletionLease(tx,{requestId:REQUEST,generation:1,phase})});
  const phase=async value=>db.query('update account_deletion_requests set phase=$1,progress=$2',[value,value==='burn'?{poker:{done:true}}:{}]);
  await phase('poker');
  assert.deepEqual(await runtime.steps.poker(context('poker')),{done:true});
  // Do not generalize the exception to ACTIVE/value-bearing/open/unsettled cases.
  for(const bad of ['active','positive_seat','open','unsettled','positive_escrow','stack_key','missing_stacks']){
    await db.query("update poker_seats set status=$1,stack=$2",[bad==='active'?'ACTIVE':'INACTIVE',bad==='positive_seat'?1:0]);
    await db.query('update poker_tables set status=$1',[bad==='open'?'OPEN':'CLOSED']);
    await db.query('update poker_state set state=$1',[{tableId:TABLE,phase:(bad==='unsettled'||bad==='open')?'RIVER':'HAND_DONE',seats:[{userId:USER,seatNo:1}],handSeats:[{userId:USER,seatNo:1}],...(bad==='missing_stacks'?{}:{stacks:bad==='stack_key'?{[USER]:0}:{}})}]);
    await db.query("update chips_accounts set balance=$1 where account_type='ESCROW'",[bad==='positive_escrow'?1:0]);
    await phase('poker');await assert.rejects(runtime.steps.poker(context('poker')),/must not cash out/);
    await phase('burn');await assert.rejects(runtime.steps.burn(context('burn')),error=>error.code==='financial_mismatch');
    assert.equal((await db.query('select count(*)::int n from chips_transactions')).rows[0].n,0);
  }
  await db.exec("update poker_seats set status='INACTIVE',stack=0;update poker_tables set status='CLOSED';update chips_accounts set balance=0 where account_type='ESCROW'");
  await db.query('update poker_state set state=$1',[{tableId:TABLE,phase:'HAND_DONE',seats:[{userId:USER,seatNo:1}],stacks:{}}]);
  await phase('burn');assert.equal((await runtime.steps.burn(context('burn'))).done,true);
  assert.equal((await runtime.steps.burn(context('burn'))).done,true);
  assert.equal((await db.query("select count(*)::int n from chips_transactions where tx_type='BURN'")).rows[0].n,1);
  assert.equal((await db.query('select sum(amount)::int n from chips_entries')).rows[0].n,0);
  assert.equal((await db.query("select balance::int n from chips_accounts where retired_user_id=$1",[USER])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from poker_seats where user_id=$1',[USER])).rows[0].n,1,'wallet retirement does not remove historical seats');
});

const {cleanupDeletionPoker,projectDeletionPokerState,repairCompletedDeletionPoker,createDeletionPokerCoordinator,assertDeletionPokerAbsent,pokerPrivacyStateSha256,parsePokerRepairManifest}=await import('../ws-server/poker/runtime/account-deletion.mjs');
async function privacyFixture(open=false) {
 const {begin}=await fixture(75);
 await db.query("insert into poker_tables(id,status,created_by) values($1,$2,$3) on conflict(id) do update set status=excluded.status,created_by=excluded.created_by",[TABLE,open?'OPEN':'CLOSED',USER]);
 const state={phase:open?'FLOP':'HAND_DONE',handId:open?'peer-hand':'',seats:[{userId:USER,seatNo:1},{userId:OTHER,seatNo:2}],
  handSeats:open?[{userId:OTHER,seatNo:2}]:[{userId:USER,seatNo:1},{userId:OTHER,seatNo:2}],stacks:open?{[OTHER]:90}:{},
  foldedByUserId:{[USER]:true,[OTHER]:false},contributionsByUserId:open?{[OTHER]:10}:{[USER]:100,[OTHER]:77},missedTurnsByUserId:{[USER]:1,[OTHER]:2}};
 await db.query("insert into chips_accounts(account_type,system_key,balance) values('ESCROW',$1,$2)",['POKER_TABLE:'+TABLE,open?100:0]);
 await db.query("insert into poker_seats values($1,$2,1,'INACTIVE',false,0)",[TABLE,USER]);
 await db.query('insert into poker_state(table_id,state) values($1,$2)',[TABLE,state]);
 const runtime=createAccountDeletionRuntime({beginSql:begin,klog:()=>{}});
 const context={userId:USER,requestId:REQUEST,generation:1,assertLease:tx=>assertLease(tx)};
 const assertLease=async tx=>{const {assertDeletionLease}=await import('../shared/account-deletion.mjs');return assertDeletionLease(tx,{requestId:REQUEST,generation:1,phase:'burn'});};
 await runtime.steps.burn(context);
 await db.query("update account_deletion_requests set phase='cleanup'");
 context.assertLease=async tx=>{const {assertDeletionLease}=await import('../shared/account-deletion.mjs');return assertDeletionLease(tx,{requestId:REQUEST,generation:1,phase:'cleanup'});};
 const history={immutable:'archive receipt',owner:USER};
 await db.query("insert into poker_requests(table_id,user_id,request_id,kind,result_json) values($1,$2,'original-receipt','ACT',$3)",[TABLE,USER,history]);
 const finances=async()=>JSON.stringify({tx:(await db.query('select * from chips_transactions order by id')).rows,entries:(await db.query('select * from chips_entries order by id')).rows,
  registry:(await db.query('select * from chips_transaction_idempotency order by idempotency_key')).rows,wallets:(await db.query('select * from chips_accounts order by id')).rows,
  receipts:(await db.query('select * from poker_requests')).rows});
 return{begin,context,state,finances,coordinate:async(c,t,run)=>run()};
}

test('owner privacy CLOSED/retry preserves other player projections and immutable finance; Auth gate rereads real rows',async()=>{
 const f=await privacyFixture();const before=await f.finances();
 assert.equal((await cleanupDeletionPoker({...f,beginSql:f.begin})).done,true);
 const [row]=(await db.query('select version,state from poker_state')).rows;
 assert.deepEqual(row.state,projectDeletionPokerState(f.state,USER));
 assert.equal((await db.query('select created_by from poker_tables where id=$1',[TABLE])).rows[0].created_by,null);
 assert.equal((await db.query('select count(*)::int n from poker_seats where user_id=$1',[USER])).rows[0].n,0);
 await cleanupDeletionPoker({...f,beginSql:f.begin});assert.equal((await db.query('select version from poker_state')).rows[0].version,row.version);
 assert.equal(await f.finances(),before);
 await f.begin(tx=>assertDeletionPokerAbsent(tx,USER));
 await db.query('update poker_state set state=$1',[{...row.state,unknownOwner:USER}]);
 await assert.rejects(f.begin(tx=>assertDeletionPokerAbsent(tx,USER)),/privacy_unconfirmed/);
});

test('owner privacy OPEN preserves active peer hand and positive escrow; BURN obligations permit only released owner',async()=>{
 const f=await privacyFixture(true);const before=await f.finances();
 assert.equal((await cleanupDeletionPoker({...f,beginSql:f.begin})).done,true);
 const [row]=(await db.query('select state from poker_state')).rows;
 assert.equal(row.state.phase,'FLOP');assert.deepEqual(row.state.stacks,{[OTHER]:90});assert.deepEqual(row.state.contributionsByUserId,{[OTHER]:10});
 assert.equal(await f.finances(),before);
});

test('privacy rejects current all-in, unknown owner field and changed CAS without deleting seat or finance',async()=>{
 const f=await privacyFixture();const before=await f.finances();
 for(const state of [{...f.state,phase:'RIVER',handSeats:[{userId:USER}],contributionsByUserId:{[USER]:100}}, {...f.state,unknown:{owner:USER}}]){
  await db.query('update poker_state set state=$1',[state]);await assert.rejects(cleanupDeletionPoker({...f,beginSql:f.begin}));
  assert.equal((await db.query('select count(*)::int n from poker_seats where user_id=$1',[USER])).rows[0].n,1);
 }
 await db.query('update poker_state set state=$1',[f.state]);
 const conflict=fn=>f.begin(tx=>fn({...tx,unsafe:(sql,params)=>sql.startsWith('update public.poker_state set state=')?Promise.resolve([]):tx.unsafe(sql,params)}));
 await assert.rejects(cleanupDeletionPoker({...f,beginSql:conflict}),/privacy_conflict/);
 assert.equal(await f.finances(),before);
 assert.equal((await db.query('select state from poker_state')).rows[0].state.seats[0].userId,USER);
});

test('committed SQL with failed cache restore stays fenced; retry resyncs even after SQL owner discovery is empty',async()=>{
 const f=await privacyFixture();const blocked=new Set();let fail=true;
 const coordination=createDeletionPokerCoordinator({enqueue:async(t,run)=>run(),block:t=>blocked.add(t),unblock:t=>blocked.delete(t),restore:async()=>({ok:!fail})});
 await assert.rejects(cleanupDeletionPoker({...f,beginSql:f.begin,...coordination}),/resync_required/);assert(blocked.has(TABLE));
 await f.begin(tx=>assertDeletionPokerAbsent(tx,USER));
 fail=false;assert.equal((await cleanupDeletionPoker({...f,beginSql:f.begin,...coordination})).done,true);assert.equal(blocked.size,0);
});

test('completed repair is exact two-table, idempotent and never invents lease/BURN/Auth effects',async()=>{
 const f=await privacyFixture();const second='66666666-6666-4666-8666-666666666666';
 await db.query("insert into poker_tables(id,status,created_by) values($1,'CLOSED',$2)",[second,USER]);
 await db.query('insert into poker_state(table_id,state) values($1,$2)',[second,{...f.state}]);
 await db.query('delete from auth.users where id=$1',[USER]);
 await db.query("update account_deletion_requests set status='COMPLETED',phase='completed',completed_at=now(),lease_until=null,incident=true");
 const before=await f.finances();const [original]=(await db.query('select * from account_deletion_requests')).rows;
 await db.exec("update account_deletion_release set redis_cutover='{\"namespace\":\"kcswh:stage:xp:v3\"}'");
 const options={env:{SUPABASE_URL:'https://krydukthwdvccggbyjfw.supabase.co',ACCOUNT_DELETION_ENABLED:'0'},beginSql:f.begin,userId:USER,requestId:REQUEST,tableIds:[TABLE,second],coordinate:f.coordinate};
 const states=(await db.query('select table_id,version,state from poker_state order by table_id')).rows;
 const manifest={version:1,stage:'krydukthwdvccggbyjfw',userId:USER,requestId:REQUEST,tables:states.map(row=>({tableId:row.table_id,version:Number(row.version),stateSha256:pokerPrivacyStateSha256(row.state),cleanedStateSha256:pokerPrivacyStateSha256(projectDeletionPokerState(row.state,USER))}))};
 options.manifest=manifest;
 const {createHash}=await import('node:crypto');const bytes=JSON.stringify(manifest),hash=createHash('sha256').update(bytes).digest('hex');
 assert.deepEqual(parsePokerRepairManifest(bytes,hash),manifest);
 assert.throws(()=>parsePokerRepairManifest(bytes,'0'.repeat(64)));
 await db.query('update poker_state set version=version+1 where table_id=$1',[second]);
 await assert.rejects(repairCompletedDeletionPoker(options),/manifest_drift/);
 assert.equal(await f.finances(),before);assert.equal((await db.query('select count(*)::int n from poker_seats where user_id=$1',[USER])).rows[0].n,1);
 await db.query('update poker_state set version=version-1 where table_id=$1',[second]);
 const originalSecond=states.find(row=>row.table_id===second).state;
 await db.query('update poker_state set state=$2 where table_id=$1',[second,{...originalSecond,unrelatedAuditChange:true}]);
 await assert.rejects(repairCompletedDeletionPoker(options),/manifest_drift/);
 assert.equal((await db.query('select state from poker_state where table_id=$1',[TABLE])).rows[0].state.seats[0].userId,USER);
 await db.query('update poker_state set state=$2 where table_id=$1',[second,originalSecond]);
 // Missing second-table escrow is an uncertainty, never fabricated as zero.
 await assert.rejects(repairCompletedDeletionPoker(options));
 await db.query("insert into chips_accounts(account_type,system_key,balance) values('ESCROW',$1,0)",['POKER_TABLE:'+second]);
 const ready=await f.finances();assert.equal((await repairCompletedDeletionPoker(options)).done,true);await repairCompletedDeletionPoker(options);
 assert.equal(await f.finances(),ready);
 const [after]=(await db.query('select * from account_deletion_requests')).rows;
 assert.equal(after.status,original.status);assert.equal(after.incident,true);assert.equal(after.lease_generation,original.lease_generation);assert.equal(after.lease_until,null);
 assert.equal((await db.query('select count(*)::int n from auth.users where id=$1',[USER])).rows[0].n,0);
 assert.equal((await db.query("select count(*)::int n from chips_transactions where tx_type='BURN'")).rows[0].n,1);
 await assert.rejects(repairCompletedDeletionPoker({...options,tableIds:[TABLE]}));
 await assert.rejects(repairCompletedDeletionPoker({...options,env:{...options.env,SUPABASE_URL:'https://production.supabase.co'}}));
 await assert.rejects(repairCompletedDeletionPoker({...options,env:{...options.env,ACCOUNT_DELETION_ENABLED:'1'}}));
});


test('failed privacy restore exposes no stale state or snapshot until successful canonical resync',async()=>{
 const {createTableManager}=await import('../ws-server/poker/table/table-manager.mjs');
 const manager=createTableManager(),tableId='privacy-read-fence',context={userId:'deleted-owner',requestId:'repair'};
 assert.equal(manager.restoreTableFromPersisted(tableId,{coreState:{version:5,members:[{userId:context.userId,seat:1}],seats:{[context.userId]:1},appliedRequestIds:[],maxSeats:4}}).ok,true);
 const oldView=manager.tableSnapshot(tableId,null);assert(JSON.stringify(oldView).includes(context.userId));
 let fail=true;
 const coordinator=createDeletionPokerCoordinator({enqueue:async(_id,run)=>run(),block:id=>manager.blockTableMutations(id),unblock:id=>manager.unblockTableMutations(id),restore:async id=>fail?{ok:false}:manager.restoreTableFromPersisted(id,{coreState:{version:10,members:[],seats:{},appliedRequestIds:[],maxSeats:4}})});
 await assert.rejects(coordinator.coordinate(context,tableId,async()=>{}),/resync_required/);
 for(const view of [manager.tableSnapshot(tableId,null),manager.tableState(tableId)]){assert.equal(view.unavailable,true);assert(!JSON.stringify(view).includes(context.userId));}
 assert.equal(manager.resync({ws:{},userId:'reader',tableId}).code,'table_resync_required');
 assert.equal(manager.bootstrapHand(tableId).code,'table_resync_required');
 fail=false;await coordinator.resync(context);
 assert.equal(manager.isTableMutationBlocked(tableId),false);
 assert.equal(manager.isTableViewCurrent(oldView),false,'captured pre-await view stays invalid after restore');
 assert.equal(manager.isTableViewCurrent(manager.tableSnapshot(tableId,null)),true);
 assert.notEqual(manager.tableSnapshot(tableId,null).unavailable,true);
 assert.deepEqual(manager.tableState(tableId).members,[]);
 assert(!JSON.stringify(manager.tableSnapshot(tableId,null)).includes(context.userId));
});
