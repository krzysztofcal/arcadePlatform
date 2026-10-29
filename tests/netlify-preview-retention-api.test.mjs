import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runRetention, createRetentionApi, approvalDigest } from '../scripts/netlify-preview-retention.mjs';
const siteId='f7e19a84-28f7-41f7-978a-f3b4552a404d', sha='a'.repeat(40), id=n=>String(n).padStart(24,'0');
const now='2026-10-29T13:00:00Z';
const env={GITHUB_REPOSITORY:'krzysztofcal/arcadePlatform',GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_ACTOR:'krzysztofcal',GITHUB_TRIGGERING_ACTOR:'krzysztofcal',GITHUB_WORKFLOW_REF:'krzysztofcal/arcadePlatform/.github/workflows/netlify-preview-retention.yml@refs/heads/main',NETLIFY_PREVIEW_RETENTION_CANARY_ENABLED:'1'};
const basePins=JSON.parse(fs.readFileSync('specs/1164-netlify-preview-retention/protected-deployments.json','utf8'));
function fixture() {
 const pins={...basePins,canaryDeletionAuthorized:true,productionRotationPass:true,stageRotationPass:true,productionRotationEvidence:'https://github.com/krzysztofcal/arcadePlatform/issues/1164#issuecomment-1',stageRotationEvidence:'https://github.com/krzysztofcal/arcadePlatform/issues/1164#issuecomment-2',apkPinsReviewedAt:now};
 let rows=[1,2].map(n=>({id:id(n),reviewId:10,context:'deploy-preview',siteId,state:'ready',created:`2026-10-0${n}T00:00:00Z`,sha,locked:false,lockKnown:true}));
 const prs={'10':{state:'CLOSED',closedAt:'2026-10-03T00:00:00Z',headRefOid:sha}};let deletes=[],events=[];
 const api={collect:async()=>({inventory:{siteId,complete:true,published:id(100),rows:structuredClone(rows)},pullRequests:structuredClone(prs)}),readMain:async()=>sha,readApkRuns:async()=>[],readPr:async()=>structuredClone(prs['10']),readSite:async()=>({id:siteId,published_deploy:{id:id(100)}}),readDeploy:async value=>structuredClone(rows.find(x=>x.id===value)||null),readAlias:async()=>({deployId:rows.at(-1)?.id,sha}),deleteDeploy:async value=>{events.push('delete');deletes.push(value);rows=rows.filter(x=>x.id!==value);}};
 const approval={sourceSha:sha,pinsSha256:approvalDigest(pins),deployIds:[id(1)],approvedAt:now,apkDependenciesReviewed:true,changeWindowConfirmed:true};
 const options={mode:'apply-canary',pins,env,approval,confirmation:`DELETE PREVIEWS ${siteId} ${approvalDigest(approval)}`,api,now:()=>now,writeReport:()=>events.push('report'),sleep:async()=>{}};
 return {options,api,deletes,events,rows,prs};
}
test('dry-run performs GET-derived collection only; no deletion even when all flags allow',async()=>{
 const h=fixture();const report=await runRetention({...h.options,mode:'dry-run'});assert.equal(h.deletes.length,0);assert.equal(report.mode,'dry-run');assert.equal(report.deleted.length,0);
});
test('unauthorized actor/rerun/ref, disabled gates and stale approval fail before API calls',async()=>{
 const patches=[{env:{...env,GITHUB_ACTOR:'other'}},{env:{...env,GITHUB_TRIGGERING_ACTOR:'other'}},{env:{...env,GITHUB_REF:'refs/heads/feature'}},{env:{...env,NETLIFY_PREVIEW_RETENTION_CANARY_ENABLED:'0'}},{pins:basePins},{confirmation:'wrong'},{approval:{...fixture().options.approval,approvedAt:'2026-10-28T00:00:00Z'}}];
 for(const patch of patches){const h=fixture();h.api.collect=async()=>{throw Error('should_not_collect')};await assert.rejects(()=>runRetention({...h.options,...patch}),/retention_(authorization|approval)/);assert.equal(h.deletes.length,0);}
});
test('authorized exact-ID canary writes audit before DELETE and confirms disappearance',async()=>{
 const h=fixture();const r=await runRetention(h.options);assert.deepEqual(h.deletes,[id(1)]);assert.deepEqual(r.deleted,[id(1)]);assert.ok(h.events.indexOf('report')<h.events.indexOf('delete'));
});
test('fresh lock, publication, alias, PR reopening, APK build and main drift deny deletion',async()=>{
 for(const change of [h=>h.api.readDeploy=async()=>({...h.rows[0],locked:true}),h=>h.api.readDeploy=async()=>({...h.rows[0],lockKnown:false}),h=>h.api.readDeploy=async()=>({...h.rows[0],context:'production'}),h=>h.api.readSite=async()=>({id:siteId,published_deploy:{id:id(101)}}),h=>h.api.readAlias=async()=>({deployId:id(1),sha}),h=>h.api.readPr=async()=>({state:'OPEN',headRefOid:sha}),h=>h.api.readApkRuns=async()=>[{created_at:now}],h=>h.api.readApkRuns=async()=>[{created_at:'2026-10-01T00:00:00Z',run_started_at:'2026-10-01T00:00:00Z',updated_at:now,status:'completed'}],h=>h.api.readMain=async()=>'b'.repeat(40)]) {
  const h=fixture();change(h);await assert.rejects(()=>runRetention(h.options),/retention_/);assert.equal(h.deletes.length,0);
 }
});
test('deleting latest with an older undeleted version and a DELETE timeout stop without retry',async()=>{
 const h=fixture();h.options.approval.deployIds=[id(2)];h.options.confirmation=`DELETE PREVIEWS ${siteId} ${approvalDigest(h.options.approval)}`;await assert.rejects(()=>runRetention(h.options),/retention_/);assert.equal(h.deletes.length,0);
 const k=fixture();let attempts=0;k.api.deleteDeploy=async()=>{attempts++;throw Error('timeout contains private data')};await assert.rejects(()=>runRetention(k.options),/retention_/);assert.equal(attempts,1);
});
test('API client rejects redirects, uses only fixed hosts and never retries DELETE',async()=>{
 const calls=[];const api=createRetentionApi({netlifyToken:'synthetic-private-token',githubToken:'synthetic-github',fetchImpl:async(url,opts)=>{calls.push({url,opts});return {ok:false,status:429}}});
 await assert.rejects(()=>api.deleteDeploy(id(1)),/retention_api_429/);assert.equal(calls.length,1);assert.equal(calls[0].opts.redirect,'error');assert.equal(new URL(calls[0].url).hostname,'api.netlify.com');assert.equal(calls[0].opts.method,'DELETE');
});
test('workflow and versioned pins ship disabled, without schedule/PR credential execution',()=>{
 const s=fs.readFileSync('.github/workflows/netlify-preview-retention.yml','utf8');assert.doesNotMatch(s,/^\s*(schedule|pull_request|push):/m);assert.match(s,/ref: \$\{\{ github.sha \}\}/);assert.match(s,/GITHUB_TRIGGERING_ACTOR|github.triggering_actor/);assert.equal(basePins.canaryDeletionAuthorized,false);assert.equal(basePins.productionRotationPass,false);assert.equal(basePins.stageRotationPass,false);
});

