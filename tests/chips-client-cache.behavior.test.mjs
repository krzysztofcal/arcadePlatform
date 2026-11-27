import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/chips/client.js', import.meta.url), 'utf8');

function response(balance){
  return { status: 200, ok: true, async json(){ return { balance }; } };
}

function jsonResponse(body){
  return { status: 200, ok: true, async json(){ return body; } };
}

function createClient(fetchImpl, options){
  const published = [];
  const events = [];
  let context = { userId: 'chips-user', generation: 1 };
  let token = 'token-a';
  const window = {
    SupabaseAuthBridge: { getAccessToken: async () => token },
    UserUiState: {
      getActiveContext(){ return context; },
      isCurrent(userId, generation){ return context.userId === userId && context.generation === generation; },
      publish(userId, slice, value){ published.push({ userId, slice, value }); return value; },
    },
    KLog: { log(){} },
  };
  if (options && options.profileClient) window.ProfileClient = options.profileClient;
  window.window = window;
  class CustomEvent {
    constructor(type, options){ this.type = type; this.detail = options && options.detail; }
  }
  vm.runInNewContext(source, { window, document: { dispatchEvent(event){ events.push(event); } }, CustomEvent, fetch: fetchImpl, Date, JSON, Number, atob });
  return { client: window.ChipsClient, events, published, setContext(value){ context = value; }, setToken(value){ token = value; } };
}

{
  const authorization = [];
  const state = createClient(async (_url, options) => {
    authorization.push(options.headers.Authorization);
    return response(authorization.length === 1 ? 896 : 950);
  });
  await state.client.fetchBalance();
  state.setToken('token-b');
  state.setContext({ userId: 'chips-user-b', generation: 2 });
  state.client.clearAuthCache();
  await state.client.fetchBalance();
  assert.deepEqual(authorization, ['Bearer token-a', 'Bearer token-b']);
}

{
  const state = createClient(async () => response(896));
  const result = await state.client.fetchBalance();
  assert.equal(result.balance, 896);
  assert.equal(JSON.stringify(state.published), JSON.stringify([{ userId: 'chips-user', slice: 'chips', value: { balance: 896 } }]));
}

{
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const state = createClient(async () => { await gate; return response(900); });
  const pending = state.client.fetchBalance();
  await Promise.resolve();
  state.setContext({ userId: 'other-user', generation: 2 });
  release();
  const result = await pending;
  assert.equal(result, null);
  assert.equal(state.published.length, 0);
  assert.equal(state.events.filter((event) => event.type === 'chips:balance').length, 0);
}

{
  const requests = [];
  let claimed = false;
  const state = createClient(async (url, options) => {
    requests.push({ url, method: options.method });
    assert.equal(url, '/.netlify/functions/bonus-campaigns');
    if (options.method === 'POST'){
      claimed = true;
      assert.equal(JSON.parse(options.body).code, 'welcome-2026');
      return jsonResponse({ claimed: true, code: 'welcome-2026', amount: 500 });
    }
    return jsonResponse({
      items: claimed ? [] : [
        { code: 'daily-2026', campaignType: 'daily', amount: 20, eligible: true, alreadyClaimed: false },
        { code: 'welcome-2026', campaignType: 'welcome', amount: 500, eligible: true, alreadyClaimed: false },
      ],
    });
  });

  const before = await state.client.fetchWelcomeBonusStatus();
  assert.equal(before.code, 'welcome-2026');
  assert.equal(before.amount, 500);
  const result = await state.client.claimWelcomeBonus();
  assert.equal(result.claimed, true);
  const after = await state.client.fetchWelcomeBonusStatus();
  assert.equal(after.eligible, false);
  assert.equal(after.code, null);
  assert.ok(requests.every((request) => request.url !== '/.netlify/functions/welcome-bonus'));
  assert.equal(state.events.filter((event) => event.type === 'chips:tx-complete').length, 1);
}

{
  let requests = 0;
  const state = createClient(async () => { requests += 1; throw new Error('unexpected_fetch'); });
  const campaigns = { items: [{ code: 'welcome-2026', campaignType: 'welcome', amount: 500, eligible: true }], dailyBonus: { streakDay: 3 } };
  const welcome = await state.client.fetchWelcomeBonusStatus(campaigns);
  assert.equal(welcome.code, 'welcome-2026');
  assert.equal(welcome.amount, 500);
  assert.equal(requests, 0, 'a shared campaigns payload must not cause another GET');
}

