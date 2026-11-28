import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import entry, { createStageRtdnEntry } from '../netlify/functions/play-support-rtdn.mjs';

const build = {
  context: 'deploy-preview', deployId: 'fixture-id', origin: 'https://fixture-id--fixture.netlify.app',
  sha: 'a'.repeat(40)
};
const context = { site: { id: 'f7e19a84-28f7-41f7-978a-f3b4552a404d' },
  deploy: { context: build.context, id: build.deployId } };
const path = '/.netlify/functions/play-support-rtdn';
const request = (origin = build.origin, method = 'POST') => new Request(origin + path, { method });

test('checked-in fallback, production and mismatched deployment identities remain disabled', async () => {
  assert.equal((await entry(request(), context)).status, 404);
  const handler = createStageRtdnEntry(build, { PLAY_SUPPORT_STAGE_SOURCE_SHA: build.sha });
  assert.equal((await handler(request(), { ...context, deploy: { ...context.deploy, context: 'production' } })).status, 404);
  assert.equal((await handler(request(), { ...context, deploy: { ...context.deploy, id: 'another-id' } })).status, 404);
  assert.equal((await handler(request('https://alias.netlify.app'), context)).status, 404);
  assert.equal((await handler(request(), { ...context, site: { id: 'another-site' } })).status, 404);
  assert.equal((await createStageRtdnEntry(build, {})(request(), context)).status, 404);
  assert.equal((await handler(request(build.origin, 'GET'), context)).status, 405);
  assert.equal((await handler(request(), context)).status, 503);
});

test('the approved route rejects an unauthenticated request before opening the payment pool', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = {
    PLAY_SUPPORT_STAGE_SOURCE_SHA: build.sha,
    PLAY_SUPPORT_DB_URL: 'postgresql://play_support_writer:fixture@db.krydukthwdvccggbyjfw.supabase.co/postgres',
    PLAY_SUPPORT_DB_CA: rootCertificates[0],
    PLAY_SUPPORT_PUBLISHER_CREDENTIALS: JSON.stringify({
      client_email: 'fixture@fixture.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
    }),
    PLAY_SUPPORT_TOKEN_KEYRING: JSON.stringify({ activeVersion: 1, keys: { 1: Buffer.alloc(32).toString('base64') } }),
    PLAY_SUPPORT_PUSH_SERVICE_ACCOUNT: 'push@fixture.iam.gserviceaccount.com',
    PLAY_SUPPORT_PUSH_SUBSCRIPTION: 'projects/fixture/subscriptions/play-stage'
  };
  let connections = 0;
  const handler = createStageRtdnEntry(build, env, () => { connections++; throw new Error('unexpected connection'); });
  assert.equal((await handler(request(), context)).status, 401);
  assert.equal(connections, 0);
});
