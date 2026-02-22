import assert from 'node:assert/strict';
import { isOriginAllowed } from '../netlify/functions/_shared/xp-cors.mjs';

const testAllowlist = ['http://127.0.0.1:4173', 'http://localhost:4173'];

assert.equal(isOriginAllowed({ origin: 'http://127.0.0.1:4173', allowlist: testAllowlist }), true);
assert.equal(isOriginAllowed({ origin: 'http://localhost:4173', allowlist: testAllowlist }), true);
assert.equal(isOriginAllowed({ origin: 'https://blocked.example.com', allowlist: testAllowlist }), false);
assert.equal(isOriginAllowed({ origin: 'https://preview.netlify.app', allowlist: testAllowlist }), true);

console.log('e2e origin allowlist behavior test passed');