{
  let getMeCalledWith = null;
  const mockProfileClient = {
    getMe: async (force, options) => {
      getMeCalledWith = { force, options };
      return { balance: 1500, poker: { inPoker: true, tables: [{ id: 't-1', stack: 200 }] } };
    },
  };
  const state = createClient(async () => { throw new Error('unexpected_fetch'); }, { profileClient: mockProfileClient });
  const snapshot = await state.client.fetchTopbarSnapshot();
  assert.equal(getMeCalledWith.force, false);
  assert.equal(getMeCalledWith.options.includePoker, true);
  assert.equal(snapshot.balance, 1500);
  assert.deepEqual(snapshot.poker, { inPoker: true, tables: [{ id: 't-1', stack: 200 }] });
  assert.equal(JSON.stringify(state.published), JSON.stringify([{ userId: 'chips-user', slice: 'chips', value: { balance: 1500 } }]));
  const balanceEvents = state.events.filter((e) => e.type === 'chips:balance');
  assert.equal(balanceEvents.length, 1);
  assert.equal(balanceEvents[0].detail.balance, 1500);
}

{
  const mockProfileClient = {
    getMe: async () => ({ balance: -50, poker: null }),
  };
  const state = createClient(async () => { throw new Error('unexpected_fetch'); }, { profileClient: mockProfileClient });
  const snapshot = await state.client.fetchTopbarSnapshot();
  assert.equal(snapshot.balance, null);
  assert.equal(snapshot.poker, null);
  assert.equal(state.published.length, 0);
  assert.equal(state.events.filter((e) => e.type === 'chips:balance').length, 0);
}

{
  let pokerFetches = 0;
  let releasePoker;
  const holdPoker = new Promise((resolve) => { releasePoker = resolve; });
  const state = createClient(async (url) => {
    if (url.includes('profile-me?includePoker=1')) {
      pokerFetches++;
      await holdPoker;
      return jsonResponse({ poker: { inPoker: false } });
    }
    throw new Error('unexpected_fetch');
  });

  const p1 = state.client.fetchPokerProjection();
  const p2 = state.client.fetchPokerProjection();
  await new Promise((r) => setImmediate(r));
  assert.equal(pokerFetches, 1, 'in-flight poker requests for the same user must be shared');
  releasePoker();
  const [res1, res2] = await Promise.all([p1, p2]);
  assert.deepEqual(res1, { inPoker: false });
  assert.deepEqual(res2, { inPoker: false });

  const p3 = state.client.fetchPokerProjection();
  state.client.clearAuthCache();
}

{
  // without ProfileClient, fetchTopbarSnapshot returns null (topbar uses separate paths)
  const state = createClient(async () => { throw new Error('unexpected_fetch'); });
  const snapshot = await state.client.fetchTopbarSnapshot();
  assert.equal(snapshot, null);
}

{
  // F1: account switch during getMe -> null, no publish, no emit
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const mockProfileClient = {
    getMe: async () => {
      await hold;
      return { balance: 1500, poker: { inPoker: false } };
    },
  };
  const state = createClient(async () => { throw new Error('unexpected_fetch'); }, { profileClient: mockProfileClient });
  const pending = state.client.fetchTopbarSnapshot();
  await Promise.resolve();
  state.setContext({ userId: 'switched-user', generation: 2 });
  release();
  const snapshot = await pending;
  assert.equal(snapshot, null);
  assert.equal(state.published.length, 0);
  assert.equal(state.events.filter((e) => e.type === 'chips:balance').length, 0);
}

{
  // F4: fetchBalance with balance -1 -> emits chips:balance, no publish
  const state = createClient(async () => response(-1));
  const result = await state.client.fetchBalance();
  assert.equal(result.balance, -1);
  assert.equal(state.published.length, 0, 'chips slice must not publish an invalid balance');
  const balanceEvents = state.events.filter((e) => e.type === 'chips:balance');
  assert.equal(balanceEvents.length, 1, 'chips:balance must still emit for caller compatibility');
  assert.equal(balanceEvents[0].detail.balance, -1);
}

