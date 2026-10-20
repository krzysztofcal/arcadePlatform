import test from 'node:test';
import assert from 'node:assert/strict';
process.env.XP_TEST_MODE='1';
process.env.XP_CORS_ALLOW='https://arcade.test';
process.env.XP_REDIS_VERSION='3';
process.env.XP_REDIS_ENV='stage';
process.env.XP_KEY_NS='kcswh:stage:xp:v3';
const xp=await import('../netlify/functions/_shared/xp-ledger.mjs');
const redis=await import('../netlify/functions/_shared/store-upstash.mjs');
const OTHER='22222222-2222-4222-8222-222222222222';
const OWNER='11111111-1111-4111-8111-111111111111';
const ns='kcswh:stage:xp:v3';
test('V3 is mandatory outside isolated test mode and environment pinned',()=>{
 assert.throws(()=>xp.resolveXpNamespace({},'production',{version:null,environment:null}),/xp_redis/);
 for(const environment of ['stage','prod']) {
  const env={XP_REDIS_VERSION:'3',XP_REDIS_ENV:environment,XP_KEY_NS:`kcswh:${environment}:xp:v3`};
  assert.equal(xp.resolveXpNamespace(env,environment==='prod'?'production':'deploy-preview',{version:'3',environment}),env.XP_KEY_NS);
  assert.throws(()=>xp.resolveXpNamespace({...env,XP_KEY_NS:'kcswh:xp:v2'},environment==='prod'?'production':'deploy-preview',{version:'3',environment}),/xp_redis/);
 }
});
test('V3 owner mutations require epoch, index atomically and preserve BLOCKED',async()=>{
 const store=redis.__createMemoryStoreForTests();
 const key=xp.createXpLedgerKeys({namespace:ns}).total(OWNER);
 const put=()=>redis.guardedUserMutation({store,userId:OWNER,operation:'set',key,value:'7'});
 await assert.rejects(put(),/account_redis_fenced/);
 await store.set(ns+':lifecycle:epoch','test-epoch');
 await put(); assert.equal(await store.get(key),'7');
 assert.equal(await store.zscore(xp.xpOwnerPrefix(ns,OWNER)+'keys',key),0);
 await store.set(ns+':lifecycle:permit:'+OWNER,'BLOCKED');
 await assert.rejects(put(),/account_redis_fenced/);
 await assert.rejects(redis.guardedUserMutation({store,userId:OWNER,operation:'set',key:key.replace(':stage:',':prod:'),value:'99'}),/account_redis_fenced/);
});

