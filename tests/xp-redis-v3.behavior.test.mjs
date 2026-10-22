import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
process.env.XP_TEST_MODE='1';
process.env.ACCOUNT_DELETION_ENABLED='1';
process.env.XP_KEY_NS='kcswh:stage:xp:v3';
process.env.XP_REDIS_ENV='stage';
process.env.XP_REDIS_VERSION='3';
const {createXpLedgerKeys,resolveXpNamespace,xpOwnerPrefix,executeAtomicXpAward}=await import('../netlify/functions/_shared/xp-ledger.mjs');
const {__createMemoryStoreForTests:memoryStore,guardedUserMutation,guardedRedisEval,blockRedisIdentity,cleanupRedisIdentity}=await import('../netlify/functions/_shared/store-upstash.mjs');
const {createXpLeaderboardKeys,getXpLeaderboardPeriods}=await import('../netlify/functions/_shared/xp-leaderboard.mjs');
const OWNER='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const GUEST='33333333-3333-4333-8333-333333333333';
const namespace=process.env.XP_KEY_NS;
const keys=createXpLedgerKeys({namespace});
const anon=createXpLedgerKeys({namespace,anonymous:true});
const boards=createXpLeaderboardKeys({namespace});
const EPOCH=namespace+':lifecycle:epoch';
const env={UPSTASH_REDIS_REST_URL:'https://local-fixture.invalid'};
const proof={namespace,epoch:'one',endpoint_hash:createHash('sha256').update(env.UPSTASH_REDIS_REST_URL).digest('hex'),writers_drained:true,legacy_xp_reset_verified:true,manifest_hash:'a'.repeat(64)};
const active=async(fn)=>fn({unsafe:async(sql)=>sql.includes('to_regclass')?[{lifecycle:true,retirement:true}]:sql.includes('as present')?[{present:true,deleting:false}]:sql.includes('as deleting')?[{deleting:false}]:[]});
const attested=(overrides={})=>async(fn)=>fn({unsafe:async()=>[{redis_cutover:{...proof,...overrides}}]});
const permit=id=>namespace+':lifecycle:permit:'+id;
async function fixture(){const store=memoryStore();await store.set(EPOCH,'one');return store;}
async function put(store,id,key,value='1',extra={}){return guardedUserMutation({store,userId:id,key,value,operation:'set',beginSql:active,...extra});}

test('V3 separates environments and anonymous UUIDs; invalid target/context fail closed',()=>{
  assert.equal(keys.total(OWNER),namespace+':user:'+OWNER+':total');
  assert.notEqual(anon.total(OWNER),keys.total(OWNER));
  assert.notEqual(createXpLedgerKeys({namespace:'kcswh:prod:xp:v3'}).total(OWNER),keys.total(OWNER));
  assert.throws(()=>keys.total('not-uuid'),/xp_uuid_required/);
  assert.throws(()=>resolveXpNamespace({XP_KEY_NS:namespace,XP_REDIS_ENV:'stage',XP_REDIS_VERSION:'3',ARCADE_DEPLOY_TARGET:'unknown'},'unknown',{version:'3',environment:'stage'}),/unpinned/);
  assert.throws(()=>resolveXpNamespace({XP_KEY_NS:'kcswh:prod:xp:v3',XP_REDIS_ENV:'prod'},'development'),/mismatch/);
  assert.throws(()=>resolveXpNamespace({XP_KEY_NS:namespace,XP_REDIS_ENV:'prod'},'deploy-preview'),/mismatch/);
  assert.throws(()=>resolveXpNamespace({XP_KEY_NS:namespace,XP_REDIS_ENV:'stage'},'production'),/mismatch/);
  assert.throws(()=>resolveXpNamespace({XP_KEY_NS:'kcswh:prod:xp:v3',XP_REDIS_ENV:'prod'},'deploy-preview'),/mismatch/);
});

