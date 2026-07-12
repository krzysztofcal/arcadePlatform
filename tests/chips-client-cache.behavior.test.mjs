import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/chips/client.js', import.meta.url), 'utf8');

function response(balance){
  return { status: 200, ok: true, async json(){ return { balance }; } };
}

function createClient(fetchImpl){
  const published = [];
  let context = { userId: 'chips-user', generation: 1 };
  const window = {
    SupabaseAuthBridge: { getAccessToken: async () => 'token' },
    UserUiState: {
      getActiveContext(){ return context; },
      isCurrent(userId, generation){ return context.userId === userId && context.generation === generation; },
      publish(userId, slice, value){ published.push({ userId, slice, value }); return value; },
    },
    KLog: { log(){} },
  };
  window.window = window;
  vm.runInNewContext(source, { window, document: { dispatchEvent(){} }, CustomEvent: class {}, fetch: fetchImpl, Date, JSON, Number });
  return { client: window.ChipsClient, published, setContext(value){ context = value; } };
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
  await pending;
  assert.equal(state.published.length, 0);
}

console.log('chips client cache behavior tests passed');
