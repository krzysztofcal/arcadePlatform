import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForPreview, needsApk, findCompatibleApk } from '../mobile/poker/preview-preflight.mjs';
const repository='krzysztofcal/arcadePlatform',sourceSha='a'.repeat(40),prNumber=1160,origin='https://deploy-preview-1160--playkcswh.netlify.app';
function fixture({states=['pending','success'],head=sourceSha,deployPatch={},buildPatch={}}={}) {
  let statusReads=0,time=0,prReads=0;
  const fetch=async (url,options={})=>{
    let data;
    if(url.includes('/pulls/')){prReads++;data={state:'open',draft:true,head:{sha:typeof head==='function'?head(prReads):head,repo:{full_name:repository}}};}
    else if(url.includes('/status'))data={statuses:[{context:'netlify/playkcswh/deploy-preview',state:states[Math.min(statusReads++,states.length-1)],target_url:origin}]};
    else if(url.includes('/js/build-info.js'))return new Response('window.BUILD_INFO = '+JSON.stringify({commitHash:sourceSha,context:'deploy-preview',reviewId:prNumber,siteName:'playkcswh',deployId:'6ae3c8f8dfcc32f97a6aba47',deployUrl:origin,...buildPatch})+';');
    else if(url.includes('/stage-context-receipt.json'))data={sourceSha,deployId:'6ae3c8f8dfcc32f97a6aba47',context:'deploy-preview',artifactIdentity:'netlify-functions',origin,supabaseProjectRef:'krydukthwdvccggbyjfw',redisVersion:'3',redisEnvironment:'stage',namespace:'kcswh:stage:xp:v3',wsUrl:'wss://ws-preview.kcswh.pl/ws'};
    else {assert.equal(options.headers?.Authorization,undefined,'GitHub token must never reach Netlify');data={id:'6ae3c8f8dfcc32f97a6aba47',state:'ready',context:'deploy-preview',commit_ref:sourceSha,review_id:prNumber,site_id:'f7e19a84-28f7-41f7-978a-f3b4552a404d',name:'playkcswh',deploy_ssl_url:origin,...deployPatch};}
    return new Response(JSON.stringify(data));
  };
  return { options:{repository,prNumber,sourceSha,fetch,token:'synthetic-read-token',now:()=>time,sleep:async ms=>{time+=ms},maxWaitMs:40000,pollMs:20000},reads:()=>statusReads };
}
test('pending→ready waits once, binds stacked child and rechecks actual head',async()=>{
  const x=fixture();const b=await waitForPreview(x.options);assert.equal(x.reads(),2);assert.equal(b.prNumber,1160);assert.equal(b.apiOrigin,origin);assert.equal(b.sourceSha,sourceSha);assert.equal(b.waitMs,20000);
});
test('bad deployment/source/site/context/parent origin fail closed',async()=>{
  for(const patch of [{commit_ref:'b'.repeat(40)},{review_id:1155},{site_id:'foreign'},{context:'production'},{deploy_ssl_url:'https://play.kcswh.pl'},{deploy_ssl_url:'https://deploy-preview-1155--playkcswh.netlify.app'}])await assert.rejects(waitForPreview(fixture({states:['success'],deployPatch:patch}).options));
});
test('stale HEAD, foreign repository, failed preview and timeout do not build',async()=>{
  await assert.rejects(waitForPreview(fixture({head:'b'.repeat(40)}).options),/source_pr_changed/);
  await assert.rejects(waitForPreview(fixture({head:n=>n>1?'b'.repeat(40):sourceSha}).options),/source_pr_changed/);
  await assert.rejects(waitForPreview(fixture({states:['success'],head:n=>n>1?'b'.repeat(40):sourceSha}).options),/source_pr_changed/);
  await assert.rejects(waitForPreview({...fixture().options,repository:'foreign/repo'}),/source_pr_changed/);
  await assert.rejects(waitForPreview(fixture({states:['failure']}).options),/preview_failed/);
  await assert.rejects(waitForPreview(fixture({states:['pending']}).options),/preview_timeout/);
});
test('input classification excludes docs/tests but includes packaged and unknown inputs',()=>{
  assert.equal(needsApk([{filename:'specs/1159/report.md'},{filename:'tests/mobile-poker-security.test.mjs'}]),false);
  assert.equal(needsApk([{filename:'mobile/poker/README.md'}]),false);
  assert.equal(needsApk([{filename:'js/account-page.js'}]),true);
  assert.equal(needsApk([{filename:'.github/workflows/android-poc.yml'}]),true);
  assert.equal(needsApk([{filename:'unclassified-input.bin'}]),true);
  assert.equal(needsApk([{filename:'docs/renamed.md',previous_filename:'poker/assets/table.png'}]),true);
  assert.equal(needsApk([{filename:'poker/assets/catalog.md'}]),true);
  assert.equal(needsApk(null),true);
  assert.equal(needsApk([{}]),true);
});

