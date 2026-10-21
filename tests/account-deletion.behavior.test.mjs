import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { requestDeletion, assertAccountActive, getDeletionStatus, advanceDeletion, assertDeletionLease, deleteAuthUser, issueDeletionStatusAccess, readDeletionStatusAccess, queueAccountPrivateFrame } from '../shared/account-deletion.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const phases = ['preparing', 'poker', 'burn', 'cleanup', 'auth'];
let database;
after(async () => { if (database) await database.close(); });
async function fixture(t) {
  if (!database) {
  database = new PGlite();
  const db = database;
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table poker_tables(id uuid primary key,status text); create table chips_accounts(account_type text,system_key text,balance bigint); create schema auth; create table auth.users(id uuid primary key); create table public.user_profiles(user_id uuid,display_name text); create table public.favorites(user_id uuid,game_id text); create table public.poker_state(table_id uuid,state jsonb); create table public.poker_seats(table_id uuid,user_id uuid,status text default 'ACTIVE',stack bigint default 0); create table public.bonus_campaigns(created_by uuid); create table public.bonus_campaign_eligible_users(created_by uuid); create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`);
  await db.exec(await readFile(new URL('../supabase/manual/1117-account-deletion-requests-v2.sql', import.meta.url), 'utf8'));
  }
  const db = database;
  await db.exec('delete from public.account_deletion_requests; delete from auth.users;');
  await db.query('insert into auth.users values($1),($2)', [OWNER, OTHER]);
  const adapter = (client) => ({ unsafe: async (sql, params = []) => (await client.query(sql, params)).rows });
  const beginSql = (fn) => db.transaction((tx) => fn(adapter(tx)));
  return { db, beginSql };
}

test('durable request replays once, denies deleted/missing UUID and leaves another owner active', async (t) => {
  const { db, beginSql } = await fixture(t);
  const first = await beginSql((tx) => requestDeletion(tx, OWNER));
  const duplicate = await beginSql((tx) => requestDeletion(tx, OWNER));
  assert.equal(first.request_id, duplicate.request_id);
  assert.equal((await db.query('select count(*)::int as n from public.account_deletion_requests')).rows[0].n, 1);
  assert.deepEqual(await beginSql((tx) => getDeletionStatus(tx, OTHER)), null);
  assert.equal((await beginSql((tx) => getDeletionStatus(tx, OWNER))).accepted, false);
  await assert.rejects(beginSql((tx) => assertAccountActive(tx, OWNER)), { code: 'account_not_active' });
  await beginSql((tx) => assertAccountActive(tx, OTHER));
  await db.query('delete from auth.users where id=$1', [OTHER]);
  await assert.rejects(beginSql((tx) => requestDeletion(tx, OTHER)), { code: 'account_not_active' });
});

test('no-table request advances one durable phase per call and Auth is last', async (t) => {
  const { db, beginSql } = await fixture(t);
  const row = await beginSql((tx) => requestDeletion(tx, OWNER));
  const called = [];
  const steps = Object.fromEntries(phases.map((p) => [p, async ({ userId }) => { assert.equal(userId, OWNER); called.push(p); return { done: true }; }]));
  for (let i = 0; i < phases.length; i++) {
    const out = await advanceDeletion({ beginSql, requestId: row.request_id, steps });
    assert.equal(out.advanced, true);
    assert.equal(out.state.completed, i === phases.length - 1);
  }
  assert.deepEqual(called, phases);
  assert.equal((await advanceDeletion({ beginSql, requestId: row.request_id, steps })).advanced, false);
  await db.query('delete from auth.users where id=$1', [OWNER]);
  assert.equal((await beginSql((tx) => getDeletionStatus(tx, OWNER))).completed, true);
});

test('missing adapters and uncertain result cannot advance; financial mismatch stops destructive work', async (t) => {
  const { db, beginSql } = await fixture(t);
  const row = await beginSql((tx) => requestDeletion(tx, OWNER));
  await assert.rejects(advanceDeletion({ beginSql, requestId: row.request_id, steps: {} }), { code: 'deletion_dependencies_incomplete' });
  const steps = Object.fromEntries(phases.map((p) => [p, async () => ({ done: true })]));
  steps.preparing = async () => undefined;
  assert.equal((await advanceDeletion({ beginSql, requestId: row.request_id, steps })).advanced, false);
  let current = (await db.query('select * from public.account_deletion_requests')).rows[0];
  assert.equal(current.phase, 'preparing'); assert.equal(current.accepted_at, null); assert.equal(current.status, 'RETRY');
  await db.exec("update public.account_deletion_requests set next_attempt_at=clock_timestamp()");
  steps.preparing = async () => { throw Object.assign(new Error('sensitive text not persisted'), { code: 'financial_mismatch' }); };
  await advanceDeletion({ beginSql, requestId: row.request_id, steps });
  current = (await db.query('select * from public.account_deletion_requests')).rows[0];
  assert.equal(current.status, 'ERROR'); assert.equal(current.incident, true); assert.equal(current.error_code, 'financial_mismatch');
  assert.equal((await advanceDeletion({ beginSql, requestId: row.request_id, steps })).advanced, false);
});

test('expired lease result cannot commit phase progress', async (t) => {
  const { db, beginSql } = await fixture(t);
  const row = await beginSql((tx) => requestDeletion(tx, OWNER));
  const steps = Object.fromEntries(phases.map((p) => [p, async () => ({ done: true })]));
  steps.preparing = async () => {
    await db.exec("update public.account_deletion_requests set lease_until=clock_timestamp()-interval '1 second'");
    return { done: true };
  };
  assert.equal((await advanceDeletion({ beginSql, requestId: row.request_id, steps })).advanced, false);
  assert.equal((await beginSql((tx) => getDeletionStatus(tx, OWNER))).accepted, false);
  steps.preparing = async () => ({ done: true });
  assert.equal((await advanceDeletion({ beginSql, requestId: row.request_id, steps })).advanced, true);
});

test('Auth hard delete uses exact old UUID, official API and reconciles lost response only with 404', async () => {
  const calls = [];
  const base = { userId: OWNER, supabaseUrl: 'https://stage.example.test', serviceRoleKey: 'test-only', authorizeDeletion: async (id) => assert.equal(id, OWNER) };
  const fetchImpl = async (url, options) => {
    calls.push(options.method || 'GET'); assert.ok(url.endsWith('/admin/users/' + OWNER));
    if (options.method === 'DELETE') throw new Error('response lost');
    return calls.length === 1 ? new Response(JSON.stringify({ id: OWNER }), { status: 200 }) : new Response('', { status: 404 });
  };
  assert.deepEqual(await deleteAuthUser({ ...base, fetchImpl }), { done: true, reconciled: true });
  assert.deepEqual(calls, ['GET', 'DELETE', 'GET']);
  await assert.rejects(deleteAuthUser({ ...base, fetchImpl: async () => new Response('{}', { status: 500 }) }));
  await assert.rejects(deleteAuthUser({ ...base, fetchImpl: async () => new Response(JSON.stringify({ id: OTHER }), { status: 200 }) }), /identity_mismatch/);
  let n = 0;
  await assert.rejects(deleteAuthUser({ ...base, fetchImpl: async () => ++n === 1 ? new Response(JSON.stringify({ id: OWNER }), { status: 200 }) : new Response('{}', { status: 500 }) }), /unconfirmed/);
});


test('replacement lease denies stale SQL adapter; financial incident survives expired worker', async (t) => {
  const { db, beginSql } = await fixture(t);
  const row = await beginSql((tx) => requestDeletion(tx, OWNER));
  const steps = Object.fromEntries(phases.map((p) => [p, async () => ({ done: true })]));
  steps.preparing = async (context) => {
    await db.exec("update public.account_deletion_requests set lease_generation=lease_generation+1");
    await assert.rejects(beginSql((tx) => context.assertLease(tx)), { code: 'deletion_lease_lost' });
    throw Object.assign(new Error('mismatch found'), { code: 'financial_mismatch' });
  };
  await advanceDeletion({ beginSql, requestId: row.request_id, steps });
  const state = (await db.query('select * from public.account_deletion_requests')).rows[0];
  assert.equal(state.status, 'ERROR'); assert.equal(state.incident, true);
  assert.equal((await advanceDeletion({ beginSql, requestId: row.request_id, steps })).advanced, false);
});

test('Auth deletion requires authorized durable intent before even not-found reconciliation', async () => {
  let calls = 0;
  const options = { userId: OWNER, supabaseUrl: 'https://stage.example.test', serviceRoleKey: 'test-only',
    fetchImpl: async () => { calls++; return new Response('', { status: 404 }); } };
  await assert.rejects(deleteAuthUser(options), /intent_required/);
  assert.equal(calls, 0);
  await assert.rejects(deleteAuthUser({ ...options, authorizeDeletion: async () => { throw new Error('lease_lost'); } }), /lease_lost/);
  assert.equal(calls, 0);
  assert.deepEqual(await deleteAuthUser({ ...options, authorizeDeletion: async () => {} }), { done: true, reconciled: true });
});


test('lost authorization before DELETE is not swallowed as an uncertain provider response', async () => {
  let authorizations = 0;
  const calls = [];
  await assert.rejects(deleteAuthUser({ userId: OWNER, supabaseUrl: 'https://stage.example.test', serviceRoleKey: 'test-only',
    authorizeDeletion: async () => { if (++authorizations === 2) throw new Error('lease_lost'); },
    fetchImpl: async (url, options) => { calls.push(options.method || 'GET'); return new Response(JSON.stringify({ id: OWNER }), { status: 200 }); }
  }), /lease_lost/);
  assert.deepEqual(calls, ['GET']);
});


test('bounded status capability reveals only its request after Auth removal and expires',async(t)=>{
 const {db,beginSql}=await fixture(t);
 await beginSql(tx=>requestDeletion(tx,OWNER));
 const issued=await beginSql(tx=>issueDeletionStatusAccess(tx,OWNER));
 await db.query('delete from auth.users where id=$1',[OWNER]);
 assert.equal((await beginSql(tx=>readDeletionStatusAccess(tx,issued.requestId,issued.statusToken))).requestId,issued.requestId);
 assert.equal(await beginSql(tx=>readDeletionStatusAccess(tx,OTHER,issued.statusToken)),null);
 assert.equal(await beginSql(tx=>readDeletionStatusAccess(tx,issued.requestId,'bad')),null);
 await db.exec("update public.account_deletion_requests set status_token_expires_at=clock_timestamp()-interval '1 second'");
 assert.equal(await beginSql(tx=>readDeletionStatusAccess(tx,issued.requestId,issued.statusToken)),null);
 const stored=(await db.query('select status_token_hash from public.account_deletion_requests')).rows[0];
 assert.notEqual(stored.status_token_hash,issued.statusToken);
});

test('planned wait persists cursor deadline without acceptance or destructive progression',async(t)=>{
 const {db,beginSql}=await fixture(t);const row=await beginSql(tx=>requestDeletion(tx,OWNER));
 const steps=Object.fromEntries(phases.map(p=>[p,async()=>({done:true})]));
 steps.preparing=async()=>({waitUntil:new Date(Date.now()+10000).toISOString()});
 assert.equal((await advanceDeletion({beginSql,requestId:row.request_id,steps})).waiting,true);
 const state=(await db.query('select * from public.account_deletion_requests')).rows[0];
 assert.equal(state.phase,'preparing');assert.equal(state.accepted_at,null);assert.equal(state.incident,false);
 assert.equal((await advanceDeletion({beginSql,requestId:row.request_id,steps})).advanced,false);
});

test('real WS phase coordinator resumes no-table request; incomplete cleanup never invokes Auth',async(t)=>{
 const {createAccountDeletionRuntime}=await import('../ws-server/poker/runtime/account-deletion.mjs');
 const {db,beginSql}=await fixture(t);const request=await beginSql(tx=>requestDeletion(tx,OWNER));
 const observed=[];
 const runtime=createAccountDeletionRuntime({beginSql,env:{ACCOUNT_DELETION_ENABLED:'1'},redisIsMemory:false,klog:()=>{},
  blockIdentity:async id=>{assert.equal(id,OWNER);observed.push('blocked');},disconnectUser:async()=>observed.push('disconnected'),
  leaveFromTable:async()=>{throw new Error('unexpected table');},
  retireWallet:async({tx,assertLease})=>{const row=await assertLease(tx);assert.equal(row.progress.poker.done,true);await tx.unsafe("update public.account_deletion_requests set progress=jsonb_set(progress,'{walletRetirement}', '{\"retiredAt\":\"test-only\"}'::jsonb) where request_id=$1",[request.request_id]);return {done:true};},
  cleanupAvatars:async()=>({done:true}),cleanupRedis:async()=>({done:false,reason:'legacy_unproven'}),deleteAuth:async()=>{observed.push('auth');return {done:true};}
 });
 await runtime.tick();await runtime.tick();await runtime.tick();await runtime.tick();
 const state=(await db.query('select * from public.account_deletion_requests')).rows[0];
 assert.equal(state.phase,'cleanup');assert.equal(state.status,'RETRY');assert.equal(state.completed_at,null);
 assert.deepEqual(observed,['blocked','disconnected']);
});


test('private WS enqueue rejects an already active socket after durable deletion intent',async(t)=>{
 const {beginSql}=await fixture(t);const sent=[];const closed=[];
 const ws={readyState:1,send:value=>sent.push(JSON.parse(value))};
 const connection={session:{userId:OWNER}};
 const send=()=>queueAccountPrivateFrame({ws,connection,ownerId:OWNER,frame:{private:'synthetic-cards'},beginSql,close:reason=>closed.push(reason)});
 await send();assert.equal(sent.length,1);
 await beginSql(tx=>requestDeletion(tx,OWNER));
 await send();assert.equal(sent.length,1);assert.deepEqual(closed,['account_not_active']);
 connection.session.userId=OTHER;
 await queueAccountPrivateFrame({ws,connection,ownerId:OTHER,frame:{private:'other-owner'},beginSql,close:reason=>closed.push(reason)});
 assert.equal(sent.length,2);
});


test('privileged profile/favorite writes cannot recreate a suspended owner; exact cleanup and other owner survive',async(t)=>{
 const {db,beginSql}=await fixture(t);
 await db.query('insert into user_profiles values($1,$2)',[OWNER,'synthetic']);
 await db.query('insert into favorites values($1,$2)',[OWNER,'snake']);
 await beginSql(tx=>requestDeletion(tx,OWNER));
 await assert.rejects(db.query('insert into favorites values($1,$2)',[OWNER,'tetris']),{code:'42501'});
 await assert.rejects(db.query('update user_profiles set display_name=$2 where user_id=$1',[OWNER,'late']),{code:'42501'});
 await db.query('insert into favorites values($1,$2)',[OTHER,'tetris']);
 await db.query('delete from favorites where user_id=$1',[OWNER]);
 assert.equal((await db.query('select count(*)::int n from favorites where user_id=$1',[OWNER])).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from favorites where user_id=$1',[OTHER])).rows[0].n,1);
});


test('BURN diagnostic redacts provider details and preserves the original failure',async()=>{
 const {createAccountDeletionRuntime}=await import('../ws-server/poker/runtime/account-deletion.mjs');
 const failure=Object.assign(new Error('private SQL/token must not be logged'),{code:'57014'});
 const logs=[];
 const runtime=createAccountDeletionRuntime({beginSql:async fn=>fn({unsafe:async()=>[]}),
  env:{ACCOUNT_DELETION_ENABLED:'1'},klog:(event,data)=>logs.push({event,data}),
  retireWallet:async()=>{throw failure;}});
 await assert.rejects(runtime.steps.burn({userId:OWNER,requestId:OTHER}),error=>error===failure);
 assert.equal(logs.length,1);assert.equal(logs[0].event,'account_deletion_burn_failed');
 assert.equal(logs[0].data.sqlState,'57014');assert.equal(logs[0].data.requestId,OTHER);
 assert.equal(typeof logs[0].data.durationMs,'number');
 assert.doesNotMatch(JSON.stringify(logs),/private SQL|token|message|stack/);
});


test('completed status suppresses active intervention without clearing historical incident', async(t)=>{
 const {db,beginSql}=await fixture(t);const row=await beginSql(tx=>requestDeletion(tx,OWNER));
 await db.query("update account_deletion_requests set incident=true,status='RETRY',phase='poker',accepted_at=clock_timestamp() where request_id=$1",[row.request_id]);
 assert.equal((await beginSql(tx=>getDeletionStatus(tx,OWNER))).requiresIntervention,true);
 await db.query("update account_deletion_requests set status='COMPLETED',phase='completed',completed_at=clock_timestamp() where request_id=$1",[row.request_id]);
 const state=await beginSql(tx=>getDeletionStatus(tx,OWNER));
 assert.equal(state.completed,true);assert.equal(state.requiresIntervention,false);assert.equal(state.retryable,false);
 const [saved]=(await db.query('select * from account_deletion_requests where request_id=$1',[row.request_id])).rows;
 assert.equal(saved.incident,true);
});
