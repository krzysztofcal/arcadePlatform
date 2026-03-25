import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createInactiveCleanupExecutor } from './inactive-cleanup-adapter.mjs';

test('inactive cleanup adapter uses bridge modules and executes shared executor', async () => {
  const adapterSrc = fs.readFileSync(new URL('./inactive-cleanup-adapter.mjs', import.meta.url), 'utf8');
  assert.match(adapterSrc, /\.\.\/\.\.\/shared\/poker-domain\/inactive-cleanup\.mjs/);
  assert.match(adapterSrc, /\.\.\/\.\.\/shared\/poker-domain\/inactive-cleanup-deps\.mjs/);

  const sharedSrc = fs.readFileSync(new URL('../../../shared/poker-domain/inactive-cleanup.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(sharedSrc, /netlify\/functions\/_shared\//, 'shared executor must not statically import netlify _shared modules');

  const calls = [];
  const exec = createInactiveCleanupExecutor({
    env: {},
    beginSql: async (fn) => fn({ unsafe: async () => [] }),
    loadInactiveCleanupModule: async () => ({
      executeInactiveCleanup: async (args) => {
        calls.push(args);
        return { ok: true, changed: false, protected: true, status: 'turn_protected' };
      }
    }),
    loadDepsModule: async () => ({
      postTransaction: async () => {},
      isHoleCardsTableMissing: () => false
    })
  });

  const result = await exec({ tableId: 't1', userId: 'u1', requestId: 'r1' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'turn_protected');
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0].postTransaction, 'function');
});