test('every private family/raw writer is indexed, bounded retry cleans only owner without SCAN',async()=>{
  const store=await fixture();
  const owned=[keys.total(OWNER),keys.daily(OWNER,'2026-10-18'),keys.session(OWNER,'sid'),keys.sessionSync(OWNER,'sid'),keys.sessionState(OWNER,'sid'),keys.serverSession(OWNER,'sid'),keys.registry(OWNER,'sid'),keys.lock(OWNER,'sid'),keys.profile(OWNER),keys.hidden(OWNER),keys.rateLimit(OWNER,1),keys.migration(GUEST,OWNER),keys.userMigration(OWNER)];
  for(const key of owned)await put(store,OWNER,key);
  await put(store,OTHER,keys.total(OTHER),'42');
  const foreign='kcswh:prod:xp:v3:user:'+OWNER+':total';await store.set(foreign,'99');
  for(const id of [OWNER,OTHER]) await guardedUserMutation({store,userId:id,key:boards.allTime(),value:id,score:9,operation:'zadd',beginSql:active});
  // Session writes and renewals use the same fence/index, not a raw SETEX.
  await put(store,OWNER,keys.serverSession(OWNER,'sid'),JSON.stringify({userId:OWNER}),{operation:'setex',ttl:60});
  assert.ok(await store.ttl(keys.serverSession(OWNER,'sid'))>0);
  await blockRedisIdentity(OWNER,store);
  store.scan=async()=>{throw new Error('no whole Redis scanning');};
  const input={store,userId:OWNER,env,beginSql:attested(),limit:2};
  const missing=await cleanupRedisIdentity({...input,beginSql:attested({legacy_xp_reset_verified:false})});
  assert.equal(missing.done,false);assert.ok(await store.get(keys.total(OWNER)));
  let result;let attempts=0;do{result=await cleanupRedisIdentity(input);assert.ok(++attempts<20);}while(!result.done);
  assert.ok(attempts>1);
  assert.equal((await cleanupRedisIdentity(input)).done,true); // response lost/restart retry
  for(const key of owned)assert.equal(await store.get(key),null);
  assert.equal(await store.get(keys.total(OTHER)),'42');
  assert.equal(await store.get(foreign),'99');
  assert.equal(await store.zscore(boards.allTime(),OWNER),null);
  assert.equal(await store.zscore(boards.allTime(),OTHER),9);
  assert.equal(await store.get(permit(OWNER)),'BLOCKED');
  await assert.rejects(put(store,OWNER,keys.profile(OWNER)),{code:'account_redis_fenced'});
  await store.del(EPOCH);
  await assert.rejects(cleanupRedisIdentity(input),{code:'account_redis_fenced'});
});

test('captured Lua cannot index or recreate keys after deletion fence/epoch restart; cross-owner writes deny',async()=>{
  const store=await fixture();let captured;
  const original=store.eval;
  store.eval=async function(script,keys,args){if(script.startsWith('-- account-guard:')){captured=[script,keys,args];return 'OK';}return original.call(this,script,keys,args);};
  await put(store,OWNER,keys.profile(OWNER));
  await blockRedisIdentity(OWNER,store);
  await assert.rejects(original.call(store,...captured),{code:'account_redis_fenced'});
  assert.equal(await store.zcard(xpOwnerPrefix(namespace,OWNER)+'keys'),0);
  await store.set(permit(OWNER),'ACTIVE:one');await store.set(EPOCH,'two');
  await assert.rejects(original.call(store,...captured),{code:'account_redis_fenced'});
  await assert.rejects(put(store,OWNER,keys.profile(OTHER)),{code:'account_redis_fenced'});
  await assert.rejects(put(store,OWNER,'kcswh:prod:xp:v3:user:'+OWNER+':total'),{code:'account_redis_fenced'});
});

test('index corruption cannot delete another account or environment',async()=>{
  const store=await fixture();await put(store,OTHER,keys.total(OTHER),'42');
  await store.zadd(xpOwnerPrefix(namespace,OWNER)+'keys',0,keys.total(OTHER));await blockRedisIdentity(OWNER,store);
  await assert.rejects(cleanupRedisIdentity({store,userId:OWNER,env,beginSql:attested()}),/xp_owner_index_corrupt/);
  assert.equal(await store.get(keys.total(OTHER)),'42');
  const index=xpOwnerPrefix(namespace,OWNER)+'keys';
  await store.del(index);await store.zadd(index,0,index);
  await assert.rejects(cleanupRedisIdentity({store,userId:OWNER,env,beginSql:attested()}),/xp_owner_index_corrupt/);
  await assert.rejects(put(store,OTHER,xpOwnerPrefix(namespace,OTHER)+'keys'),{code:'account_redis_fenced'});
});

