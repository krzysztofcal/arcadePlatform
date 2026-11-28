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

function fakeJwt(sub){
  const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `h.${payload}.s`;
}

function createClient(fetchImpl, options){
  const published = [];
  const events = [];
  let context = { userId: 'chips-user', generation: 1 };
  let token = fakeJwt('chips-user');
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
  state.setToken(fakeJwt('chips-user-b'));
  state.setContext({ userId: 'chips-user-b', generation: 2 });
  state.client.clearAuthCache();
  await state.client.fetchBalance();
  assert.deepEqual(authorization, ['Bearer ' + fakeJwt('chips-user'), 'Bearer ' + fakeJwt('chips-user-b')]);
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

  resolveToken(fakeJwt('signed-in-user'));
  const [res1, res2] = await Promise.all([call1, call2]);
  assert.equal(pokerGets, 1, 'two overlapping fetchPokerProjection calls while session resolves must send exactly one GET');
  assert.deepEqual(res1, { inPoker: false });
  assert.deepEqual(res2, { inPoker: false });
}

{
  // (a) generation changes during the token wait, the new token belongs to the same user -> one request succeeds
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
  const validToken = fakeJwt('chips-user');
  stateA.setToken(validToken);
  releaseTokenA('token-stale');

  const resultA = await pendingA;
  assert.equal(fetchCallsA, 1, 'superseded token promise must still result in exactly one HTTP request');
  assert.deepEqual(authHeadersA, ['Bearer ' + validToken], 'second fetchAuthToken must provide the fresh generation token');
  assert.equal(resultA.balance, 777);

  // (b) the token belongs to another user -> not_authenticated, zero requests (covers first attempt and 401 retry)
  // First attempt:
  let fetchCallsB1 = 0;
  const stateB1 = createClient(async () => {
    fetchCallsB1++;
    return response(888);
  });
  stateB1.setContext({ userId: 'chips-user', generation: 1 });
  stateB1.setToken(fakeJwt('other-user'));

  await assert.rejects(async () => {
    await stateB1.client.fetchBalance();
  }, (err) => err && err.code === 'not_authenticated');
  assert.equal(fetchCallsB1, 0, 'token for other user must throw not_authenticated with zero requests');

  // 401 retry:
  let fetchCallsB2 = 0;
  const stateB2 = createClient(async () => {
    fetchCallsB2++;
    stateB2.setToken(fakeJwt('other-user-on-retry'));
    return { status: 401, ok: false, async json(){ return { error: 'unauthorized' }; } };
  });
  stateB2.setContext({ userId: 'chips-user', generation: 1 });
  stateB2.setToken(fakeJwt('chips-user'));

  await assert.rejects(async () => {
    await stateB2.client.fetchBalance();
  }, (err) => err && err.code === 'not_authenticated');
  assert.equal(fetchCallsB2, 1, '401 retry with token belonging to another user must abort without second fetch');

  // (c) no UI context -> request sent as on main
  let fetchCallsC = 0;
  const authHeadersC = [];
  const stateC = createClient(async (_url, options) => {
    fetchCallsC++;
    authHeadersC.push(options.headers.Authorization);
    return response(555);
  });
  stateC.setContext(null);
  stateC.setToken('raw-arbitrary-token');

  const resultC = await stateC.client.fetchBalance();
  assert.equal(fetchCallsC, 1, 'request must be sent when there is no UI context');
  assert.deepEqual(authHeadersC, ['Bearer raw-arbitrary-token']);
  assert.equal(resultC.balance, 555);
}

console.log('chips client cache behavior tests passed');
