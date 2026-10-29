import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForPreview, needsApk } from '../mobile/poker/preview-preflight.mjs';
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
test('known docs/test-only synchronize skips compile; app and unknown inputs rebuild',()=>{
  assert.equal(needsApk([{filename:'specs/1159/report.md'},{filename:'tests/mobile-poker-security.test.mjs'}]),false);
  assert.equal(needsApk([{filename:'mobile/poker/README.md'}]),false);
  assert.equal(needsApk([{filename:'js/account-page.js'}]),true);
  assert.equal(needsApk([{filename:'.github/workflows/android-poc.yml'}]),true);
  assert.equal(needsApk([{filename:'unclassified-input.bin'}]),true);
  assert.equal(needsApk([{filename:'docs/renamed.md',previous_filename:'poker/assets/table.png'}]),true);
  assert.equal(needsApk(null),true);
  assert.equal(needsApk([{}]),true);
});
