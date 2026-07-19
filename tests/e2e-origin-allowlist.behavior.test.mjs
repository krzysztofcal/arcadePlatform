import assert from 'node:assert/strict';
import { buildApiCorsPolicy, isOriginAllowed } from '../netlify/functions/_shared/api-cors.mjs';

const policy = buildApiCorsPolicy({ configuredOrigins: 'http://127.0.0.1:4173,http://localhost:4173' });

assert.equal(isOriginAllowed({ origin: 'http://127.0.0.1:4173', policy }), true);
assert.equal(isOriginAllowed({ origin: 'http://localhost:4173', policy }), true);
assert.equal(isOriginAllowed({ origin: 'https://blocked.example.com', policy }), false);
assert.equal(isOriginAllowed({ origin: 'https://preview.netlify.app', policy }), false);

console.log('e2e origin allowlist behavior test passed');
