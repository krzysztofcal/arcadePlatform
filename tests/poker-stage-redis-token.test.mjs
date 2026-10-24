import assert from 'node:assert/strict';
import test from 'node:test';
process.env.XP_TEST_MODE = '1';
process.env.XP_KEY_NS = 'test:poker-stage-token';
const { resolveRedisRestToken: resolve } = await import('../netlify/functions/_shared/store-upstash.mjs');
const resolveRedisRestToken = (env, context, origin, identity = 'netlify-functions') => resolve(env, context, origin, identity);
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
test('Production and non-Preview preserve missing legacy token rather than using alias', () => {
  assert.equal(resolveRedisRestToken({ ...stage, UPSTASH_REDIS_REST_TOKEN:undefined },'production','https://play.kcswh.pl'), undefined);
  assert.equal(resolveRedisRestToken({ ...stage, UPSTASH_REDIS_REST_TOKEN:undefined },'unknown',null), undefined);
});

test('only explicit immutable WS Preview identity preserves legacy credentials', () => {
  assert.equal(resolveRedisRestToken(stage,'deploy-preview',null,'ws-preview'),'legacy-test');
  assert.equal(resolveRedisRestToken({...stage,UPSTASH_REDIS_REST_TOKEN:undefined},'deploy-preview',null,'ws-preview'),undefined);
  for (const identity of [undefined,null,'','unknown','ws-server','ws-preview-typo']) {
    for (const url of [null,origin]) assert.throws(()=>resolve(stage,'deploy-preview',url,identity),/stage_preview_redis_environment_mismatch/);
  }
  assert.throws(()=>resolveRedisRestToken(stage,'deploy-preview',origin,'ws-preview'),/stage_preview_redis_environment_mismatch/);
  assert.throws(()=>resolveRedisRestToken({...stage,XP_KEY_NS:'kcswh:prod:xp:v3'},'deploy-preview',null,'ws-preview'),/stage_preview_redis_environment_mismatch/);
  assert.throws(()=>resolveRedisRestToken({...stage,BUILD_ARTIFACT_IDENTITY:'ws-preview'},'deploy-preview',null),/stage_preview_redis_environment_mismatch/);
});

test('actual WS workflow generated context imports real WS dependency without network or Redis writes', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { createRequire } = await import('node:module');
  const { runInNewContext } = await import('node:vm');
  const { spawnSync } = await import('node:child_process');
  const { pathToFileURL } = await import('node:url');
  const require = createRequire(import.meta.url);
  const workflow = fs.readFileSync('.github/workflows/ws-preview-deploy.yml','utf8');
  const command = workflow.match(/CONTEXT=deploy-preview node scripts\/generate-build-info\.js ([^\n]+)/);
  assert.ok(command);
  const argv = command[1].trim().split(/\s+/);
  const env = {CONTEXT:'deploy-preview',XP_REDIS_VERSION:'3',XP_REDIS_ENV:'stage',XP_KEY_NS:'kcswh:stage:xp:v3'};
  let generated;
  const generator = fs.readFileSync('scripts/generate-build-info.js','utf8');
  const build = (args, override={}) => {
    generated = undefined;
    runInNewContext(generator, {
      require: name => name === 'fs' ? {mkdirSync(){},writeFileSync(_file,source){generated=source;}} : require(name),
      process: {argv:['node','generate-build-info.js',...args],env:{...env,...override},cwd:()=>process.cwd()},
      __dirname:path.resolve('scripts'),URL,console:{log(){}}
    });
    return generated;
  };
  const source = build(argv);
  assert.match(source,/BUILD_ARTIFACT_IDENTITY = "ws-preview"/);
  assert.match(source,/BUILD_DEPLOY_ORIGIN = null/);
  assert.throws(()=>build(argv,{DEPLOY_PRIME_URL:origin}),/redis_artifact_identity_invalid/);
  assert.throws(()=>build(argv,{CONTEXT:'production',XP_REDIS_ENV:'prod',XP_KEY_NS:'kcswh:prod:xp:v3'}),/redis_artifact_identity_invalid/);
  assert.throws(()=>build(argv,{XP_REDIS_VERSION:'2'}),/xp_redis_build_configuration_invalid/);
  const contextUrl = pathToFileURL(path.resolve('netlify/functions/_generated/deploy-context.mjs')).href;
  const loader = 'export async function load(url,ctx,next){if(url==='+JSON.stringify(contextUrl)+')return {format:"module",source:'+JSON.stringify(source)+',shortCircuit:true};return next(url,ctx);}';
  const entry = `import assert from 'node:assert/strict';
    import {register} from 'node:module';
    register(${JSON.stringify('data:text/javascript,'+encodeURIComponent(loader))});
    globalThis.fetch=()=>{throw Error('network forbidden');};
    const {Socket}=await import('node:net');Socket.prototype.connect=()=>{throw Error('network forbidden');};
    const store=await import(${JSON.stringify(pathToFileURL(path.resolve('netlify/functions/_shared/store-upstash.mjs')).href)});
    for(const name of ['get','set','eval','del'])store.store[name]=()=>{throw Error('Redis operation forbidden');};
    await import(${JSON.stringify(pathToFileURL(path.resolve('ws-server/poker/runtime/account-deletion.mjs')).href)});
    assert.equal(store.isMemoryStore,false);assert.equal(store.xpStoreUnavailable,false);`;
  const result = spawnSync(process.execPath,['--input-type=module','-e',entry],{encoding:'utf8',env:{PATH:process.env.PATH,NODE_ENV:'test',...env,XP_TEST_MODE:'0',UPSTASH_REDIS_REST_URL:'https://redis.invalid',UPSTASH_REDIS_REST_TOKEN:'synthetic-ws-token'}});
  assert.equal(result.status,0,result.stderr+result.stdout);
});
