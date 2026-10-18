import test from 'node:test';
import assert from 'node:assert/strict';
process.env.XP_TEST_MODE = '1';
process.env.ACCOUNT_DELETION_ENABLED = '1';
const { __createMemoryStoreForTests: memoryStore, guardedUserMutation, guardedRedisEval, blockRedisIdentity } = await import('../netlify/functions/_shared/store-upstash.mjs');
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const EPOCH = 'account-deletion:redis:epoch';
const permit = (id) => 'account-deletion:redis:permit:' + id;
const active = async (fn) => fn({ unsafe: async (sql) => sql.includes('as present') ? [{ present: true, deleting: false }] : [] });
const suspended = async (fn) => fn({ unsafe: async (sql) => sql.includes('as present') ? [{ present: true, deleting: true }] : [] });
async function fixture() {
  const store = memoryStore(); await store.set(EPOCH, 'epoch-one');
  return { store, beginSql: active, userId: OWNER, operation: 'setex', key: 'owner-session', value: JSON.stringify({ userId: OWNER }), ttl: 60 };
}

test('missing epoch denies; SQL suspension denies initialization, while normal guest behavior survives', async () => {
  const input = await fixture(); await input.store.del(EPOCH);
  await assert.rejects(guardedUserMutation(input), { code: 'account_redis_fenced' });
  assert.equal(await input.store.get(permit(OWNER)), null);
  await input.store.set(EPOCH, 'epoch-two');
  await assert.rejects(guardedUserMutation({ ...input, beginSql: suspended }), { code: 'account_not_active' });
  assert.equal(await input.store.get(input.key), null);
  await guardedUserMutation({ ...input, userId: 'guest:legitimate' });
  assert.ok(await input.store.get(input.key));
});

test('BLOCKED is sticky and delayed guarded SETEX/ZADD cannot recreate removed user state', async () => {
  const input = await fixture(); const pending = [];
  const original = input.store.eval;
  input.store.eval = async function(script, keys, args) {
    if (script.startsWith('-- account-guard:')) { pending.push([script, keys, args]); return 'OK'; }
    return original.call(this, script, keys, args);
  };
  await guardedUserMutation(input);
  await guardedUserMutation({ ...input, operation: 'zadd', key: 'shared-board', value: OWNER, score: 7 });
  await blockRedisIdentity(OWNER, input.store);
  await input.store.del(input.key);
  for (const args of pending) await assert.rejects(original.call(input.store, ...args), { code: 'account_redis_fenced' });
  await assert.rejects(guardedUserMutation(input), { code: 'account_redis_fenced' });
  assert.equal(await input.store.get(permit(OWNER)), 'BLOCKED');
  assert.equal(await input.store.get(input.key), null);
  assert.equal(await input.store.zscore('shared-board', OWNER), null);
});

test('missing/stale permits and rotated epoch deny captured commands before any mutation', async () => {
  const input = await fixture(); let captured;
  const original = input.store.eval;
  input.store.eval = async function(script, keys, args) {
    if (script.startsWith('-- account-guard:')) { captured = [script, keys, args]; return 'OK'; }
    return original.call(this, script, keys, args);
  };
  await guardedUserMutation(input);
  await input.store.del(permit(OWNER));
  await assert.rejects(original.call(input.store, ...captured), { code: 'account_redis_fenced' });
  await input.store.set(permit(OWNER), 'ACTIVE:epoch-one');
  await input.store.set(EPOCH, 'epoch-two');
  await assert.rejects(original.call(input.store, ...captured), { code: 'account_redis_fenced' });
  await assert.rejects(guardedUserMutation(input), { code: 'account_redis_fenced' });
  assert.equal(await input.store.get(input.key), null);
});

test('touch requires existing exact-owner session and never resurrects a removed session', async () => {
  const input = await fixture();
  assert.equal(await guardedUserMutation({ ...input, operation: 'touch', value: 1 }), 0);
  await guardedUserMutation(input);
  await assert.rejects(guardedUserMutation({ ...input, userId: OTHER, operation: 'touch', value: 2 }), /session_owner_mismatch/);
  assert.equal(await guardedUserMutation({ ...input, operation: 'touch', value: 3 }), 1);
  assert.equal(JSON.parse(await input.store.get(input.key)).lastActivity, 3);
  await input.store.del(input.key);
  assert.equal(await guardedUserMutation({ ...input, operation: 'touch', value: 4 }), 0);
  assert.equal(await input.store.get(input.key), null);
});

