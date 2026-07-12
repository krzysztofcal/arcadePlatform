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
let sessionStarts = 0;

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
  // Handle start-session endpoint
  if (url === '/.netlify/functions/start-session') {
    sessionStarts += 1;
    return response(200, {
      ok: true,
      sessionId: 'test-session-id',
      sessionToken: 'test-session-token',
      expiresIn: 604800,
      createdAt: Date.now(),
    });
  }

  const body = options.body ? JSON.parse(options.body) : {};
  if (body.operation === "status") {
    statusBootstraps += 1;
    return response(200, { ok: true, status: 'statusOnly', totalToday: 0, totalLifetime: 0, sessionTotal: 0, lastSync: 0, cap: 400, capDelta: 240 });
  }
  requests.push(body);
  return response(200, { ok: true, awarded: 10, totalToday: 10, sessionTotal: 10, totalLifetime: 10, lastSync: body.windowEnd, cap: 400, capDelta: 240 });
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

await XPClient.postWindowServerCalc({ gameId: 'pacman', scoreDelta: 50, windowStart: now - 1000, windowEnd: now, inputEvents: 3, visibilitySeconds: 1 });
assert.equal(requests.length, 1);
const first = requests[0];
assert.equal(first.scoreDelta, 50);
assert.equal(first.windowEnd, now);

now += 5_000;
await XPClient.postWindowServerCalc({ gameId: 'pacman', scoreDelta: 50, windowStart: now - 1000, windowEnd: now, inputEvents: 3, visibilitySeconds: 1 });
assert.equal(requests.length, 2);
const second = requests[1];
assert(second.windowEnd > first.windowEnd, 'window timestamp did not advance after BFCache-style resume');
assert.equal(context.window.XP_DELTA_CAP_CLIENT, 240);
assert(statusBootstraps >= 1);

Date.now = originalNow;

console.log('xp-client BFCache tests passed');
