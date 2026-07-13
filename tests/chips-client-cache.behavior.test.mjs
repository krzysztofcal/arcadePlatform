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

function createClient(fetchImpl){
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
  window.window = window;
  class CustomEvent {
    constructor(type, options){ this.type = type; this.detail = options && options.detail; }
  }
  vm.runInNewContext(source, { window, document: { dispatchEvent(event){ events.push(event); } }, CustomEvent, fetch: fetchImpl, Date, JSON, Number });
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

console.log('chips client cache behavior tests passed');