test('V3 missing Redis credentials denies reads, writes, rate limits and XP HTTP without memory fallback',async()=>{
  const {mkdtemp,cp,writeFile,rm,symlink}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');const {spawnSync}=await import('node:child_process');
  const cwd=await mkdtemp(join(tmpdir(),'xp-unavailable-'));
  try {
    await cp(resolve('netlify'),join(cwd,'netlify'),{recursive:true});
    await cp(resolve('shared'),join(cwd,'shared'),{recursive:true});
    await symlink(resolve('node_modules'),join(cwd,'node_modules'),'dir');
    await writeFile(join(cwd,'netlify/functions/_generated/deploy-context.mjs'),'export const BUILD_DEPLOY_CONTEXT="deploy-preview"; export const BUILD_DEPLOY_ORIGIN=null; export const BUILD_XP_REDIS_VERSION="3"; export const BUILD_XP_REDIS_ENV="stage";');
    const script=`import assert from 'node:assert/strict';
      globalThis.fetch=()=>{throw new Error('unexpected network');};
      const m=await import('./netlify/functions/_shared/store-upstash.mjs');
      assert.equal(m.isMemoryStore,false); assert.equal(m.xpStoreUnavailable,true);
      for(const operation of [()=>m.store.get('key'),()=>m.store.set('key','value'),()=>m.atomicRateLimitIncr('key'),()=>m.getUserProfile('id'),()=>m.saveUserProfile({userId:'id',totalXp:1})])await assert.rejects(operation,{code:'xp_store_unavailable',status:503});
      for(const name of ['calculate-xp','start-session','xp-leaderboard','xp-leaderboard-me','profile-public','admin-xp-leaderboard-maintenance']){
        const {handler}=await import('./netlify/functions/'+name+'.mjs');
        const result=await handler({httpMethod:'POST',headers:{origin:'https://deploy-preview-1124--playkcswh.netlify.app'},body:'{}'});
        assert.equal(result.statusCode,503,name); assert.equal(JSON.parse(result.body).error,'xp_store_unavailable',name);
      }`;
    for(const [url,token] of [['',''],['https://fixture.invalid',''],['','fixture'],[' ','fixture']]){
      const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd,encoding:'utf8',env:{...process.env,XP_CORS_ALLOW:'https://deploy-preview-1124--playkcswh.netlify.app',XP_TEST_MODE:'0',ACCOUNT_DELETION_ENABLED:'0',CONTEXT:'deploy-preview',XP_REDIS_VERSION:'3',XP_REDIS_ENV:'stage',XP_KEY_NS:ns,UPSTASH_REDIS_REST_URL:url,UPSTASH_REDIS_REST_TOKEN:token}});
      assert.equal(result.status,0,result.stderr+result.stdout);
    }
    const memoryScript="import assert from 'node:assert/strict'; const m=await import('./netlify/functions/_shared/store-upstash.mjs'); assert.equal(m.isMemoryStore,true); await m.store.set('fixture','ok'); assert.equal(await m.store.get('fixture'),'ok');";
    const result=spawnSync(process.execPath,['--input-type=module','-e',memoryScript],{cwd,encoding:'utf8',env:{...process.env,XP_TEST_MODE:'1',UPSTASH_REDIS_REST_URL:'',UPSTASH_REDIS_REST_TOKEN:''}});
    assert.equal(result.status,0,result.stderr+result.stdout);
  } finally { await rm(cwd,{recursive:true,force:true}); }
});


test('reset accepts elapsed TTL, rejects changed content/owner/type/renewal and uncertain absence',async()=>{
  const {buildLegacyXpResetPlan,validateLegacyXpResetObservation:check}=await import('../scripts/ops/xp-redis-reset-plan.mjs');
  const record={key:'kcswh:xp:user:'+OWNER,type:'string',value:JSON.stringify({userId:OWNER,totalXp:7,avatar:'preserve'}),pttl:5000,capturedAtMs:100000};
  const [action]=buildLegacyXpResetPlan([record]).operations;
  assert.deepEqual(check(action,{...record,pttl:3000},{nowMs:102000,toleranceMs:0}),{action:'SET',preserveCurrentTtl:true});
  assert.deepEqual(check(action,{type:'none',pttl:-2},{nowMs:105000}),{action:'SKIP_EXPIRED'});
  for(const current of [{...record,value:'changed'},{...record,value:JSON.stringify({userId:OTHER,totalXp:7,avatar:'preserve'})},{...record,type:'hash'},{...record,pttl:9000},{...record,pttl:-1},{type:'none',pttl:-2}])assert.throws(()=>check(action,current,{nowMs:102000,toleranceMs:0}));
  const [persistent]=buildLegacyXpResetPlan([{...record,pttl:-1}]).operations;
  assert.equal(check(persistent,{...record,pttl:-1},{nowMs:999999}).action,'SET');
  assert.throws(()=>check(persistent,{...record,pttl:2000},{nowMs:102000}));
  assert.throws(()=>check(persistent,{type:'none',pttl:-2},{nowMs:999999}));
  assert.throws(()=>check(action,{...record,pttl:3000},{nowMs:102000,toleranceMs:2000}));
});

