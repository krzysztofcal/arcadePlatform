import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { rootCertificates } from 'node:tls';
import { createStageDbProof } from '../netlify/functions/play-support-db-proof.mjs';

const site = { id: 'f7e19a84-28f7-41f7-978a-f3b4552a404d' };
const deploy = { id: 'example', context: 'deploy-preview' };
const build = { ...deploy, deployId: deploy.id, sha: 'b'.repeat(40), origin: 'https://example--playkcswh.netlify.app' };
const secret = 'a'.repeat(64);
const env = {
  PLAY_SUPPORT_STAGE_PROBE_SOURCE_SHA: build.sha,
  PLAY_SUPPORT_STAGE_PROBE_TOKEN_SHA256: createHash('sha256').update(secret).digest('hex'),
  PLAY_SUPPORT_DB_URL: 'postgresql://play_support_writer.krydukthwdvccggbyjfw:fake@aws-0-eu-west-3.pooler.supabase.com:6543/postgres',
  PLAY_SUPPORT_DB_CA: rootCertificates[0]
};
function request(token = secret, origin = build.origin) {
  return new Request(origin + '/.netlify/functions/play-support-db-proof', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }
  });
}
function fixture(rows = [{ ok: true }]) {
  const calls = [];
  const connect = options => {
    calls.push(options.username);
    return {
      async begin(mode, run) {
        calls.push(mode);
        return run(async sql => {
          if (sql[0].includes('select')) return rows;
          assert.match(sql[0], /set local statement_timeout/);
        });
      }
    };
  };
  return { calls, handler: createStageDbProof(build, env, connect) };
}

test('wrong target or token never opens a connection', async () => {
  const { handler, calls } = fixture();
  assert.equal((await handler(request(), { site, deploy: { ...deploy, context: 'production' } })).status, 404);
  assert.equal((await handler(request(secret, 'https://moving-alias.netlify.app'), { site, deploy })).status, 404);
  assert.equal((await handler(request('b'.repeat(64)), { site, deploy })).status, 401);
  assert.deepEqual(calls, []);
});

test('authenticated proof uses the pinned role inside a read-only transaction', async () => {
  const { handler, calls } = fixture();
  const response = await handler(request(), { site, deploy });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verified: true, role: 'play_support_writer' });
  assert.deepEqual(calls, ['play_support_writer.krydukthwdvccggbyjfw', 'read only']);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('unexpected database identity returns empty refusal', async () => {
  const { handler } = fixture([{ ok: false }]);
  const response = await handler(request(), { site, deploy });
  assert.equal(response.status, 503);
  assert.equal(await response.text(), '');
});
