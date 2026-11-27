import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/user-ui-state.js', import.meta.url), 'utf8');

function createContext(initial = {}, options = {}){
  const values = options.values || new Map(Object.entries(initial));
  const topbar = { state: 'pending', attributes: {}, setAttribute(name, value){ this.attributes[name] = value; if (name === 'data-user-ui-state') this.state = value; } };
  const listeners = {};
  const window = {
    localStorage: {
      get length(){ return values.size; },
      key(i){ return Array.from(values.keys())[i] || null; },
      getItem(key){ return values.has(key) ? values.get(key) : null; },
      setItem(key, value){ values.set(key, String(value)); },
      removeItem(key){ values.delete(key); },
    },
    addEventListener(type, listener){ listeners[type] = listener; },
    KLog: { log(){} },
    atob: (v) => Buffer.from(v, 'base64').toString('binary'),
    btoa: (v) => Buffer.from(v, 'binary').toString('base64'),
  };
  if (options.BroadcastChannel) window.BroadcastChannel = options.BroadcastChannel;
  const document = { querySelectorAll(){ return [topbar]; }, dispatchEvent(){} };
  window.window = window;
  vm.runInNewContext(source, {
    window,
    document,
    CustomEvent: class {},
    Date,
    JSON,
    atob: window.atob,
    btoa: window.btoa,
    Buffer,
  });
  return { api: window.UserUiState, values, topbar, listeners, window };
}

function createChannelHub(){
  const channels = [];
  class BroadcastChannel {
    constructor(){ this.listener = null; channels.push(this); }
    addEventListener(type, listener){ if (type === 'message') this.listener = listener; }
    postMessage(data){ channels.forEach((channel) => { if (channel !== this && channel.listener) channel.listener({ data }); }); }
  }
  return {
    BroadcastChannel,
    deliver(index, data){ if (channels[index] && channels[index].listener) channels[index].listener({ data }); },
  };
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
  assert.equal(hydrated.profile.avatar.url, undefined);
  assert.ok(!state.values.get('kcswh:user-ui:profile:v1:user-a').includes('https://'));
  assert.equal(repeated.generation, hydrated.generation);
  assert.equal(state.topbar.state, 'loading');
  assert.equal(state.topbar.attributes['data-user-ui-xp-state'], 'loading');
  state.api.markSliceApplied('user-a', 'profile', 'hydrated');
  assert.equal(state.topbar.state, 'hydrated');
  assert.equal(state.topbar.attributes['data-user-ui-xp-state'], 'loading');
  assert.equal(state.api.isCurrent('user-a', hydrated.generation), true);
  assert.equal(JSON.stringify(state.api.getActiveContext()), JSON.stringify({ userId: 'user-a', generation: hydrated.generation }));
  assert.equal(state.api.publish('user-b', 'profile', { displayName: 'Wrong', avatar: {} }), null);
}

{
  const values = new Map();
  const hub = createChannelHub();
  const first = createContext({}, { values, BroadcastChannel: hub.BroadcastChannel });
  const second = createContext({}, { values, BroadcastChannel: hub.BroadcastChannel });
  const received = [];
  first.api.hydrate('shared-user');
  second.api.hydrate('shared-user');
  second.api.onChange((event) => received.push(event));
  const confirmedAt = Date.now();
  first.api.publish('shared-user', 'profile', { displayName: 'Shared Avatar', avatar: { type: 'uploaded', variant: 'fox-blue', url: 'https://stage-test.supabase.co/new-avatar.webp' } }, confirmedAt);
  assert.equal(received.length, 1);
  assert.equal(received[0].value.avatar.type, 'uploaded');
  assert.equal(received[0].value.avatar.url, undefined);
  assert.ok(!values.get('kcswh:user-ui:profile:v1:shared-user').includes('https://'));
  assert.equal(second.topbar.state, 'ready');
  hub.deliver(1, received[0]);
  assert.equal(received.length, 1);
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
  assert.equal(state.api.markActiveSliceApplied('chips', 'ready'), true);
  assert.equal(state.topbar.attributes['data-user-ui-chips-state'], 'ready');
  state.api.clearUser('user-a');
  assert.equal(state.values.has('kcswh:user-ui:profile:v1:user-a'), false);
  assert.equal(state.api.isCurrent('user-a', hydrated.generation), false);
  state.api.setAnonymous();
  assert.equal(state.topbar.state, 'anonymous');
}

