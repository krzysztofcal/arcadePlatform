import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/user-ui-state.js', import.meta.url), 'utf8');

function createContext(initial = {}){
  const values = new Map(Object.entries(initial));
  const topbar = { state: 'pending', setAttribute(name, value){ if (name === 'data-user-ui-state') this.state = value; } };
  const listeners = {};
  const window = {
    localStorage: {
      getItem(key){ return values.has(key) ? values.get(key) : null; },
      setItem(key, value){ values.set(key, String(value)); },
      removeItem(key){ values.delete(key); },
    },
    addEventListener(type, listener){ listeners[type] = listener; },
    KLog: { log(){} },
  };
  const document = { querySelectorAll(){ return [topbar]; }, dispatchEvent(){} };
  window.window = window;
  vm.runInNewContext(source, { window, document, CustomEvent: class {}, Date, JSON });
  return { api: window.UserUiState, values, topbar, listeners };
}

const profileRecord = (userId, displayName, confirmedAt = Date.now()) => JSON.stringify({
  version: 1,
  userId,
  confirmedAt,
  value: { displayName, avatar: { type: 'uploaded', variant: 'fox-blue', url: 'https://stage-test.supabase.co/avatar.webp' } },
});

{
  const state = createContext({
    'kcswh:user-ui:profile:v1:user-a': profileRecord('user-a', 'User A'),
    'kcswh:user-ui:profile:v1:user-b': profileRecord('user-b', 'User B'),
  });
  const hydrated = state.api.hydrate('user-a');
  const repeated = state.api.hydrate('user-a');
  assert.equal(hydrated.profile.displayName, 'User A');
  assert.equal(repeated.generation, hydrated.generation);
  assert.equal(state.topbar.state, 'hydrated');
  assert.equal(state.api.isCurrent('user-a', hydrated.generation), true);
  assert.equal(state.api.publish('user-b', 'profile', { displayName: 'Wrong', avatar: {} }), null);
}

{
  const cacheKey = 'kcswh:user-ui:profile:v1:user-a';
  const state = createContext({ [cacheKey]: profileRecord('user-b', 'Wrong identity') });
  const hydrated = state.api.hydrate('user-a');
  assert.equal(hydrated.profile, null);
  assert.equal(state.values.has(cacheKey), false);
  assert.equal(state.topbar.state, 'loading');
}

{
  const state = createContext();
  const hydrated = state.api.hydrate('user-a');
  const value = state.api.publish('user-a', 'profile', { displayName: 'Confirmed User', avatar: { type: 'default', variant: 'orbit-green' } }, Date.now());
  assert.equal(value.displayName, 'Confirmed User');
  assert.equal(state.topbar.state, 'ready');
  assert.equal(state.values.has('kcswh:user-ui:profile:v1:user-a'), true);
  state.api.clearUser('user-a');
  assert.equal(state.values.has('kcswh:user-ui:profile:v1:user-a'), false);
  assert.equal(state.api.isCurrent('user-a', hydrated.generation), false);
  state.api.setAnonymous();
  assert.equal(state.topbar.state, 'anonymous');
}

console.log('user UI state behavior tests passed');
