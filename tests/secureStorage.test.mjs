/**
 * SecureStorage.js Test Suite
 * Tests AES-GCM encrypted localStorage/sessionStorage wrapper
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the SecureStorage source
const secureStorageSource = await readFile(
  path.join(__dirname, '..', 'js', 'core', 'SecureStorage.js'),
  'utf8'
);

// Create localStorage mock
function createLocalStorageMock() {
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
    },
    key(index) {
      const keys = Array.from(store.keys());
      return index < keys.length ? keys[index] : null;
    },
    get length() {
      return store.size;
    },
  };
}

// Create sessionStorage mock (same interface as localStorage)
function createSessionStorageMock() {
  return createLocalStorageMock();
}

// Create a fresh VM context for each test
function createTestContext() {
  const localStorageMock = createLocalStorageMock();
  const sessionStorageMock = createSessionStorageMock();

  const context = {
    window: {
      localStorage: localStorageMock,
      sessionStorage: sessionStorageMock,
    },
    localStorage: localStorageMock,
    sessionStorage: sessionStorageMock,
    crypto: webcrypto,
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    atob: (str) => Buffer.from(str, 'base64').toString('binary'),
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    console,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    Promise: globalThis.Promise,
    JSON: globalThis.JSON,
    Object: globalThis.Object,
    Array: globalThis.Array,
    String: globalThis.String,
    Number: globalThis.Number,
    Math: globalThis.Math,
    Date: globalThis.Date,
    Error: globalThis.Error,
    Uint8Array: globalThis.Uint8Array,
    ArrayBuffer: globalThis.ArrayBuffer,
  };

  // Make window reference itself
  context.window.window = context.window;

  vm.createContext(context);
  new vm.Script(secureStorageSource, { filename: 'SecureStorage.js' }).runInContext(context);

  return context;
}

// Helper to generate unique keys
let keyCounter = 0;
function uniqueKey() {
  return `test_secure_${Date.now()}_${++keyCounter}`;
}

// Run all tests
console.log('Running SecureStorage tests...\n');

// ===================
// Basic Functionality
// ===================

{
  console.log('Test: SecureStorage is available on window');
  const ctx = createTestContext();
  assert.equal(typeof ctx.window.SecureStorage, 'function');
  console.log('  PASS');
}

{
  console.log('Test: SecureStorageSync is available on window');
  const ctx = createTestContext();
  assert.equal(typeof ctx.window.SecureStorageSync, 'function');
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage creates instance with config');
  const ctx = createTestContext();
  const storage = ctx.window.SecureStorage({
    storageKey: uniqueKey(),
    passphrase: 'test-passphrase',
  });

  assert.equal(typeof storage.init, 'function');
  assert.equal(typeof storage.setItem, 'function');
  assert.equal(typeof storage.getItem, 'function');
  assert.equal(typeof storage.removeItem, 'function');
  assert.equal(typeof storage.hasItem, 'function');
  assert.equal(typeof storage.clear, 'function');
  assert.equal(typeof storage.keys, 'function');
  assert.equal(typeof storage.rotateKey, 'function');
  assert.equal(typeof storage.migrateToEncrypted, 'function');
  assert.equal(typeof storage.getStats, 'function');
  assert.equal(typeof storage.isEncryptionEnabled, 'function');
  assert.equal(typeof storage.isInitialized, 'function');
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage initializes successfully');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'test-passphrase',
  });

  const result = await storage.init();
  assert.equal(storage.isInitialized(), true);
  assert.equal(result, true); // Encryption should be enabled
  console.log('  PASS');
}

// ====================
// Encryption Tests
// ====================

{
  console.log('Test: SecureStorage encrypts data when passphrase provided');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'secure-password-123',
  });

  await storage.init();
  await storage.setItem('secret', 'my-secret-value');

  // Check raw localStorage value is encrypted
  const rawValue = ctx.localStorage.getItem(prefix + ':secret');
  assert.notEqual(rawValue, null);
  assert.equal(rawValue.startsWith('$enc$v1$'), true);
  assert.equal(rawValue.includes('my-secret-value'), false);

  // But getItem should decrypt correctly
  const decrypted = await storage.getItem('secret');
  assert.equal(decrypted, 'my-secret-value');
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage encrypts objects correctly');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'object-test-pass',
  });

  await storage.init();

  const testObject = {
    userId: 'user123',
    preferences: {
      theme: 'dark',
      notifications: true,
    },
    scores: [100, 200, 300],
  };

  await storage.setItem('userData', testObject);
  const retrieved = await storage.getItem('userData');

  assert.equal(JSON.stringify(retrieved), JSON.stringify(testObject));
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage encrypts arrays correctly');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'array-test-pass',
  });

  await storage.init();

  const testArray = [1, 'two', { three: 3 }, [4, 5]];
  await storage.setItem('testArray', testArray);
  const retrieved = await storage.getItem('testArray');

  assert.equal(JSON.stringify(retrieved), JSON.stringify(testArray));
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage handles special characters in data');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'special-chars-pass',
  });

  await storage.init();

  const specialData = {
    unicode: 'Hello \u4e16\u754c \ud83c\udfae \u0645\u0631\u062d\u0628\u0627',
    quotes: '"quotes" and \'apostrophes\'',
    newlines: 'line1\nline2\rline3',
    html: '<script>alert("xss")</script>',
  };

  await storage.setItem('special', specialData);
  const retrieved = await storage.getItem('special');

  assert.equal(JSON.stringify(retrieved), JSON.stringify(specialData));
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage uses different IV for each encryption');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'iv-test-pass',
  });

  await storage.init();

  // Store same value twice with different keys
  await storage.setItem('key1', 'same-value');
  await storage.setItem('key2', 'same-value');

  const raw1 = ctx.localStorage.getItem(prefix + ':key1');
  const raw2 = ctx.localStorage.getItem(prefix + ':key2');

  // Both should be encrypted
  assert.equal(raw1.startsWith('$enc$v1$'), true);
  assert.equal(raw2.startsWith('$enc$v1$'), true);

  // But ciphertexts should be different (different IVs)
  assert.notEqual(raw1, raw2);
  console.log('  PASS');
}

// ====================
// Fallback Behavior
// ====================

{
  console.log('Test: SecureStorage falls back to unencrypted when no passphrase');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    // No passphrase
  });

  await storage.init();

  assert.equal(storage.isEncryptionEnabled(), false);

  await storage.setItem('unencrypted', 'plain-value');

  // Should be stored as plain JSON
  const rawValue = ctx.localStorage.getItem(prefix + ':unencrypted');
  assert.equal(rawValue, '"plain-value"');

  const retrieved = await storage.getItem('unencrypted');
  assert.equal(retrieved, 'plain-value');
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage prevents unencrypted fallback when configured');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    fallbackToUnencrypted: false,
    // No passphrase, but fallback disabled
  });

  await storage.init();

  // setItem should fail gracefully
  const result = await storage.setItem('test', 'value');
  assert.equal(result, false);
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage returns default value for missing keys');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'default-test-pass',
  });

  await storage.init();

  const result1 = await storage.getItem('nonexistent');
  assert.equal(result1, null);

  const result2 = await storage.getItem('nonexistent', 'default-value');
  assert.equal(result2, 'default-value');

  const result3 = await storage.getItem('nonexistent', { default: true });
  assert.equal(JSON.stringify(result3), JSON.stringify({ default: true }));
  console.log('  PASS');
}

// ====================
// Storage Operations
// ====================

{
  console.log('Test: SecureStorage removeItem works correctly');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'remove-test-pass',
  });

  await storage.init();

  await storage.setItem('toRemove', 'value');
  assert.equal(await storage.hasItem('toRemove'), true);

  await storage.removeItem('toRemove');
  assert.equal(await storage.hasItem('toRemove'), false);
  assert.equal(await storage.getItem('toRemove'), null);
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage hasItem works correctly');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'hasitem-test-pass',
  });

  await storage.init();

  assert.equal(await storage.hasItem('key1'), false);

  await storage.setItem('key1', 'value1');
  assert.equal(await storage.hasItem('key1'), true);

  await storage.removeItem('key1');
  assert.equal(await storage.hasItem('key1'), false);
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage keys() returns all stored keys');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'keys-test-pass',
  });

  await storage.init();

  await storage.setItem('key1', 'value1');
  await storage.setItem('key2', 'value2');
  await storage.setItem('key3', 'value3');

  const keys = await storage.keys();
  const sortedKeys = keys.sort();
  assert.equal(sortedKeys.length, 3);
  assert.equal(sortedKeys[0], 'key1');
  assert.equal(sortedKeys[1], 'key2');
  assert.equal(sortedKeys[2], 'key3');
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage clear() removes all prefixed items');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'clear-test-pass',
  });

  await storage.init();

  await storage.setItem('key1', 'value1');
  await storage.setItem('key2', 'value2');

  // Also add an item outside our prefix
  const otherKey = 'other_' + Date.now();
  ctx.localStorage.setItem(otherKey, 'other-value');

  await storage.clear();

  const clearedKeys = await storage.keys();
  assert.equal(clearedKeys.length, 0);
  assert.equal(ctx.localStorage.getItem(otherKey), 'other-value');
  console.log('  PASS');
}

// ====================
// Session Storage
// ====================

{
  console.log('Test: SecureStorage works with sessionStorage');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'session-test-pass',
    storageType: 'session',
  });

  await storage.init();

  await storage.setItem('sessionKey', 'sessionValue');

  // Check it's in sessionStorage, not localStorage
  assert.notEqual(ctx.sessionStorage.getItem(prefix + ':sessionKey'), null);
  assert.equal(ctx.localStorage.getItem(prefix + ':sessionKey'), null);

  const retrieved = await storage.getItem('sessionKey');
  assert.equal(retrieved, 'sessionValue');
  console.log('  PASS');
}

// ====================
// Key Rotation
// ====================

{
  console.log('Test: SecureStorage rotateKey re-encrypts all data');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'old-passphrase',
  });

  await storage.init();

  // Store some data
  await storage.setItem('key1', 'value1');
  await storage.setItem('key2', { nested: 'object' });

  const oldRaw = ctx.localStorage.getItem(prefix + ':key1');

  // Rotate key
  const rotateResult = await storage.rotateKey('new-passphrase');
  assert.equal(rotateResult, true);

  const newRaw = ctx.localStorage.getItem(prefix + ':key1');

  // Raw values should be different (re-encrypted)
  assert.notEqual(newRaw, oldRaw);

  // But decrypted values should be same
  assert.equal(await storage.getItem('key1'), 'value1');
  assert.equal(JSON.stringify(await storage.getItem('key2')), JSON.stringify({ nested: 'object' }));
  console.log('  PASS');
}

// ====================
// Migration
// ====================

{
  console.log('Test: SecureStorage migrateToEncrypted migrates unencrypted data');
  const ctx = createTestContext();
  const prefix = uniqueKey();

  // First, store unencrypted data
  ctx.localStorage.setItem(prefix + ':legacyKey', '"legacy-value"');

  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'migration-pass',
  });

  await storage.init();

  // Migrate
  const result = await storage.migrateToEncrypted(['legacyKey']);
  assert.equal(result.migrated, 1);
  assert.equal(result.failed, 0);

  // Check it's now encrypted
  const rawValue = ctx.localStorage.getItem(prefix + ':legacyKey');
  assert.equal(rawValue.startsWith('$enc$v1$'), true);

  // But still readable
  assert.equal(await storage.getItem('legacyKey'), 'legacy-value');
  console.log('  PASS');
}

// ====================
// Statistics
// ====================

{
  console.log('Test: SecureStorage getStats returns correct statistics');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'stats-test-pass',
  });

  await storage.init();

  await storage.setItem('key1', 'value1');
  await storage.setItem('key2', 'value2');

  const stats = await storage.getStats();

  assert.equal(stats.encryptionEnabled, true);
  assert.equal(stats.storageType, 'local');
  assert.equal(stats.prefix, prefix + ':');
  assert(stats.encryptedCount >= 2);
  assert(stats.totalSize > 0);
  console.log('  PASS');
}

// ====================
// Edge Cases
// ====================

{
  console.log('Test: SecureStorage handles null values');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'null-test-pass',
  });

  await storage.init();

  await storage.setItem('nullValue', null);
  assert.equal(await storage.getItem('nullValue'), null);
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage handles empty string values');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'empty-test-pass',
  });

  await storage.init();

  await storage.setItem('emptyString', '');
  assert.equal(await storage.getItem('emptyString'), '');
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage handles boolean values');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'bool-test-pass',
  });

  await storage.init();

  await storage.setItem('trueValue', true);
  await storage.setItem('falseValue', false);

  assert.equal(await storage.getItem('trueValue'), true);
  assert.equal(await storage.getItem('falseValue'), false);
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage handles numeric values including edge cases');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'number-test-pass',
  });

  await storage.init();

  await storage.setItem('zero', 0);
  await storage.setItem('negative', -123);
  await storage.setItem('float', 3.14159);
  await storage.setItem('large', Number.MAX_SAFE_INTEGER);

  assert.equal(await storage.getItem('zero'), 0);
  assert.equal(await storage.getItem('negative'), -123);
  assert.equal(await storage.getItem('float'), 3.14159);
  assert.equal(await storage.getItem('large'), Number.MAX_SAFE_INTEGER);
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage handles concurrent operations');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'concurrent-test-pass',
  });

  await storage.init();

  // Concurrent writes
  await Promise.all([
    storage.setItem('key1', 'value1'),
    storage.setItem('key2', 'value2'),
    storage.setItem('key3', 'value3'),
    storage.setItem('key4', 'value4'),
    storage.setItem('key5', 'value5'),
  ]);

  // All should be stored
  assert.equal(await storage.getItem('key1'), 'value1');
  assert.equal(await storage.getItem('key2'), 'value2');
  assert.equal(await storage.getItem('key3'), 'value3');
  assert.equal(await storage.getItem('key4'), 'value4');
  assert.equal(await storage.getItem('key5'), 'value5');
  console.log('  PASS');
}

// ====================
// SecureStorageSync
// ====================

{
  console.log('Test: SecureStorageSync provides sync-like interface');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorageSync({
    storageKey: prefix,
    passphrase: 'sync-test-pass',
  });

  // Initialize with preloaded keys
  await storage.init(['preloaded']);

  // Sync-like operations
  storage.setItem('syncKey', 'syncValue');

  // Get from cache immediately
  assert.equal(storage.getItem('syncKey'), 'syncValue');

  // Default value for missing key
  assert.equal(storage.getItem('missing', 'default'), 'default');
  console.log('  PASS');
}

{
  console.log('Test: SecureStorageSync getAsyncStorage returns async interface');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const syncStorage = ctx.window.SecureStorageSync({
    storageKey: prefix,
    passphrase: 'async-access-pass',
  });

  await syncStorage.init([]);

  const asyncStorage = syncStorage.getAsyncStorage();
  assert.equal(typeof asyncStorage.setItem, 'function');
  assert.equal(typeof asyncStorage.getItem, 'function');

  // Can use async operations
  await asyncStorage.setItem('asyncKey', 'asyncValue');
  assert.equal(await asyncStorage.getItem('asyncKey'), 'asyncValue');
  console.log('  PASS');
}

// ====================
// Security Tests
// ====================

{
  console.log('Test: SecureStorage cannot decrypt with wrong passphrase');
  const ctx = createTestContext();
  const prefix = uniqueKey();

  // Store with correct passphrase
  const storage1 = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'correct-passphrase',
  });
  await storage1.init();
  await storage1.setItem('secret', 'sensitive-data');

  // Try to read with wrong passphrase
  const storage2 = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'wrong-passphrase',
  });
  await storage2.init();

  // Should return default value (decryption fails)
  const result = await storage2.getItem('secret', 'failed');
  assert.equal(result, 'failed');
  console.log('  PASS');
}

{
  console.log('Test: SecureStorage encrypted data is not readable as plain text');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'plaintext-test-pass',
  });

  await storage.init();

  const sensitiveData = {
    creditCard: '4111-1111-1111-1111',
    ssn: '123-45-6789',
    password: 'super-secret-password',
  };

  await storage.setItem('sensitive', sensitiveData);

  // Get raw storage value
  const rawValue = ctx.localStorage.getItem(prefix + ':sensitive');

  // Verify sensitive data is not visible in raw storage
  assert.equal(rawValue.includes('4111-1111-1111-1111'), false);
  assert.equal(rawValue.includes('123-45-6789'), false);
  assert.equal(rawValue.includes('super-secret-password'), false);
  assert.equal(rawValue.includes('creditCard'), false);
  console.log('  PASS');
}

// ====================
// Isolation Tests
// ====================

{
  console.log('Test: Different prefixes are isolated');
  const ctx = createTestContext();
  const prefix1 = uniqueKey();
  const prefix2 = uniqueKey();

  const storage1 = ctx.window.SecureStorage({
    storageKey: prefix1,
    passphrase: 'pass1',
  });

  const storage2 = ctx.window.SecureStorage({
    storageKey: prefix2,
    passphrase: 'pass2',
  });

  await storage1.init();
  await storage2.init();

  await storage1.setItem('key', 'value1');
  await storage2.setItem('key', 'value2');

  assert.equal(await storage1.getItem('key'), 'value1');
  assert.equal(await storage2.getItem('key'), 'value2');

  await storage1.clear();

  // storage2 should be unaffected
  assert.equal(await storage2.getItem('key'), 'value2');
  console.log('  PASS');
}

// ====================
// Persistence Tests
// ====================

{
  console.log('Test: SecureStorage data persists across instances');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const passphrase = 'persist-test-pass';

  // First instance - write data
  const storage1 = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: passphrase,
  });
  await storage1.init();
  await storage1.setItem('persistent', { value: 'persisted!' });

  // Second instance - read data
  const storage2 = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: passphrase,
  });
  await storage2.init();

  const retrieved = await storage2.getItem('persistent');
  assert.equal(JSON.stringify(retrieved), JSON.stringify({ value: 'persisted!' }));
  console.log('  PASS');
}

// ====================
// Double Init Safety
// ====================

{
  console.log('Test: SecureStorage handles double initialization');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'double-init-pass',
  });

  const result1 = await storage.init();
  const result2 = await storage.init();

  assert.equal(result1, true);
  assert.equal(result2, true);
  assert.equal(storage.isInitialized(), true);
  console.log('  PASS');
}

// ====================
// Large Data Test
// ====================

{
  console.log('Test: SecureStorage handles large data');
  const ctx = createTestContext();
  const prefix = uniqueKey();
  const storage = ctx.window.SecureStorage({
    storageKey: prefix,
    passphrase: 'large-data-pass',
  });

  await storage.init();

  // Create a large string (about 100KB)
  const largeString = 'x'.repeat(100000);
  await storage.setItem('largeData', largeString);

  const retrieved = await storage.getItem('largeData');
  assert.equal(retrieved.length, 100000);
  assert.equal(retrieved, largeString);
  console.log('  PASS');
}

console.log('\nAll SecureStorage tests passed!');