{
  const validPath = 'pending/00000000-0000-4000-8000-000000000001';
  function makeWebpDataUrl(byteLength = 12){
    const header = Buffer.from('RIFF\x00\x00\x00\x00WEBP');
    const full = Buffer.concat([header, Buffer.alloc(Math.max(0, byteLength - 12))]);
    return 'data:image/webp;base64,' + full.toString('base64');
  }

  const validDataUrl = makeWebpDataUrl(64);
  const state = createContext();

  // 1. writePhoto and readPhoto accept valid path and WebP dataUrl
  assert.equal(state.api.writePhoto('user-photo-1', { path: validPath, dataUrl: validDataUrl }), true);
  const readSuccess = state.api.readPhoto('user-photo-1');
  assert.equal(readSuccess.available, true);
  assert.equal(readSuccess.record.userId, 'user-photo-1');
  assert.equal(readSuccess.record.path, validPath);
  assert.equal(readSuccess.record.dataUrl, validDataUrl);
  assert.ok(readSuccess.record.savedAt > 0);

  // 1b. Image bytes whose Base64 happens to contain "http" are still a valid photo
  const httpBytes = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('http'), Buffer.alloc(8)]);
  const httpDataUrl = 'data:image/webp;base64,' + httpBytes.toString('base64');
  assert.ok(httpDataUrl.slice(23).includes('aHR0cA'));
  assert.equal(state.api.writePhoto('user-photo-http', { path: validPath, dataUrl: httpDataUrl }), true);

  // 2. Reject path not matching ^pending/[0-9a-f-]{36}$
  assert.equal(state.api.writePhoto('user-photo-1', { path: 'pending/too-short', dataUrl: validDataUrl }), false);
  assert.equal(state.api.writePhoto('user-photo-1', { path: validPath + '?token=xyz', dataUrl: validDataUrl }), false);
  assert.equal(state.api.writePhoto('user-photo-1', { path: 'other/' + '0'.repeat(36), dataUrl: validDataUrl }), false);

  // 3. Boundary test: 65,536 Base64 characters (48 KiB = 49,152 bytes) accepted, 65,540 rejected
  const boundary48KiBDataUrl = makeWebpDataUrl(49152);
  const b64Part = boundary48KiBDataUrl.slice('data:image/webp;base64,'.length);
  assert.equal(b64Part.length, 65536, 'boundary is exactly 65536 base64 chars');
  assert.equal(state.api.writePhoto('user-boundary', { path: validPath, dataUrl: boundary48KiBDataUrl }), true);
  assert.equal(state.api.readPhoto('user-boundary').available, true);

  const overBoundaryDataUrl = makeWebpDataUrl(49152 + 3); // 65,540 base64 chars
  const overB64Part = overBoundaryDataUrl.slice('data:image/webp;base64,'.length);
  assert.equal(overB64Part.length, 65540);
  assert.equal(state.api.writePhoto('user-boundary-over', { path: validPath, dataUrl: overBoundaryDataUrl }), false);

  // 4. Valid header followed by invalid tail (e.g. one extra character) is rejected
  const invalidTailDataUrl = validDataUrl + 'A';
  assert.equal(state.api.writePhoto('user-photo-1', { path: validPath, dataUrl: invalidTailDataUrl }), false);

  // 5. Value with appended URL, token= or ? is rejected
  assert.equal(state.api.writePhoto('user-photo-1', { path: validPath, dataUrl: validDataUrl + '?token=abc' }), false);
  assert.equal(state.api.writePhoto('user-photo-1', { path: validPath, dataUrl: validDataUrl + 'https://example.com' }), false);
  assert.equal(state.api.writePhoto('user-photo-1', { path: validPath, dataUrl: validDataUrl + 'token=secret' }), false);

  // 6. Invalid Base64 characters, non-WebP header (e.g. GIF or PNG) rejected
  assert.equal(state.api.writePhoto('user-photo-1', { path: validPath, dataUrl: 'data:image/webp;base64,!!!invalid!!!' }), false);
  const gifDataUrl = 'data:image/webp;base64,' + Buffer.from('GIF89a\x00\x00\x00\x00\x00\x00').toString('base64');
  assert.equal(state.api.writePhoto('user-photo-1', { path: validPath, dataUrl: gifDataUrl }), false);

  // 7. Another user record in the slot is rejected on read
  state.values.set('kcswh:user-ui:photo:v1:user-a', JSON.stringify({
    version: 1,
    userId: 'user-b',
    savedAt: Date.now(),
    path: validPath,
    dataUrl: validDataUrl,
  }));
  const wrongUserRead = state.api.readPhoto('user-a');
  assert.equal(wrongUserRead.available, true);
  assert.equal(wrongUserRead.record, null);
  assert.equal(state.values.has('kcswh:user-ui:photo:v1:user-a'), false, 'invalid record is removed from storage');

  // 8. Record older than 7 days is rejected and removed
  const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
  state.values.set('kcswh:user-ui:photo:v1:user-old', JSON.stringify({
    version: 1,
    userId: 'user-old',
    savedAt: eightDaysAgo,
    path: validPath,
    dataUrl: validDataUrl,
  }));
  const oldRead = state.api.readPhoto('user-old');
  assert.equal(oldRead.available, true);
  assert.equal(oldRead.record, null);
  assert.equal(state.values.has('kcswh:user-ui:photo:v1:user-old'), false, 'expired record is removed from storage');

  // 9. Storage unavailable reporting
  const unavailableStore = createContext();
  unavailableStore.window.localStorage.getItem = () => { throw new Error('storage blocked'); };
  const unavailResult = unavailableStore.api.readPhoto('user-photo-1');
  assert.equal(unavailResult.available, false);
  assert.equal(unavailResult.record, undefined);

  // 10. clearUser removes user photo record
  state.api.writePhoto('user-clear', { path: validPath, dataUrl: validDataUrl });
  assert.equal(state.values.has('kcswh:user-ui:photo:v1:user-clear'), true);
  state.api.clearUser('user-clear');
  assert.equal(state.values.has('kcswh:user-ui:photo:v1:user-clear'), false);

  // 11. setAnonymous removes all photo records
  state.api.writePhoto('user-anon-1', { path: validPath, dataUrl: validDataUrl });
  state.api.writePhoto('user-anon-2', { path: validPath, dataUrl: validDataUrl });
  assert.equal(state.values.has('kcswh:user-ui:photo:v1:user-anon-1'), true);
  assert.equal(state.values.has('kcswh:user-ui:photo:v1:user-anon-2'), true);
  state.api.setAnonymous();
  assert.equal(state.values.has('kcswh:user-ui:photo:v1:user-anon-1'), false);
  assert.equal(state.values.has('kcswh:user-ui:photo:v1:user-anon-2'), false);
}

console.log('user UI state behavior tests passed');
