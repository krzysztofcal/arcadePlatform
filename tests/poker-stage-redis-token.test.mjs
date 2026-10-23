import assert from 'node:assert/strict';
import test from 'node:test';
process.env.XP_TEST_MODE = '1';
process.env.XP_KEY_NS = 'test:poker-stage-token';
const { resolveRedisRestToken } = await import('../netlify/functions/_shared/store-upstash.mjs');
const origin = 'https://deploy-preview-1141--playkcswh.netlify.app';
const stage = { XP_REDIS_VERSION: '3', XP_REDIS_ENV: 'stage', XP_KEY_NS: 'kcswh:stage:xp:v3', UPSTASH_REDIS_REST_TOKEN: 'legacy-test', ARCADE_STAGE_REDIS_TOKEN: 'stage-test' };
test('only immutable Stage Deploy Preview selects alias', () => {
  for (const url of [origin,'https://deploy-preview-1095--playkcswh.netlify.app','https://deploy-preview-22--playkcswh.netlify.app']) assert.equal(resolveRedisRestToken(stage, 'deploy-preview', url), 'stage-test');
  for (const url of [null, origin+'/', 'https://user@deploy-preview-1141--playkcswh.netlify.app','https://deploy-preview-1--other.netlify.app','https://play.kcswh.pl']) assert.throws(()=>resolveRedisRestToken(stage,'deploy-preview',url),/stage_preview_redis_environment_mismatch/);
  for (const [context, url] of [['production', origin], ['production','https://play.kcswh.pl'], ['branch-deploy',origin], ['unknown',null], ['dev',origin]]) {
    assert.equal(resolveRedisRestToken({ ...stage, CONTEXT:'deploy-preview', DEPLOY_PRIME_URL:origin }, context, url), 'legacy-test');
  }
});
test('approved Preview cannot fall back when alias missing or invalid', () => {
  for(const alias of [undefined, '', '  ', null, 123]) assert.equal(resolveRedisRestToken({ ...stage, ARCADE_STAGE_REDIS_TOKEN:alias }, 'deploy-preview', origin), undefined);
});
test('approved Preview rejects wrong or absent V3 environment configuration', () => {
  for(const patch of [{XP_REDIS_VERSION:undefined},{XP_REDIS_VERSION:'2'},{XP_REDIS_ENV:'prod'},{XP_KEY_NS:'kcswh:prod:xp:v3'},{XP_KEY_NS:undefined}]) assert.throws(()=>resolveRedisRestToken({...stage,...patch},'deploy-preview',origin),/stage_preview_redis_environment_mismatch/);
});
test('Production and WS preserve missing legacy token rather than using alias', () => {
  assert.equal(resolveRedisRestToken({ ...stage, UPSTASH_REDIS_REST_TOKEN:undefined },'production','https://play.kcswh.pl'), undefined);
  assert.equal(resolveRedisRestToken({ ...stage, UPSTASH_REDIS_REST_TOKEN:undefined },'unknown',null), undefined);
});
