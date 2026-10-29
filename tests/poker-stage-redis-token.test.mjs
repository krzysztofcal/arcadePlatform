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
  for (const [context, url] of [['production', origin], ['production','https://play.kcswh.pl'], ['unknown',null], ['dev',origin]]) {
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

test('trusted native parent branch uses Stage alias and unknown branch never falls back',()=>{
 const parent='https://feat-1114-profiles-phase-a--playkcswh.netlify.app';
 assert.equal(resolve(stage,'branch-deploy',parent,'netlify-stage-parent'),'stage-test');
 for(const url of [null,origin,'https://other--playkcswh.netlify.app',parent+'/', 'https://user@feat-1114-profiles-phase-a--playkcswh.netlify.app'])assert.throws(()=>resolve(stage,'branch-deploy',url,'netlify-stage-parent'),/stage_preview_redis_environment_mismatch/);
 assert.throws(()=>resolve(stage,'branch-deploy',parent,'netlify-functions'),/stage_preview_redis_environment_mismatch/);
 assert.equal(resolve({...stage,ARCADE_STAGE_REDIS_TOKEN:undefined},'branch-deploy',parent,'netlify-stage-parent'),undefined);
 assert.throws(()=>resolve({...stage,XP_REDIS_ENV:'prod'},'branch-deploy',parent,'netlify-stage-parent'),/stage_preview_redis_environment_mismatch/);
 assert.equal(resolve(stage,'production','https://play.kcswh.pl','netlify-stage-parent'),'legacy-test');
});


test('Stage CORS adds exact WebView origin only for immutable recognized Netlify identities',async()=>{
 const {buildApiCorsPolicy,buildCorsHeaders}=await import('../netlify/functions/_shared/api-cors.mjs');
 const cases=[['deploy-preview',origin,'netlify-functions',true],['branch-deploy','https://feat-1114-profiles-phase-a--playkcswh.netlify.app','netlify-stage-parent',true],['production','https://play.kcswh.pl','netlify-functions',false],['branch-deploy','https://other--playkcswh.netlify.app','netlify-stage-parent',false],['deploy-preview',null,'ws-preview',false],['deploy-preview',origin,'ws-server',false]];
 for(const [buildContext,buildDeployOrigin,buildArtifactIdentity,allowed] of cases){
  const policy=buildApiCorsPolicy({configuredOrigins:'https://play.kcswh.pl,http://localhost:4173',buildContext,buildDeployOrigin,buildArtifactIdentity});
  assert.equal(policy.origins.includes('https://localhost'),allowed);assert.ok(policy.origins.includes('https://play.kcswh.pl'));
  const headers=buildCorsHeaders({origin:'https://localhost',policy,methods:'GET, OPTIONS',allowedHeaders:'authorization,content-type'});
  assert.equal(!!headers,allowed);if(allowed){assert.equal(headers['access-control-allow-origin'],'https://localhost');assert.equal(headers['access-control-allow-methods'],'GET, OPTIONS');assert.equal(headers['access-control-allow-headers'],'authorization,content-type');}
  assert.equal(buildCorsHeaders({origin:'https://evil.invalid',policy}),null);
 }
});

test('native parent generator pins Stage credentials/origin, publishes safe receipt, rejects Production inheritance',async()=>{
 const fs=await import('node:fs');const path=await import('node:path');const {createRequire}=await import('node:module');const {runInNewContext}=await import('node:vm');const {createHmac}=await import('node:crypto');const require=createRequire(import.meta.url);
 const ref='krydukthwdvccggbyjfw',secret='synthetic-stage-secret';
 const jwt=role=>{const a=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({ref,role})).toString('base64url');return a+'.'+createHmac('sha256',secret).update(a).digest('base64url');};
 const env={CONTEXT:'branch-deploy',BRANCH:'feat/1114-profiles-phase-a',COMMIT_REF:'a'.repeat(40),DEPLOY_ID:'test-deploy',DEPLOY_PRIME_URL:'https://feat-1114-profiles-phase-a--playkcswh.netlify.app',...stage,SUPABASE_URL:`https://${ref}.supabase.co`,SUPABASE_DB_URL:`postgresql://postgres:synthetic@db.${ref}.supabase.co:5432/postgres`,SUPABASE_JWT_SECRET:secret,SUPABASE_ANON_KEY:jwt('anon'),SUPABASE_SERVICE_ROLE_KEY:jwt('service_role')};
 const generator=fs.readFileSync('scripts/generate-build-info.js','utf8');let files;
 const build=patch=>{files={};runInNewContext(generator,{require:name=>name==='fs'?{existsSync:()=>false,mkdirSync(){},writeFileSync(file,value){files[path.basename(file)]=value;},appendFileSync(file,value){files[path.basename(file)]=(files[path.basename(file)]||'')+value;}}:name==='child_process'?{execSync:()=>''}:require(name),process:{argv:['node','generate-build-info.js'],env:{...env,...patch},cwd:()=>'/synthetic-build'},__dirname:path.resolve('scripts'),URL,Buffer,console:{log(){}}});return files;};
 build({});assert.match(files['deploy-context.mjs'],/BUILD_ARTIFACT_IDENTITY = "netlify-stage-parent"/);assert.match(files['_headers'],/X-Robots-Tag: noindex/);
 assert.match(files['build-info.js'],/\"stageParent\": true/);assert.match(files['build-info.js'],/\"context\": \"branch-deploy\"/);
 const receipt=JSON.parse(files['stage-context-receipt.json']);assert.equal(receipt.origin,env.DEPLOY_PRIME_URL);assert.equal(receipt.supabaseProjectRef,ref);assert.equal(receipt.sourceSha,env.COMMIT_REF);assert.equal(receipt.wsUrl,'wss://ws-preview.kcswh.pl/ws');
 assert.ok(!JSON.stringify(receipt).includes(secret));assert.ok(!JSON.stringify(receipt).includes(env.SUPABASE_SERVICE_ROLE_KEY));assert.ok(!JSON.stringify(receipt).includes('synthetic@'));
 for(const patch of [{POKER_WS_PREVIEW_URL:'wss://ws.kcswh.pl/ws'},{BRANCH:'unapproved'},{DEPLOY_PRIME_URL:origin},{SUPABASE_URL:'https://otbqfijerkieoxwpxjnm.supabase.co'},{SUPABASE_DB_URL:'postgresql://postgres:synthetic@db.otbqfijerkieoxwpxjnm.supabase.co/postgres'},{SUPABASE_JWT_SECRET:'wrong-key'},{SUPABASE_JWT_SECRET_V2:'wrong-inherited-key'},{SUPABASE_DB_URL:env.SUPABASE_DB_URL+'?host=db.otbqfijerkieoxwpxjnm.supabase.co'},{SUPABASE_SERVICE_ROLE_KEY:jwt('anon')},{ARCADE_STAGE_REDIS_TOKEN:''},{XP_REDIS_ENV:'prod'},{XP_KEY_NS:'kcswh:prod:xp:v3'}])assert.throws(()=>build(patch),/stage_|xp_redis_/);
 build({CONTEXT:'deploy-preview',BRANCH:'feat/child',DEPLOY_PRIME_URL:origin});assert.match(files['deploy-context.mjs'],/BUILD_ARTIFACT_IDENTITY = "netlify-functions"/);assert.equal(files['_headers'],undefined);
});
