import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('poker csp connect-src allows both production and preview ws endpoints without broadening', () => {
  const headers = fs.readFileSync(new URL('../_headers', import.meta.url), 'utf8');
  const cspLine = headers.split('\n').find((line) => line.includes('Content-Security-Policy:')) || '';
  assert.ok(cspLine.includes("connect-src 'self'"));
  assert.ok(cspLine.includes('wss://ws.kcswh.pl'));
  assert.ok(cspLine.includes('wss://ws-preview.kcswh.pl'));
  assert.equal(cspLine.includes("connect-src *"), false);
  assert.equal(cspLine.includes("script-src *"), false);
});
