import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaySupportRtdnHandler } from '../netlify/functions/_shared/play-support-rtdn.mjs';

const target = {
  environment: 'stage', packageName: 'pl.kcswh.arcadepoker.stage',
  subscription: 'projects/fixture/subscriptions/play-stage'
};
const token = 'synthetic-play-token';
const now = Date.UTC(2026, 10, 27, 12);
function push({ authorization = 'Bearer test', notice, ...extra } = {}) {
  return new Request('https://preview.invalid/notify', {
    method: 'POST', headers: { authorization },
    body: JSON.stringify({
      subscription: target.subscription,
      message: { messageId: 'fixture-id', data: Buffer.from(JSON.stringify({
        version: '1.0', packageName: target.packageName, eventTimeMillis: String(now),
        oneTimeProductNotification: { version: '1.0', notificationType: 1, purchaseToken: token },
        ...notice
      })).toString('base64') },
      ...extra
    })
  });
}

function fixture({ state = 'COMPLETE', settled = false, persisted = true } = {}) {
  const calls = [];
  const handler = createPlaySupportRtdnHandler({
    ...target, now: () => now,
    verifyAuthorization: async authorization => authorization === 'Bearer test',
    enqueue: async input => { calls.push(['enqueue', input]); return persisted; },
    process: async input => { calls.push(['process', input]); return { state }; },
    isComplete: async () => settled
  });
  return { handler, calls };
}

test('authenticates and pins subscription/app before recording a notification', async () => {
  const f = fixture();
  assert.equal((await f.handler(push({ authorization: 'Bearer wrong' }))).status, 401);
  assert.equal((await f.handler(push({ subscription: 'projects/fixture/subscriptions/wrong' }))).status, 403);
  assert.equal((await f.handler(push({ notice: { packageName: 'pl.kcswh.arcadepoker' } }))).status, 403);
  assert.deepEqual(f.calls, []);
  const reply = await f.handler(push());
  assert.equal(reply.status, 204);
  assert.deepEqual(f.calls.map(([name]) => name), ['enqueue', 'process']);
  assert.equal(f.calls[0][1].token, token);
  assert.equal(await reply.text(), '');
});

test('keeps unfinished work retryable and acknowledges a previously settled duplicate', async () => {
  assert.equal((await fixture({ state: 'PENDING' }).handler(push())).status, 503);
  assert.equal((await fixture({ persisted: false }).handler(push())).status, 503);
  assert.equal((await fixture({ state: 'NO_WORK', settled: true }).handler(push())).status, 204);
  assert.equal((await fixture({ state: 'NO_WORK' }).handler(push())).status, 503);
});

test('ignores authenticated test messages and rejects malformed envelopes without queuing', async () => {
  const f = fixture();
  assert.equal((await f.handler(push({ notice: { testNotification: { version: '1.0' }, oneTimeProductNotification: undefined } }))).status, 204);
  assert.equal((await f.handler(push({ message: { messageId: 'fixture-id', data: '%' } }))).status, 400);
  assert.deepEqual(f.calls, []);
});