{
  // no ProfileClient; two overlapping fetchPokerProjection calls while the session resolves -> exactly one raw GET
  let resolveToken;
  let pokerGets = 0;
  const tokenPromise = new Promise((resolve) => { resolveToken = resolve; });
  const state = createClient(async (url) => {
    if (url.includes('profile-me?includePoker=1')) {
      pokerGets++;
      return jsonResponse({ poker: { inPoker: false } });
    }
    throw new Error('unexpected_fetch');
  });
  state.setToken(tokenPromise);
  state.setContext(null);

  const call1 = state.client.fetchPokerProjection();
  state.setContext({ userId: 'signed-in-user', generation: 1 });
  const call2 = state.client.fetchPokerProjection();

  resolveToken('token-late-session');
  const [res1, res2] = await Promise.all([call1, call2]);
  assert.equal(pokerGets, 1, 'two overlapping fetchPokerProjection calls while session resolves must send exactly one GET');
  assert.deepEqual(res1, { inPoker: false });
  assert.deepEqual(res2, { inPoker: false });
}

function makeJwt(sub){
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `${header}.${payload}.sig`;
}

{
  // (a) generation changes during the token wait, the new token's sub equals the expected user → one HTTP request succeeds
  let releaseTokenA;
  const tokenAPromise = new Promise((resolve) => { releaseTokenA = resolve; });
  let fetchCallsA = 0;
  const authHeadersA = [];
  const stateA = createClient(async (_url, options) => {
    fetchCallsA++;
    authHeadersA.push(options.headers.Authorization);
    return response(777);
  });
  stateA.setContext({ userId: 'chips-user', generation: 1 });
  stateA.setToken(tokenAPromise);

  const pendingA = stateA.client.fetchBalance();
  await Promise.resolve();

  stateA.client.clearAuthCache();
  const validToken = makeJwt('chips-user');
  stateA.setToken(validToken);
  releaseTokenA('token-stale');

  const resultA = await pendingA;
  assert.equal(fetchCallsA, 1, 'superseded token promise must still result in exactly one HTTP request');
  assert.deepEqual(authHeadersA, ['Bearer ' + validToken], 'second fetchAuthToken must provide the fresh generation token');
  assert.equal(resultA.balance, 777);

  // (b) the new token's sub is a different user → not_authenticated and zero HTTP requests
  let releaseTokenB;
  const tokenBPromise = new Promise((resolve) => { releaseTokenB = resolve; });
  let fetchCallsB = 0;
  const stateB = createClient(async () => {
    fetchCallsB++;
    return response(888);
  });
  stateB.setContext({ userId: 'chips-user-b', generation: 1 });
  stateB.setToken(tokenBPromise);

  const pendingB = stateB.client.fetchBalance();
  await Promise.resolve();

  stateB.client.clearAuthCache();
  stateB.setToken(makeJwt('different-user'));
  releaseTokenB('token-stale');

  await assert.rejects(async () => { await pendingB; }, (err) => err.code === 'not_authenticated');
  assert.equal(fetchCallsB, 0, 'mismatched sub must not issue any HTTP request');

  // (c) no active UI context → not_authenticated, zero requests
  let releaseTokenC;
  const tokenCPromise = new Promise((resolve) => { releaseTokenC = resolve; });
  let fetchCallsC = 0;
  const stateC = createClient(async () => {
    fetchCallsC++;
    return response(999);
  });
  stateC.setContext(null);
  stateC.setToken(tokenCPromise);

  const pendingC = stateC.client.fetchBalance();
  await Promise.resolve();

  stateC.client.clearAuthCache();
  stateC.setToken(makeJwt('chips-user'));
  releaseTokenC('token-stale');

  await assert.rejects(async () => { await pendingC; }, (err) => err.code === 'not_authenticated');
  assert.equal(fetchCallsC, 0, 'missing active context must not issue any HTTP request');

  // Unchanged generation + null token -> still not_authenticated
  stateA.client.clearAuthCache();
  stateA.setToken(null);
  let notAuthError = null;
  try {
    await stateA.client.fetchBalance();
  } catch (err) {
    notAuthError = err;
  }
  assert.ok(notAuthError, 'null token must throw');
  assert.equal(notAuthError.code, 'not_authenticated');
  assert.equal(fetchCallsA, 1, 'failed auth must not make an extra HTTP request');
}

console.log('chips client cache behavior tests passed');