test('reset command binds original XP-only snapshot and refuses foreign/tampered actions before EVAL',async()=>{
  const {buildLegacyXpResetPlan,prepareLegacyXpResetCommand}=await import('../scripts/ops/xp-redis-reset-plan.mjs');
  const snapshot={key:'kcswh:xp:user:fixture',type:'string',value:JSON.stringify({totalXp:40,hasConvertedAnonXp:true,profileName:'preserve'}),pttl:-1,capturedAtMs:1000};
  const [action]=buildLegacyXpResetPlan([snapshot]).operations;
  const command=prepareLegacyXpResetCommand(action,snapshot);
  assert.equal(command[0],'EVAL');assert.equal(command[2],1);assert.equal(command[3],snapshot.key);
  assert.deepEqual(JSON.parse(command.at(-1)),{totalXp:0,hasConvertedAnonXp:true,profileName:'preserve'});
  assert.throws(()=>prepareLegacyXpResetCommand({...action,key:'kcswh:stage:xp:v3:user:other:profile'},snapshot),/reset_action_changed/);
  assert.throws(()=>prepareLegacyXpResetCommand({...action,value:'{}'},snapshot),/reset_action_changed/);
  assert.throws(()=>prepareLegacyXpResetCommand(action,{...snapshot,value:'changed'}));
});

test('legacy anonymous XP cache is reset without dropping conversion/identity or unknown fields',async()=>{
  const {legacyXpResetAction}=await import('../scripts/ops/xp-redis-reset-plan.mjs');
  const value={anonId:'fixture-anon',totalAnonXp:80,anonActiveDays:3,convertedToUserId:OWNER,lastActivityTs:123,lastActiveDayKey:'2020-01-01',createdAt:'fixture',other:'preserve'};
  const action=legacyXpResetAction('kcswh:xp:anon:fixture-anon',{type:'string',value:JSON.stringify(value)});
  assert.equal(action.operation,'SET');assert.equal(action.preserveTtl,true);
  assert.deepEqual(JSON.parse(action.value),{...value,totalAnonXp:0,anonActiveDays:0});
  const {other,...known}=value;
  assert.equal(legacyXpResetAction('kcswh:xp:anon:fixture-anon',{type:'string',value:JSON.stringify(known)}).operation,'DEL');
  assert.equal(legacyXpResetAction('kcswh:xp:user:'+OWNER,{type:'string',value:JSON.stringify({userId:OWNER,totalXp:80,hasConvertedAnonXp:true})}).operation,'DEL');
});

test('new V3 anonymous conversion never imports V2 and is once-only',async()=>{
 const store=redis.__createMemoryStoreForTests();
 const {migrateAnonXpToUser}=await import('../netlify/functions/_shared/xp-identity.mjs');
 await store.set(ns+':lifecycle:epoch','conversion-test');
 await store.set('kcswh:xp:v2:total:'+OTHER,'9999');
 const convert=()=>migrateAnonXpToUser({store,namespace:ns,anonId:OTHER,userId:OWNER,conversionCap:100});
 assert.equal((await convert()).converted,0);
 const anon=xp.createXpLedgerKeys({namespace:ns,anonymous:true});
 await redis.guardedUserMutation({store,userId:OTHER,anonymous:true,operation:'set',key:anon.total(OTHER),value:'9'});
 assert.equal((await convert()).converted,9);
 assert.equal((await convert()).converted,0);
 assert.equal(await store.get('kcswh:xp:v2:total:'+OTHER),'9999');
});

test('Redis read quota/error never bypasses leaderboard rate limits',async()=>{
 const {allowLeaderboardRead}=await import('../netlify/functions/_shared/xp-leaderboard-http.mjs');
 await assert.rejects(allowLeaderboardRead({headers:{}},{increment:async()=>{throw Error('quota');}}),{status:503});
 const {createXpLeaderboardHandler}=await import('../netlify/functions/xp-leaderboard.mjs');
 const handler=createXpLeaderboardHandler({leaderboardEnabled:()=>true,allowLeaderboardRead:async()=>{throw Object.assign(Error('quota'),{status:503});}});
 const result=await handler({httpMethod:'GET',headers:{origin:'https://arcade.test'}});
 assert.equal(result.statusCode,503);
});
