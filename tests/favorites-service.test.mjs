import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const favoritesSource = await readFile(
  path.join(__dirname, '..', 'js', 'core', 'FavoritesService.js'),
  'utf8'
);

function createStorageMock() {
  const store = new Map();
  return {
    __store: store,
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    }
  };
}

function createTestContext(options = {}) {
  const localStorageMock = createStorageMock();
  const context = {
    window: {},
    console,
    Promise,
    JSON,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    localStorage: localStorageMock
  };

  context.window.window = context.window;
  context.window.localStorage = localStorageMock;
  context.bridgeCalls = 0;
  context.supabaseAuthCalls = 0;

  if (Object.prototype.hasOwnProperty.call(options, 'bridgeToken')) {
    context.window.SupabaseAuthBridge = {
      getAccessToken() {
        context.bridgeCalls += 1;
        return Promise.resolve(options.bridgeToken);
      }
    };
  }

  if (Object.prototype.hasOwnProperty.call(options, 'supabaseAuthToken')) {
    context.window.SupabaseAuth = {
      getAccessToken() {
        context.supabaseAuthCalls += 1;
        return Promise.resolve(options.supabaseAuthToken);
      }
    };
  }

  vm.createContext(context);
  new vm.Script(favoritesSource, { filename: 'FavoritesService.js' }).runInContext(context);
  return context;
}

console.log('Running FavoritesService auth bridge tests...\n');

{
  console.log('Test: uses SupabaseAuthBridge when available');
  const ctx = createTestContext({ bridgeToken: 'bridge-token' });
  const service = new ctx.window.FavoritesService();
  const token = await service.getAccessToken();
  assert.equal(token, 'bridge-token');
  assert.equal(ctx.bridgeCalls, 1);
  assert.equal(ctx.supabaseAuthCalls, 0);
  console.log('  PASS');
}

{
  console.log('Test: falls back to SupabaseAuth when bridge has no token');
  const ctx = createTestContext({ bridgeToken: null, supabaseAuthToken: 'legacy-token' });
  const service = new ctx.window.FavoritesService();
  const token = await service.getAccessToken();
  assert.equal(token, 'legacy-token');
  assert.equal(ctx.bridgeCalls, 1);
  assert.equal(ctx.supabaseAuthCalls, 1);
  console.log('  PASS');
}

{
  console.log('Test: returns null when no auth providers are available');
  const ctx = createTestContext({});
  const service = new ctx.window.FavoritesService();
  const token = await service.getAccessToken();
  assert.equal(token, null);
  assert.equal(ctx.bridgeCalls, 0);
  assert.equal(ctx.supabaseAuthCalls, 0);
  console.log('  PASS');
}

console.log('\nAll FavoritesService auth bridge tests completed.');
