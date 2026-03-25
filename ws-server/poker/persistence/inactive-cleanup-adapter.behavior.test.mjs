import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createInactiveCleanupExecutor } from './inactive-cleanup-adapter.mjs';

test('inactive cleanup adapter uses module-relative shared loader urls and executes shared executor', async () => {
  const adapterSrc = fs.readFileSync(new URL('./inactive-cleanup-adapter.mjs', import.meta.url), 'utf8');
  assert.match(adapterSrc, /\.\.\/\.\.\/\.\.\/shared\/poker-domain\/inactive-cleanup\.mjs/);
  assert.match(adapterSrc, /\.\.\/\.\.\/shared\/poker-domain\/inactive-cleanup-deps\.mjs/);

  const sharedSrc = fs.readFileSync(new URL('../../../shared/poker-domain/inactive-cleanup.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(sharedSrc, /netlify\/functions\/_shared\//, 'shared executor must not statically import netlify _shared modules');
  const wsDepsSrc = fs.readFileSync(new URL('../../shared/poker-domain/inactive-cleanup-deps.mjs', import.meta.url), 'utf8');
  assert.match(wsDepsSrc, /netlify\/functions\/_shared\/chips-ledger\.mjs/);
  assert.match(wsDepsSrc, /netlify\/functions\/_shared\/poker-hole-cards-store\.mjs/);

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

test('inactive cleanup loader failure classification marks module-not-found as non-retryable', async () => {
  const exec = createInactiveCleanupExecutor({
    loadInactiveCleanupModule: async () => {
      const error = new Error('Cannot find module shared/poker-domain/inactive-cleanup.mjs');
      error.code = 'ERR_MODULE_NOT_FOUND';
      throw error;
    },
    loadDepsModule: async () => ({})
  });
  const result = await exec({ tableId: 't1', userId: 'u1', requestId: 'r1' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'temporarily_unavailable');
  assert.equal(result.retryable, false);
});

test('inactive cleanup loader transient failure remains retryable', async () => {
  const exec = createInactiveCleanupExecutor({
    loadInactiveCleanupModule: async () => {
      throw new Error('temporary io failure');
    },
    loadDepsModule: async () => ({})
  });
  const result = await exec({ tableId: 't1', userId: 'u1', requestId: 'r1' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'temporarily_unavailable');
  assert.equal(result.retryable, true);
});