test('new XP starts at zero despite old totals/markers; real conversion sources only V3 anonymous prefix',async()=>{
  const store=await fixture();await store.set('kcswh:xp:v2:total:'+GUEST,'9000');
  await store.set('kcswh:xp:v2:migration:user:old','999');
  const {migrateAnonXpToUser}=await import('../netlify/functions/_shared/xp-identity.mjs');
  const beginSql=async(fn)=>fn({unsafe:async(sql,params)=>sql.includes('as present')?[{present:params[0]!==GUEST,deleting:false,retired:false}]:[]});
  const empty=await migrateAnonXpToUser({store,namespace,anonId:GUEST,userId:OWNER,conversionCap:100,beginSql});
  assert.equal(empty.converted,0);
  await put(store,GUEST,anon.total(GUEST),'7',{anonymous:true,beginSql});
  const converted=await migrateAnonXpToUser({store,namespace,anonId:GUEST,userId:OWNER,conversionCap:100,beginSql});
  assert.equal(converted.converted,7);
  assert.equal((await migrateAnonXpToUser({store,namespace,anonId:GUEST,userId:OWNER,conversionCap:100,beginSql})).converted,0);
  assert.ok(await store.ttl(keys.migration(GUEST,OWNER))>0);
  const periods=getXpLeaderboardPeriods();
  const originalEval=store.eval;let awardScript;
  store.eval=async function(script,keys,args){if(script.startsWith('-- account-guard:') && script.includes('local sessionKey = KEYS[1]'))awardScript=script;return originalEval.call(this,script,keys,args);};
  const result=await executeAtomicXpAward({store,userId:OWNER,beginSql:active,keys:[keys.session(OWNER,'s'),keys.sessionSync(OWNER,'s'),keys.daily(OWNER,periods.dayKey),keys.total(OWNER),keys.lock(OWNER,'s'),boards.allTime(),boards.day(periods.dayKey),boards.week(periods.weekKey),keys.hidden(OWNER)],args:[Date.now(),5,3000,300,Date.now(),5000,60000,OWNER,periods.dayExpiresAtSec,periods.weekExpiresAtSec]});
  assert.equal(result.lifetime,12);
  // Several private keys + shared boards register in one owner ZADD, without
  // moving registration outside the lifecycle/epoch-fenced script.
  const registration=awardScript.split('-- xp-owner-index-end')[0];
  assert.equal((registration.match(/redis.call\('ZADD'/g)||[]).length,1);
  assert.equal(await store.get('kcswh:xp:v2:total:'+GUEST),'9000');
});

test('XP-only reset manifest is deterministic and preserves mixed profiles, fences and all non-XP',async()=>{
  const {buildLegacyXpResetPlan}=await import('../scripts/ops/xp-redis-reset-plan.mjs');
  const records=[{key:'kcswh:xp:v2:total:'+OWNER,type:'string',value:'99'},
    {key:'kcswh:xp:v2:migration:'+'a'.repeat(64),type:'string',value:'9'},
    {key:'kcswh:xp:v2:leaderboard:v1:all_time',type:'zset',value:[[OWNER,99]]},
    {key:'kcswh:xp:user:'+OWNER,type:'string',value:JSON.stringify({userId:OWNER,totalXp:99,displayName:'Fixture',avatar:'preserve'})},
    {key:'kcswh:xp:user:'+OTHER,type:'string',value:JSON.stringify({userId:OTHER,totalXp:9,createdAt:'old'})},
    ...['auth:users','poker:table','chips:wallet','bonus:proof','archive:receipt',namespace+':user:'+OTHER+':total',EPOCH,'account-deletion:redis:permit:'+OWNER,'kcswh:xp:v2:unknown:mixed'].map(key=>({key,type:'string',value:'preserve'}))];
  for(const record of records){record.pttl=-1;record.capturedAtMs=1000;}
  const plan=buildLegacyXpResetPlan(records);
  assert.notEqual(plan.manifestHash,buildLegacyXpResetPlan(records.map(record=>record.key===records[0].key?{...record,value:"changed"}:record)).manifestHash);
  assert.throws(()=>buildLegacyXpResetPlan([{key:records[0].key,type:"string",value:"99"}]),/snapshot_incomplete/);
  assert.equal(plan.manifestHash,buildLegacyXpResetPlan([...records].reverse()).manifestHash);
  const local=new Map(records.map(record=>[record.key,record.value??'board']));
  for(const action of plan.operations){if(action.operation==='DEL')local.delete(action.key);else local.set(action.key,action.value);}
  assert.equal(local.has('kcswh:xp:v2:total:'+OWNER),false);
  assert.deepEqual(JSON.parse(local.get('kcswh:xp:user:'+OWNER)),{userId:OWNER,totalXp:0,displayName:'Fixture',avatar:'preserve'});
  for(const record of records.filter(record=>!plan.operations.some(action=>action.key===record.key)))assert.equal(local.get(record.key),record.value);
  assert.throws(()=>buildLegacyXpResetPlan([{key:'kcswh:xp:user:unexpected',type:'string',value:'invalid'}]),/unreviewed/);
  assert.throws(()=>buildLegacyXpResetPlan([{key:'kcswh:xp:v2:total:'+OWNER,type:'hash'}]),/unreviewed/);
});

test('V3 stays indexed/fenced when acceptance is OFF, including non-UUID anonymous writes and rate limits',async()=>{
  const store=await fixture();const previous=process.env.ACCOUNT_DELETION_ENABLED;
  const {atomicRateLimitIncr}=await import('../netlify/functions/_shared/store-upstash.mjs');
  try{
    process.env.ACCOUNT_DELETION_ENABLED='0';
    await atomicRateLimitIncr(keys.rateLimit(OWNER,2),60,{store,userId:OWNER,beginSql:active});
    assert.equal(await store.zcard(xpOwnerPrefix(namespace,OWNER)+'keys'),1);
    const guest='guest:non-uuid';let pending;const original=store.eval;
    store.eval=async function(script,keys,args){if(script.startsWith('-- account-guard:')){pending=[script,keys,args];return 'OK';}return original.call(this,script,keys,args);};
    await put(store,guest,anon.serverSession(guest,'sid'),'{}',{anonymous:true,operation:'setex',ttl:60});
    await store.set(EPOCH,'two');
    await assert.rejects(original.call(store,...pending),{code:'account_redis_fenced'});
    assert.equal(await store.get(anon.serverSession(guest,'sid')),null);
  }finally{process.env.ACCOUNT_DELETION_ENABLED=previous;}
});

test('V3 server-session validation/touch isolates UUID, session and identity mode and cannot renew after BLOCKED',async()=>{
  const {store}=await import('../netlify/functions/_shared/store-upstash.mjs');
  const {validateServerSession,touchSession}=await import('../netlify/functions/start-session.mjs');
  await store.set(EPOCH,'one');
  await put(store,OWNER,keys.serverSession(OWNER,'real-sid'),JSON.stringify({userId:OWNER,fingerprint:'fixture',identityMode:'user',createdAt:1,lastActivity:1}),{operation:'setex',ttl:60});
  assert.equal((await validateServerSession({sessionId:'real-sid',userId:OWNER,fingerprint:'fixture'})).valid,true);
  for(const change of [{userId:OTHER},{sessionId:'wrong'},{anonymous:true},{fingerprint:'wrong'}])assert.equal((await validateServerSession({sessionId:'real-sid',userId:OWNER,fingerprint:'fixture',...change})).valid,false);
  assert.equal((await touchSession('real-sid',{userId:OWNER,beginSql:active})).updated,true);
  await blockRedisIdentity(OWNER,store);
  assert.equal((await touchSession('real-sid',{userId:OWNER,beginSql:active})).updated,false);
  await store.del(keys.serverSession(OWNER,'real-sid'));
  assert.equal((await touchSession('real-sid',{userId:OWNER,beginSql:active})).updated,false);
});

test('administrative backfill atomically indexes and expires day/week boards, also for unchanged scores',async()=>{
  const store=await fixture();const periods=getXpLeaderboardPeriods();
  await put(store,OWNER,keys.total(OWNER),'7');await put(store,OWNER,keys.daily(OWNER,periods.dayKey),'7');
  const {runLeaderboardMaintenance}=await import('../netlify/functions/_shared/xp-leaderboard-maintenance.mjs');
  const request={operation:'backfill',dryRun:false,page:1,limit:1};
  const deps={store,namespace,beginSql:active,listProfilesPage:async()=>[OWNER]};
  assert.equal((await runLeaderboardMaintenance(request,deps)).failed,0);
  for(const key of [boards.day(periods.dayKey),boards.week(periods.weekKey)])assert.ok(await store.ttl(key)>0);
  const result=await runLeaderboardMaintenance(request,deps);
  assert.equal(result.failed,0);assert.equal(result.unchanged,3);
  await blockRedisIdentity(OWNER,store);
  assert.equal((await runLeaderboardMaintenance(request,deps)).failed,1);
});

test('immutable V3 artifact pin denies missing/foreign/downgraded runtime config in every deploy context',()=>{
  assert.throws(()=>resolveXpNamespace({},'unknown',{version:null,environment:null}),/xp_redis_v3_required/);
  for(const [environment,contexts] of [['stage',['deploy-preview','branch-deploy','development']],['prod',['production']]]){
    const pin={version:'3',environment};const valid={XP_REDIS_VERSION:'3',XP_REDIS_ENV:environment,XP_KEY_NS:`kcswh:${environment}:xp:v3`};
    for(const context of contexts){
      assert.equal(resolveXpNamespace(valid,context,pin),valid.XP_KEY_NS);
      for(const config of [{},{...valid,XP_KEY_NS:undefined},{...valid,XP_REDIS_ENV:undefined},{...valid,XP_REDIS_VERSION:undefined},{...valid,XP_REDIS_VERSION:'2'},{...valid,XP_KEY_NS:'kcswh:xp:v2'},{...valid,XP_KEY_NS:'kcswh:other:xp:v3'},{...valid,ARCADE_DEPLOY_TARGET:environment==='stage'?'production':'deploy-preview'}])assert.throws(()=>resolveXpNamespace(config,context,pin));
    }
    assert.throws(()=>resolveXpNamespace(valid,'unknown',{version:null,environment:null}),/pin_invalid/);
  }
});

test('existing deploy-context generator bakes validated pins and refuses incomplete V3 builds',async()=>{
  const {mkdtemp,readFile,writeFile,rm,mkdir,copyFile}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');const {spawnSync}=await import('node:child_process');
  const cwd=await mkdtemp(join(tmpdir(),'xp-pin-'));const originalScript=resolve('scripts/generate-build-info.js');
  const script=join(cwd,'generator-with-approved-stage-floor.cjs');
  try{
    const source=(await readFile(originalScript,'utf8')).replace("stage: '2', prod: '2'","stage: '3', prod: '2'");
    await writeFile(script,source);
    const base={...process.env,CONTEXT:'deploy-preview',XP_REDIS_VERSION:'3',XP_REDIS_ENV:'stage',XP_KEY_NS:namespace};
    // Stage V3 is authorized; Production remains V2.
    assert.equal(spawnSync(process.execPath,[originalScript,'--server-context-only'],{cwd,env:base}).status,0);
    assert.equal(spawnSync(process.execPath,[script,'--server-context-only'],{cwd,env:base}).status,0);
    const context=await readFile(join(cwd,'netlify/functions/_generated/deploy-context.mjs'),'utf8');
    assert.match(context,/BUILD_XP_REDIS_VERSION = "3"/);assert.match(context,/BUILD_XP_REDIS_ENV = "stage"/);
    await mkdir(join(cwd,'netlify/functions/_shared'),{recursive:true});
    await copyFile(resolve('netlify/functions/_shared/xp-ledger.mjs'),join(cwd,'netlify/functions/_shared/xp-ledger.mjs'));
    const entry=['--input-type=module','-e','import {resolveXpNamespace} from "./netlify/functions/_shared/xp-ledger.mjs"; resolveXpNamespace();'];
    assert.equal(spawnSync(process.execPath,entry,{cwd,env:{...base,XP_TEST_MODE:'0'}}).status,0);
    assert.notEqual(spawnSync(process.execPath,entry,{cwd,env:{...base,XP_TEST_MODE:'0',XP_REDIS_VERSION:'',XP_REDIS_ENV:'',XP_KEY_NS:''}}).status,0);
    for(const env of [{...base,XP_KEY_NS:''},{...base,XP_REDIS_ENV:''},{...base,XP_REDIS_VERSION:''},{...base,CONTEXT:'production'},{...base,XP_REDIS_VERSION:'',XP_REDIS_ENV:'',XP_KEY_NS:''}])assert.notEqual(spawnSync(process.execPath,[script,'--server-context-only'],{cwd,env}).status,0);
    const preservedPin=await readFile(join(cwd,'netlify/functions/_generated/deploy-context.mjs'),'utf8');
    assert.match(preservedPin,/BUILD_XP_REDIS_VERSION = "3"/);
  }finally{await rm(cwd,{recursive:true,force:true});}
});
