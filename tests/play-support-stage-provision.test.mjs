import test from 'node:test';
import assert from 'node:assert/strict';
import { rootCertificates } from 'node:tls';
import { netlify, provision } from '../scripts/ops/play-support-stage-provision.mjs';

const valueId = '12345678-1234-1234-1234-123456789abc';
const branch = 'codex/1285-play-support-rtdn-entry';
function fixture({ login = false, ambiguous = false, wrongScope = false } = {}) {
  const calls = [];
  let saved;
  const env = async (site, creation) => {
    if (creation) {
      calls.push('create');
      saved = { ...creation, scopes: wrongScope ? ['builds', 'functions', 'runtime', 'post_processing'] : creation.scopes,
        values: [{ ...creation.values[0], id: valueId, value: 'redacted' }] };
      if (ambiguous) throw Error('network');
      return { status: 201, data: [saved] };
    }
    return { status: 200, data: site && saved ? [saved] : [] };
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

test('POST follows Netlify createEnvVars contract and reports only stage and HTTP status on failure', async () => {
  const f = fixture();
  const lines = [];
  const api = netlify('synthetic-token', async (url, request) => {
    assert.equal(url, 'https://api.netlify.com/api/v1/accounts/fixture/env?site_id=fixture');
    assert.equal(request.method, 'POST');
    const [entry] = JSON.parse(request.body);
    assert.equal(entry.key, 'PLAY_SUPPORT_DB_URL');
    assert.equal(entry.is_secret, true);
    assert.deepEqual(entry.scopes, ['builds', 'functions', 'runtime']);
    assert.equal(entry.values[0].context, 'branch');
    assert.equal(entry.values[0].context_parameter, branch);
    return new Response('private error body and token', { status: 403 });
  });
  const env = async (site, payload) => payload ? api('/accounts/fixture/env?site_id=fixture', payload) :
    { status: 200, data: [] };
  await assert.rejects(provision({ ...f.options, apply: true, env, report: line => lines.push(line) }),
    /netlify_write_unconfirmed/);
  assert.deepEqual(lines, ['NETLIFY_DIAGNOSTIC stage=create_post http=403 reason=http',
    'NETLIFY_CANDIDATE_COUNT source=site_readback count=0']);
  assert.deepEqual(f.calls, []);
});

test('metadata refusal includes stage and successful HTTP status without echoing a body', async () => {
  const f = fixture({ wrongScope: true });
  const lines = [];
  await assert.rejects(provision({ ...f.options, apply: true, report: line => lines.push(line) }),
    /netlify_write_unconfirmed/);
  assert.deepEqual(f.calls, ['create']);
  assert.deepEqual(lines, [
    'NETLIFY_DIAGNOSTIC stage=create_metadata http=201 reason=metadata',
    'NETLIFY_CANDIDATE_COUNT source=create count=1',
    'NETLIFY_CANDIDATE_COUNT source=site_readback count=1',
    'NETLIFY_CANDIDATE_VALUE_ID ' + valueId
  ]);
});
