import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { postTransaction, retireUserForDeletion, postPokerLeaveCashout } from '../netlify/functions/_shared/chips-ledger.mjs';
import { postTransaction as postWsTransaction } from '../ws-server/poker/persistence/chips-ledger.mjs';
import { assertDeletionLease } from '../shared/account-deletion.mjs';
const USER='11111111-1111-4111-8111-111111111111', OTHER='22222222-2222-4222-8222-222222222222';
const REQUEST='33333333-3333-4333-8333-333333333333', TABLE='44444444-4444-4444-8444-444444444444';
process.env.ACCOUNT_DELETION_ENABLED='1';
let db;
after(async()=> { delete process.env.ACCOUNT_DELETION_ENABLED; await db?.close(); });
async function fixture(balance=75) {
  if (!db) {
    db=new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table bonus_campaigns(created_by uuid); create table bonus_campaign_eligible_users(created_by uuid);
      create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select null::uuid$$;
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
      create table poker_seats(table_id uuid,user_id uuid);
      create table poker_state(table_id uuid primary key,state jsonb);`);
    await db.exec(await readFile(new URL('../supabase/manual/1117-account-deletion-requests-v2.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/manual/1117-account-deletion-wallet-retirement-v2.sql',import.meta.url),'utf8'));
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
  const retire=tx=>retireUserForDeletion({tx,userId:USER,requestId:REQUEST,
    assertLease:tx=>assertDeletionLease(tx,{requestId:REQUEST,generation:1,phase:'burn'})});
  return {begin,retire};
}

test('positive final wallet burns once, retires USER, preserves Auth FK/history and exact replay',async()=>{
  const {begin,retire}=await fixture();
  const first=await begin(retire), retry=await begin(retire);
  assert.equal(first.done,true); assert.deepEqual(retry,first);
  const [account]=(await db.query("select * from chips_accounts where account_type='USER'")).rows;
  assert.equal(Number(account.balance),0); assert.equal(account.status,'closed');
  assert.equal(account.user_id,null); assert.equal(account.retired_user_id,USER);
  assert.equal((await db.query('select count(*)::int n from chips_transactions')).rows[0].n,1);
  assert.equal((await db.query('select sum(amount)::int n from chips_entries')).rows[0].n,0);
  const receipt=(await db.query('select progress from account_deletion_requests')).rows[0].progress.walletRetirement;
  const replay=await begin(tx=>postTransaction({...JSON.parse(receipt.burnPayload),tx}));
  assert.equal(replay.transaction.id,receipt.burnTransactionId); assert.equal(replay.account.id,account.id);
  // Retention may remove hot rows, but immutable registry receipts still replay
  // against the retired USER snapshot without recreating a live wallet.
  await db.exec('delete from chips_entries; delete from chips_transactions');
  const archived=await begin(tx=>postTransaction({...JSON.parse(receipt.burnPayload),tx}));
  assert.equal(archived.transaction.id,receipt.burnTransactionId);
  assert.equal(archived.entries.length,2); assert.equal(archived.account.id,account.id);
  await db.query('delete from auth.users where id=$1',[USER]);
  assert.equal(archived.entries.length,2);
  await assert.rejects(db.query("insert into chips_accounts(user_id,account_type) values($1,'USER')",[USER]));
  await assert.rejects(db.query('update chips_accounts set retired_user_id=$1 where id=$2',[OTHER,account.id]));
  await assert.rejects(db.query("insert into chips_accounts(user_id,account_type) values('55555555-5555-4555-8555-555555555555','USER')"),{code:'23503'});
});

test('zero wallet records no-burn evidence and never creates an empty transaction',async()=>{
  const {begin,retire}=await fixture(0); await begin(retire); await begin(retire);
  assert.equal((await db.query('select count(*)::int n from chips_transactions')).rows[0].n,0);
  assert.equal((await db.query('select progress from account_deletion_requests')).rows[0].progress.walletRetirement.noBurn,true);
});

test('late credit, forged internal option, unresolved Poker and stale lease cannot destroy finances',async()=>{
  const {begin,retire}=await fixture();
  await assert.rejects(begin(tx=>postTransaction({tx,userId:OTHER,createdBy:USER,txType:'ADMIN_ADJUST',idempotencyKey:'suspended-admin',
    entries:[{accountType:'USER',userId:OTHER,amount:10},{accountType:'SYSTEM',systemKey:'GENESIS',amount:-10}]})),{code:'account_not_active'});
  const credit={userId:OTHER,txType:'ADMIN_ADJUST',idempotencyKey:'late',internalAuthorization:'deletion',
    entries:[{accountType:'SYSTEM',systemKey:'GENESIS',amount:-10},{accountType:'USER',userId:USER,amount:10}]};
  await assert.rejects(begin(tx=>postTransaction({...credit,tx})),{code:'account_not_active'});
  await db.query('insert into poker_seats values($1,$2)',[TABLE,USER]);
  await assert.rejects(begin(retire),{code:'financial_mismatch'});
  await db.exec('truncate poker_seats');
  await db.exec("update account_deletion_requests set lease_until=now()-interval '1 second'");
  await assert.rejects(begin(retire),{code:'deletion_lease_lost'});
  assert.equal((await db.query("select balance::int n from chips_accounts where account_type='USER'")).rows[0].n,75);
});

test('trusted settled cashout validates table and amount then contributes winnings to final burn',async()=>{
  const {begin,retire}=await fixture(5);
  await db.exec("update account_deletion_requests set phase='poker'");
  await db.query('insert into poker_state values($1,$2)',[TABLE,JSON.stringify({phase:'SETTLED',stacks:{[USER]:25}})]);
  await db.query("insert into chips_accounts(account_type,system_key,balance) values('ESCROW',$1,25)",['POKER_TABLE:'+TABLE]);
  const cashout=tx=>postPokerLeaveCashout({tx,userId:USER,tableId:TABLE,amount:25,idempotencyKey:'settled'});
  await assert.rejects(begin(tx=>postPokerLeaveCashout({tx,userId:USER,tableId:TABLE,amount:26,idempotencyKey:'forged'})),{code:'financial_mismatch'});
  await begin(cashout); await begin(cashout);
  await db.exec("truncate poker_state; update account_deletion_requests set phase='burn'");
  await begin(retire);
  const receipt=(await db.query('select progress from account_deletion_requests')).rows[0].progress.walletRetirement;
  assert.equal(receipt.amount,30);
  assert.equal((await db.query("select count(*)::int n from chips_transactions where tx_type='BURN'")).rows[0].n,1);
});


test('owner without a wallet receives zero retirement evidence and cannot recreate the old identity',async()=>{
  const {begin,retire}=await fixture(0);
  await db.exec("delete from chips_accounts where account_type='USER'");
  await begin(retire);
  const [account]=(await db.query("select * from chips_accounts where account_type='USER'")).rows;
  assert.equal(account.retired_user_id,USER); assert.equal(Number(account.balance),0);
  await assert.rejects(db.query("insert into chips_accounts(user_id,account_type) values($1,'USER')",[USER]),{code:'23505'});
  assert.equal((await db.query('select count(*)::int n from chips_transactions')).rows[0].n,0);
});


test('SQL retirement cannot substitute direct zeroing for a canonical BURN receipt',async()=>{
  const {begin}=await fixture(75);
  await assert.rejects(begin(async tx=>{
    await tx.unsafe("update chips_accounts set balance=0 where user_id=$1",[USER]);
    await tx.unsafe(`update account_deletion_requests set progress=jsonb_set(progress,'{walletRetirement}',
      jsonb_build_object('accountId',(select id::text from chips_accounts where user_id=$1),'amount',75,'noBurn',false))`,[USER]);
    await tx.unsafe("update chips_accounts set user_id=null,retired_user_id=$1,retired_at=now(),status='closed' where user_id=$1",[USER]);
  }),{code:'23514'});
  assert.equal((await db.query("select balance::int n from chips_accounts where user_id=$1",[USER])).rows[0].n,75);
});


test('independent WS buy-in fences actual USER entries after acceptance, preserving nullable bot funding',async()=>{
  const {begin}=await fixture(75);
  await db.query("insert into chips_accounts(account_type,system_key,balance) values('ESCROW',$1,0)",['POKER_TABLE:'+TABLE]);
  const payload={userId:OTHER,txType:'TABLE_BUY_IN',idempotencyKey:'ws-deleting',
    entries:[{accountType:'USER',userId:USER,amount:-25},{accountType:'ESCROW',systemKey:'POKER_TABLE:'+TABLE,amount:25}]};
  await assert.rejects(begin(tx=>postWsTransaction({...payload,tx})),{code:'account_not_active'});
  assert.equal((await db.query("select balance::int n from chips_accounts where user_id=$1",[USER])).rows[0].n,75);
  await db.query("insert into chips_accounts(user_id,account_type,balance) values($1,'USER',100)",[OTHER]);
  await begin(tx=>postWsTransaction({...payload,idempotencyKey:'ws-active',entries:[
    {accountType:'USER',userId:OTHER,amount:-25},payload.entries[1]],tx}));
  await db.exec("update chips_accounts set balance=100 where system_key='GENESIS'");
  await begin(tx=>postWsTransaction({userId:null,txType:'TABLE_BUY_IN',idempotencyKey:'ws-bot',tx,
    entries:[{accountType:'SYSTEM',systemKey:'GENESIS',amount:-25},payload.entries[1]]}));
  assert.equal((await db.query('select count(*)::int n from chips_transactions')).rows[0].n,2);
});

test('WS historical buy-in replays against retired wallet without another debit or recreation',async()=>{
  const {begin,retire}=await fixture(75);
  const [request]=(await db.query('delete from account_deletion_requests returning *')).rows;
  await db.query("insert into chips_accounts(account_type,system_key,balance) values('ESCROW',$1,0)",['POKER_TABLE:'+TABLE]);
  const payload={userId:USER,txType:'TABLE_BUY_IN',idempotencyKey:'ws-historical',
    entries:[{accountType:'USER',amount:-25},{accountType:'ESCROW',systemKey:'POKER_TABLE:'+TABLE,amount:25}]};
  const original=await begin(tx=>postWsTransaction({...payload,tx}));
  await db.query(`insert into account_deletion_requests(request_id,old_user_id,status,phase,accepted_at,lease_until,lease_generation,progress)
    values($1,$2,'PROCESSING','poker',now(),now()+interval '120 seconds',1,$3)`,[request.request_id,USER,JSON.stringify(request.progress)]);
  await db.query('insert into poker_state values($1,$2)',[TABLE,JSON.stringify({phase:'SETTLED',stacks:{[USER]:25}})]);
  await begin(tx=>postPokerLeaveCashout({tx,userId:USER,tableId:TABLE,amount:25,idempotencyKey:'ws-return'}));
  await db.exec("truncate poker_state; update account_deletion_requests set phase='burn'");
  await begin(retire);
  const replay=await begin(tx=>postWsTransaction({...payload,tx}));
  assert.equal(replay.transaction.id,original.transaction.id);
  assert.equal(Number(replay.account.balance),0);
  assert.equal((await db.query("select count(*)::int n from chips_accounts where account_type='USER'")).rows[0].n,1);
});


test('forward retention proposal matches only the original retired USER and preserves the effective prune guards',async()=>{
  const local=new PGlite();
  try {
    await local.exec(`create role anon; create role authenticated; create role service_role; create role chips_ledger_archive_pruner;
      create table chips_accounts(id uuid,account_type text,user_id uuid,retired_user_id uuid,retired_at timestamptz,
        system_key text,status text,balance bigint);
      create table chips_ledger_archive_batches(batch_id bigint);`);
    const baseline=await readFile('supabase/migrations/20260904170000_chips_ledger_closed_human_prune_whitelist.sql','utf8');
    const functionSql=baseline.slice(baseline.indexOf('create or replace function'),baseline.indexOf('$$;',baseline.indexOf('create or replace function'))+3);
    await local.exec(functionSql);
    await local.exec("alter function chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean) owner to chips_ledger_archive_pruner;");
    const retryPatch=await readFile('supabase/migrations/20260912083727_chips_archive_prune_registry_cleaned_retry.sql','utf8');
    await local.exec('do $prune_retry_patch$'+retryPatch.split('$prune_retry_patch$')[1]+'$prune_retry_patch$;');
    const before=(await local.query("select pg_get_functiondef('public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)'::regprocedure) definition")).rows[0].definition;
    const membershipsBefore=(await local.query('select * from pg_auth_members order by oid')).rows;
    await local.exec(await readFile('supabase/manual/1117-account-deletion-retention-v2.sql','utf8'));
    assert.deepEqual((await local.query('select * from pg_auth_members order by oid')).rows,membershipsBefore);
    assert.equal((await local.query("select has_schema_privilege('chips_ledger_archive_pruner','public','CREATE') allowed")).rows[0].allowed,false);
    const after=(await local.query("select pg_get_functiondef('public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)'::regprocedure) definition")).rows[0].definition;
    const proposal=await readFile('supabase/manual/1117-account-deletion-retention-v2.sql','utf8');
    const needle=proposal.split('$needle$')[1], replacement=proposal.split('$replacement$')[1];
    assert.equal(after,before.replace(needle,replacement));
    assert.match(after,/batch.registry_cleaned_keys_sha256/);
    const matches=async(overrides={})=>{
      const account={account_type:'USER',user_id:null,retired_user_id:USER,retired_at:'2026-10-01T00:00:00Z',system_key:null,status:'closed',balance:0,...overrides};
      return (await local.query(`select chips_retention_user_matches_v2(jsonb_populate_record(null::chips_accounts,$1::jsonb),$2::uuid) matches`,[JSON.stringify(account),USER])).rows[0].matches;
    };
    assert.equal(await matches(),true);
    assert.equal(await matches({user_id:USER,retired_user_id:null,retired_at:null,status:'active',balance:50}),true);
    for(const invalid of [{retired_user_id:OTHER},{balance:1},{retired_at:null},{status:'frozen'},{user_id:USER},{account_type:'ESCROW'},{system_key:'GENESIS'}])
      assert.equal(await matches(invalid),false);
    assert.equal(await matches({retired_user_id:null}),false);
    // Execute the actual export shape CTE, not a second handwritten classifier.
    const {CLOSED_HUMAN_TABLE_CANDIDATE_SQL}=await import('../scripts/ops/chips-ledger-archive-export.mjs');
    const shape=CLOSED_HUMAN_TABLE_CANDIDATE_SQL.split('), shaped as materialized (')[1].split('), eligible as (')[0];
    await local.exec('create table chips_entries(id bigint,transaction_id uuid,account_id uuid,amount bigint)');
    await local.query(`insert into chips_accounts values($1,'USER',null,$1,now(),null,'closed',0),
      ($2,'ESCROW',null,null,null,$3,'active',0)`,[USER,OTHER,'POKER_TABLE:'+REQUEST]);
    await local.query('insert into chips_entries values(1,$1,$2,-100),(2,$1,$3,100)',[REQUEST,USER,OTHER]);
    const shaped=async(owner=USER)=>(await local.query(`with hot as (
      select $1::uuid id,$2::uuid user_id,$3::uuid table_id
    ), shaped as materialized (${shape}) select * from shaped`,[REQUEST,owner,REQUEST])).rows[0];
    assert.equal((await shaped()).active_accounts,true);
    assert.equal(Number((await shaped()).matching_user_count),1);
    assert.equal(Number((await shaped(OTHER)).matching_user_count),0);
    await local.query('update chips_accounts set balance=1 where id=$1',[USER]);
    assert.equal((await shaped()).active_accounts,false);
    await local.query('update chips_accounts set balance=0 where id=$1',[USER]);
    // Pre-retirement schemas lack both new columns; export must still work before rollout.
    await local.exec('drop function chips_retention_user_matches_v2(chips_accounts,uuid); alter table chips_accounts drop column retired_user_id; alter table chips_accounts drop column retired_at;');
    await local.query("update chips_accounts set user_id=$1,status='active' where id=$1",[USER]);
    assert.equal((await shaped()).active_accounts,true);
    assert.equal(Number((await shaped()).matching_user_count),1);
    // A changed/unexpected function definition must hold pruning, never silently broaden it.
    await assert.rejects(local.exec(proposal));
  } finally { await local.close(); }
});