test('source UUID is checked before migration execution and cannot bootstrap deleted guest source', async () => {
  const input = await fixture(); let executed = false;
  const tx = async (fn) => fn({ unsafe: async (sql, params) => {
    if (sql.includes('as present')) return [{ present: params[0] !== OWNER, deleting: params[0] === OWNER }];
    return [];
  } });
  const original = input.store.eval;
  input.store.eval = async function(script, keys, args) { if (script === 'migration') executed = true; return original.call(this, script, keys, args); };
  await assert.rejects(guardedRedisEval({ store: input.store, userIds: [OWNER, OTHER], script: 'migration', keys: [], args: [], beginSql: tx }), { code: 'account_not_active' });
  assert.equal(executed, false);
});

test('late permit initialization cannot replace a sticky BLOCKED marker', async () => {
  const input = await fixture(); let initialization;
  const original = input.store.eval;
  input.store.eval = async function(script, keys, args) {
    if (script.startsWith('-- account-permit-init')) initialization = [script, keys, args];
    return original.call(this, script, keys, args);
  };
  await guardedUserMutation(input);
  await blockRedisIdentity(OWNER, input.store);
  assert.equal(await original.call(input.store, ...initialization), 0);
  assert.equal(await input.store.get(permit(OWNER)), 'BLOCKED');
});

test('wrapped existing award Lua retains memory behavior and blocks delayed awards', async () => {
  const input = await fixture();
  const { XP_ATOMIC_AWARD_SCRIPT } = await import('../netlify/functions/_shared/xp-ledger.mjs');
  const request = { store: input.store, userIds: [OWNER], beginSql: active, script: XP_ATOMIC_AWARD_SCRIPT,
    keys: ['session', 'sync', 'daily', 'total', 'lock'], args: ['1000', '12', '100', '100', '1000', '5000', '60000'] };
  const result = await guardedRedisEval(request);
  assert.equal(result[0], 12);
  assert.equal(await input.store.get('total'), '12');
  await blockRedisIdentity(OWNER, input.store);
  await assert.rejects(guardedRedisEval(request), { code: 'account_redis_fenced' });
  assert.equal(await input.store.get('total'), '12');
});

test('HTTP-200 Redis error replies cannot masquerade as successful fences or mutations', async () => {
  const { __remoteStoreForTests } = await import('../netlify/functions/_shared/store-upstash.mjs');
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'ERR account_redis_fenced' }), { status: 200 });
  try {
    await assert.rejects(__remoteStoreForTests.eval('script', [], []), { code: 'account_redis_fenced' });
    await assert.rejects(blockRedisIdentity(OWNER, __remoteStoreForTests), { code: 'account_redis_fenced' });
  } finally { globalThis.fetch = original; }
});

test('bounded removal deletes exact owner subset and member, preserves fences and reports opaque legacy blocker', async () => {
  const { cleanupRedisIdentity } = await import('../netlify/functions/_shared/store-upstash.mjs');
  const input = await fixture(); const namespace = 'cleanup:test';
  await blockRedisIdentity(OWNER, input.store);
  const ownerDaily = `${namespace}:daily:${OWNER}:2026-10-18`;
  const otherDaily = `${namespace}:daily:${OTHER}:2026-10-18`;
  const board = `${namespace}:leaderboard:v1:all_time`;
  const ownSession = `${namespace}:server-session:owned`;
  const otherSession = `${namespace}:server-session:other`;
  for (const [key, value] of [[ownerDaily, '10'], [otherDaily, '20'], [ownSession, JSON.stringify({ userId: OWNER })],
    [otherSession, JSON.stringify({ userId: OTHER })], [`${namespace}:session:opaque-legacy-hash`, '30'], ['kcswh:xp:user:' + OWNER, '{}']]) await input.store.set(key, value);
  await input.store.zadd(board, 10, OWNER); await input.store.zadd(board, 20, OTHER);
  let progress; let pages = 0;
  do {
    progress = await cleanupRedisIdentity({ store: input.store, userId: OWNER, namespace, limit: 1, cursor: progress?.cursor });
    assert.equal(progress.done, false);
    assert.ok(++pages < 20);
  } while (!progress.scanned);
  assert.ok(pages > 1);
  assert.equal(progress.reason, 'legacy_redis_ownership_unproven');
  assert.equal(await input.store.get(ownerDaily), null);
  assert.equal(await input.store.get(otherDaily), '20');
  assert.equal(await input.store.get(ownSession), null);
  assert.ok(await input.store.get(otherSession));
  assert.equal(await input.store.zscore(board, OWNER), null);
  assert.equal(await input.store.zscore(board, OTHER), 20);
  assert.equal(await input.store.get(`${namespace}:session:opaque-legacy-hash`), '30');
  assert.equal(await input.store.get(permit(OWNER)), 'BLOCKED');
  assert.equal(await input.store.get(EPOCH), 'epoch-one');
  await assert.rejects(cleanupRedisIdentity({ store: input.store, userId: OTHER, namespace }), { code: 'account_redis_fenced' });
});

