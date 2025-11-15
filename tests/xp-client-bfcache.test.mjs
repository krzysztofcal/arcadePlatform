import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const xpClientSource = await readFile(path.join(__dirname, '..', 'js', 'xpClient.js'), 'utf8');

const store = new Map();
const localStorage = {
  getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    store.set(key, String(value));
  },
  removeItem(key) {
    store.delete(key);
  },
};

const requests = [];

function response(status, json) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return json; },
    async text() { return JSON.stringify(json); },
  };
}

let statusBootstraps = 0;

async function fetchStub(url, options = {}) {
  const body = options.body ? JSON.parse(options.body) : {};
  if (typeof url === 'string' && url.includes('xp-status')) {
    statusBootstraps += 1;
    return response(200, { ok: true, status: 'statusOnly', totalToday: 0, totalLifetime: 0, sessionTotal: 0, lastSync: 0, cap: 400, capDelta: 240, __serverHasDaily: true });
  }
  if (body.statusOnly) {
    statusBootstraps += 1;
    return response(200, { ok: true, status: 'statusOnly', totalToday: 0, totalLifetime: 0, sessionTotal: 0, lastSync: 0, cap: 400, capDelta: 240, __serverHasDaily: true });
  }
  requests.push(body);
  return response(200, { ok: true, awarded: body.delta, totalToday: body.delta, sessionTotal: body.delta, totalLifetime: body.delta, lastSync: body.ts, cap: 400, capDelta: 240 });
}

const windowStub = { localStorage };
const context = {
  window: windowStub,
  document: undefined,
  fetch: fetchStub,
  crypto: { randomUUID: () => 'uuid-test' },
  setTimeout,
  clearTimeout,
  console,
  Date,
};
windowStub.fetch = fetchStub;
windowStub.crypto = context.crypto;
windowStub.setTimeout = setTimeout;
windowStub.clearTimeout = clearTimeout;

vm.createContext(context);
vm.runInContext(xpClientSource, context, { filename: 'xpClient.js' });

const XPClient = context.window.XPClient;
assert(XPClient, 'XPClient missing');

let now = 1_700_000_000_000;
const originalNow = Date.now;
Date.now = () => now;

await XPClient.postWindow({ delta: 50, ts: now });
assert.equal(requests.length, 1);
const first = requests[0];
assert.equal(first.delta, 50);
assert.equal(first.ts, now);

now += 5_000;
await XPClient.postWindow({ delta: 50, ts: now - 4_000 });
assert.equal(requests.length, 2);
const second = requests[1];
assert(second.ts > first.ts, 'timestamp did not advance after BFCache-style resume');
assert.equal(context.window.XP_DELTA_CAP_CLIENT, 240);
assert(statusBootstraps >= 1);

Date.now = originalNow;

console.log('xp-client BFCache tests passed');
