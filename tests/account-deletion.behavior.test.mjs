import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { requestDeletion, assertAccountActive, getDeletionStatus, advanceDeletion, assertDeletionLease, deleteAuthUser } from '../shared/account-deletion.mjs';

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
    create schema auth; create table auth.users(id uuid primary key);`);
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