function artifactFixture({status='completed',conclusion='success',artifact=true,expired=false,files=[{filename:'specs/report.md'}],runPatch={},artifactPatch={},comparisonPatch={}}={}) {
  const run={id:42,status,conclusion,event:'pull_request',path:'.github/workflows/android-poc.yml',head_sha:sourceSha,head_branch:'feature',repository:{id:1,full_name:repository},head_repository:{full_name:repository},pull_requests:[{number:prNumber}],...runPatch};
  const entry={id:7,name:`arcade-poker-stage-pr-${prNumber}-${sourceSha}`,expired,size_in_bytes:100,workflow_run:{id:42,head_sha:sourceSha,repository_id:1,head_repository_id:1},...artifactPatch};
  const fetch=async url=>new Response(JSON.stringify(url.includes('/artifacts')?{artifacts:artifact?[entry]:[]}:url.includes('/compare/')?{status:'ahead',base_commit:{sha:sourceSha},merge_base_commit:{sha:sourceSha},total_commits:1,files,...comparisonPatch}:{workflow_runs:[run]}));
  return {repository,prNumber,sourceSha:'b'.repeat(40),branch:'feature',token:'synthetic-read-token',fetch};
}
test('app A building then docs B must build unless a completed compatible APK exists',async()=>{
  for(const options of [{status:'in_progress',conclusion:null},{conclusion:'cancelled'},{artifact:false},{expired:true}]) {
    assert.equal(await findCompatibleApk(artifactFixture(options)),null,'B must build after incomplete/cancelled/missing/expired A');
  }
  const proof=await findCompatibleApk(artifactFixture());
  assert.deepEqual(proof,{sourceSha,runId:42,artifactId:7},'ready A covers docs B but keeps its actual A provenance');
  assert.equal(await findCompatibleApk(artifactFixture({files:[{filename:'js/account-page.js'}]})),null,'A cannot cover changed app inputs');
});
test('uncertain or foreign artifact provenance never permits skipping compilation',async()=>{
  for(const patch of [{name:`arcade-poker-stage-${sourceSha}`},{workflow_run:{id:99}},{size_in_bytes:0}])assert.equal(await findCompatibleApk(artifactFixture({artifactPatch:patch})),null);
  for(const patch of [{pull_requests:[{number:1155}]},{head_branch:'other'},{head_repository:{full_name:'foreign/repo'}}])assert.equal(await findCompatibleApk(artifactFixture({runPatch:patch})),null);
  for(const patch of [{status:'diverged'},{total_commits:251},{files:null},{merge_base_commit:{sha:'c'.repeat(40)}}])assert.equal(await findCompatibleApk(artifactFixture({comparisonPatch:patch})),null);
  assert.equal(await findCompatibleApk({...artifactFixture(),fetch:async()=>{throw new Error('synthetic API failure');}}),null);
});
