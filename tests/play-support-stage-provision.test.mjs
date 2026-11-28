import test from 'node:test';
import assert from 'node:assert/strict';
import { rootCertificates } from 'node:tls';
import { provision } from '../scripts/ops/play-support-stage-provision.mjs';

const branch = 'codex/1285-play-support-rtdn-entry';
function fixture({ login = false, ambiguous = false, wrongScope = false } = {}) {
  const calls = [];
  let saved;
  const env = async (site, creation) => {
    if (creation) {
      calls.push('create');
      saved = { ...creation, scopes: wrongScope ? ['builds'] : ['functions'],
        values: [{ ...creation.values[0], id: 'fixture-value', value: 'redacted' }] };
      if (ambiguous) throw Error('network');
      return [saved];
    }
    return site && saved ? [saved] : [];
  };
  const state = async () => ({ pid: 54, login, safe: true, stage: true, authorized: true, locked: true });
  const options = {
    ca: rootCertificates[0], env, state, checkTarget: async () => {},
    activate: async (pid, verifier) => {
      assert.equal(pid, 54);
      assert.match(verifier, /^SCRAM-SHA-256\$4096:/);
      assert.equal(saved.values[0].context_parameter, branch);
      calls.push('activate');
    },
    verify: async connection => {
      assert.equal(connection.username, 'play_support_writer.krydukthwdvccggbyjfw');
      assert.equal(connection.port, 6543);
      calls.push('verify');
    },
    report: () => {}
  };
  return { calls, options };
}

test('preflight makes no changes and first apply only activates after exact Netlify readback', async () => {
  const { calls, options } = fixture();
  await provision(options);
  assert.deepEqual(calls, []);
  await provision({ ...options, apply: true });
  assert.deepEqual(calls, ['create', 'activate', 'verify']);
  await assert.rejects(provision({ ...options, apply: true }), /existing_netlify_key/);
  assert.deepEqual(calls, ['create', 'activate', 'verify']);
});

test('refuses existing login, and leaves it disabled on ambiguous or wrong-scope Netlify writes', async () => {
  for (const [input, expected, calls] of [
    [{ login: true }, /role_already_login/, []],
    [{ ambiguous: true }, /netlify_write_unconfirmed/, ['create']],
    [{ wrongScope: true }, /netlify_write_unconfirmed/, ['create']]
  ]) {
    const f = fixture(input);
    await assert.rejects(provision({ ...f.options, apply: true }), expected);
    assert.deepEqual(f.calls, calls);
  }
});