test('real UUID anonymous identities can create sessions, award XP and touch, while Auth/deleted UUID guest spoofing denies', async () => {
  const input = await fixture();
  const anonymousTx = async (fn) => fn({ unsafe: async (sql) => sql.includes('as present') ? [{ present: false, deleting: false, retired: false }] : [] });
  const guest = { ...input, anonymous: true, beginSql: anonymousTx,
    value: JSON.stringify({ userId: OWNER, identityMode: 'anonymous' }) };
  await guardedUserMutation(guest);
  assert.ok(await input.store.get(input.key));
  assert.equal(await guardedUserMutation({ ...guest, operation: 'touch', value: 17 }), 1);
  const { executeAtomicXpAward } = await import('../netlify/functions/_shared/xp-ledger.mjs');
  const awarded = await executeAtomicXpAward({ store: input.store, userId: OWNER, anonymous: true, beginSql: anonymousTx,
    keys: ['guest-session', 'guest-sync', 'guest-daily', 'guest-total', 'guest-lock'], args: [1000, 12, 100, 100, 1000, 5000, 60000] });
  assert.equal(awarded.granted, 12);
  await assert.rejects(guardedUserMutation({ ...guest, beginSql: active }), { code: 'account_redis_fenced' });
  const retired = async (fn) => fn({ unsafe: async (sql) => sql.includes('as present') ? [{ present: false, deleting: true }] : [] });
  await assert.rejects(guardedUserMutation({ ...guest, beginSql: retired }), { code: 'account_redis_fenced' });
  const retiredWallet = async (fn) => fn({ unsafe: async (sql) => sql.includes('as present') ? [{ present: false, deleting: false, retired: true }] : [] });
  await assert.rejects(guardedUserMutation({ ...guest, beginSql: retiredWallet }), { code: 'account_redis_fenced' });
  await assert.rejects(guardedUserMutation({ ...guest, anonymous: false }), { code: 'account_not_active' });
});

test('UUID conversion source is explicitly anonymous and both source and target checks precede mutation', async () => {
  const input = await fixture(); let invoked = 0;
  const mixedTx = async (fn) => fn({ unsafe: async (sql, params) => {
    if (!sql.includes('as present')) return [];
    return [{ present: params[0] === OTHER, deleting: false, retired: false }];
  } });
  const original = input.store.eval;
  input.store.eval = async function(script, keys, args) {
    if (script === 'conversion-fixture') { invoked++; return [5]; }
    return original.call(this, script, keys, args);
  };
  await guardedRedisEval({ store: input.store, userIds: [OWNER, OTHER], anonymousIds: [OWNER], beginSql: mixedTx,
    script: 'conversion-fixture', keys: [], args: [] });
  assert.equal(invoked, 1);
  await assert.rejects(guardedRedisEval({ store: input.store, userIds: [OWNER, OTHER], anonymousIds: [OWNER], beginSql: active,
    script: 'conversion-fixture', keys: [], args: [] }), { code: 'account_redis_fenced' });
  assert.equal(invoked, 1);
});


test('UUID rate-limit increments are fenced too, including delayed calls after deletion',async()=>{
 const {atomicRateLimitIncr}=await import('../netlify/functions/_shared/store-upstash.mjs');
 const f=await fixture();const identity={userId:OWNER,beginSql:active,store:f.store};
 assert.equal((await atomicRateLimitIncr('owner-rate',60,identity)).count,1);
 assert.ok(await f.store.ttl('owner-rate')>0);
 await blockRedisIdentity(OWNER,f.store);await f.store.del('owner-rate');
 await assert.rejects(atomicRateLimitIncr('owner-rate',60,identity),{code:'account_redis_fenced'});
 assert.equal(await f.store.get('owner-rate'),null);
});