test('read-only adapter normalizes real API shapes and alias lookup never receives API credentials',async()=>{
 const calls=[];
 const api=createRetentionApi({netlifyToken:'synthetic-private-token',githubToken:'synthetic-github',fetchImpl:async(url,opts)=>{
  calls.push({url,opts});let body;
  if(url.includes('--playkcswh.netlify.app/'))return {ok:true,status:200,text:async()=>`window.BUILD_INFO = ${JSON.stringify({deployId:id(1),commitHash:sha})};`};
  if(url.includes('/sites/'+siteId+'/deploys?'))body=[{id:id(1),site_id:siteId,context:'deploy-preview',state:'ready',review_id:10,created_at:'2026-10-01T00:00:00Z',commit_ref:sha,locked:null}];
  else if(url.includes('/sites/'+siteId))body={id:siteId,published_deploy:{id:id(100)}};
  else if(url.includes('/pulls?'))body=[{number:10,state:'closed',closed_at:'2026-10-02T00:00:00Z',head:{sha}}];
  else throw Error('unexpected route');
  return {ok:true,status:200,json:async()=>body};
 }});
 const state=await api.collect();assert.equal(state.inventory.rows[0].lockKnown,true);assert.equal(state.inventory.rows[0].locked,false);assert.equal(state.pullRequests['10'].state,'CLOSED');
 assert.deepEqual(await api.readAlias(10),{deployId:id(1),sha});
 const publicCall=calls.find(c=>c.url.includes('--playkcswh.netlify.app/'));assert.equal(publicCall.opts.headers.Authorization,undefined);assert.ok(calls.every(c=>c.opts.method==='GET'));
});
