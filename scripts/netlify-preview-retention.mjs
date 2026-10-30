import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { planPreviewRetention } from './netlify-preview-retention-plan.mjs';
const REPO='krzysztofcal/arcadePlatform', OWNER='krzysztofcal';
const SITE='f7e19a84-28f7-41f7-978a-f3b4552a404d';
const PINS='specs/1164-netlify-preview-retention/protected-deployments.json';
const fail=code=>{throw Error('retention_'+code)};
const need=(value,code)=>{if(!value)fail(code)};
const validId=value=>typeof value==='string'&&/^[a-f0-9]{24}$/.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
function canonical(value){return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;}
export const approvalDigest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function trusted(env){return env.GITHUB_REPOSITORY===REPO&&env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.GITHUB_WORKFLOW_REF===`${REPO}/.github/workflows/netlify-preview-retention.yml@refs/heads/main`&&sha(env.GITHUB_SHA)&&(!env.GITHUB_WORKFLOW_SHA||env.GITHUB_WORKFLOW_SHA===env.GITHUB_SHA);}
function validatePins(pins){
 need(pins.schemaVersion===1&&pins.siteId===SITE&&Array.isArray(pins.rules)&&pins.rules.length,'pins_invalid');
 need(pins.rules.every(p=>typeof p.reason==='string'&&p.reason.length>0&&((validId(p.deployId)&&p.reviewId==null)||(Number.isSafeInteger(p.reviewId)&&p.reviewId>0&&!p.deployId))),'pins_invalid');
}
function authorize({pins,env,approval,confirmation,now}){
 need(trusted(env)&&env.GITHUB_ACTOR===OWNER&&env.GITHUB_TRIGGERING_ACTOR===OWNER&&env.NETLIFY_PREVIEW_RETENTION_CANARY_ENABLED==='1','authorization_denied');
 const evidence=value=>typeof value==='string'&&value.startsWith(`https://github.com/${REPO}/`);
 need(pins.canaryDeletionAuthorized===true&&pins.productionRotationPass===true&&pins.stageRotationPass===true&&evidence(pins.productionRotationEvidence)&&evidence(pins.stageRotationEvidence),'authorization_rotations_disabled');
 const time=Date.parse(now()),approved=Date.parse(approval?.approvedAt),apk=Date.parse(pins.apkPinsReviewedAt);
 need(approval?.sourceSha===env.GITHUB_SHA&&approval.pinsSha256===approvalDigest(pins)&&approval.apkDependenciesReviewed===true&&approval.changeWindowConfirmed===true&&Number.isFinite(approved)&&time>=approved&&time-approved<=15*60*1000&&Number.isFinite(apk)&&apk<=time,'approval_invalid');
 need(Array.isArray(approval.deployIds)&&approval.deployIds.length>0&&approval.deployIds.length<=5&&new Set(approval.deployIds).size===approval.deployIds.length&&approval.deployIds.every(validId),'approval_ids_invalid');
 need(confirmation===`DELETE PREVIEWS ${SITE} ${approvalDigest(approval)}`,'approval_confirmation_invalid');
}
export function createRetentionApi({netlifyToken,githubToken,fetchImpl=fetch}){
 need(netlifyToken&&githubToken,'credentials_missing');
 async function request(host,route,{method='GET',body,missing=false,publicRequest=false}={}){
  const base=host==='netlify'?'https://api.netlify.com/api/v1/':'https://api.github.com/';
  const url=publicRequest?route:base+route;
  if(publicRequest)need(/^https:\/\/deploy-preview-[1-9][0-9]*--playkcswh\.netlify\.app\/js\/build-info\.js\?/.test(url),'alias_url_invalid');
  const headers=publicRequest?{'cache-control':'no-cache'}:{Authorization:`Bearer ${host==='netlify'?netlifyToken:githubToken}`,Accept:'application/json'};
  if(body)headers['content-type']='application/json';
  let r;try{r=await fetchImpl(url,{method,headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),...(body?{body:JSON.stringify(body)}:{})});}catch{fail('api_transport_failed')}
  if(missing&&r.status===404)return null;
  if(!r.ok)fail(`api_${r.status}`);
  if(method==='DELETE')return null;
  try{return publicRequest?await r.text():await r.json();}catch{fail('api_response_invalid')}
 }
 async function pages(host,route,field=null){
  const result=[];
  for(let page=1;page<=100;page++){
   const data=await request(host,`${route}${route.includes('?')?'&':'?'}per_page=100&page=${page}`);
   const rows=field?data[field]:data;
   need(Array.isArray(rows),'pagination_invalid');result.push(...rows);if(rows.length<100)return result;
  }fail('pagination_incomplete');
 }
 const normalizePr=p=>({state:p.state==='open'?'OPEN':p.merged_at?'MERGED':'CLOSED',closedAt:p.closed_at,headRefOid:p.head?.sha});
 const normalize=d=>({id:d.id,siteId:d.site_id,context:d.context,state:d.state,reviewId:d.review_id,created:d.created_at,sha:d.commit_ref,locked:d.locked===true,lockKnown:Object.hasOwn(d,'locked')});
 const api={
  readSite:()=>request('netlify',`sites/${SITE}`),
  readMain:async()=>{const r=await request('github',`repos/${REPO}/git/ref/heads/main`);return r.object?.sha;},
  readPr:async n=>{need(Number.isSafeInteger(Number(n))&&Number(n)>0,'pr_id_invalid');return normalizePr(await request('github',`repos/${REPO}/pulls/${n}`));},
  readDeploy:async id=>{need(validId(id),'deploy_id_invalid');const d=await request('netlify',`deploys/${id}`,{missing:true});return d?normalize(d):null;},
  readApkRuns:()=>pages('github',`repos/${REPO}/actions/workflows/android-poc.yml/runs`,'workflow_runs'),
  readAlias:async n=>{need(Number.isSafeInteger(Number(n))&&Number(n)>0,'pr_id_invalid');const text=await request('netlify',`https://deploy-preview-${n}--playkcswh.netlify.app/js/build-info.js?retention=${Date.now()}`,{publicRequest:true});const match=text.match(/window\.BUILD_INFO\s*=\s*(\{[\s\S]*\})\s*;/);need(match,'alias_unknown');let info;try{info=JSON.parse(match[1]);}catch{fail('alias_unknown')}return {deployId:info.deployId,sha:info.commitHash};},
  deleteDeploy:async id=>{need(validId(id),'deploy_id_invalid');await request('netlify',`deploys/${id}`,{method:'DELETE'});},
  collect:async()=>{
   const site=await api.readSite();need(site.id===SITE&&validId(site.published_deploy?.id),'site_invalid');
   const rows=(await pages('netlify',`sites/${SITE}/deploys`)).map(normalize);need(rows.every(d=>d.siteId===SITE),'site_invalid');
   const prs=await pages('github',`repos/${REPO}/pulls?state=all`);
   return {inventory:{siteId:SITE,complete:true,published:site.published_deploy.id,rows},pullRequests:Object.fromEntries(prs.map(p=>[String(p.number),normalizePr(p)]))};
  }
 };return api;
}
export async function runRetention({mode='dry-run',pins,env=process.env,approval=null,confirmation='',api,now=()=>new Date().toISOString(),writeReport=()=>{},sleep=delay}){
 validatePins(pins);need(['dry-run','apply-canary'].includes(mode),'mode_invalid');
 if(mode==='apply-canary')authorize({pins,env,approval,confirmation,now});
 else need(trusted(env),'authorization_trusted_main_required');
 const state=await api.collect();
 const plan=planPreviewRetention({...state,pins,asOf:now()});
 const report={mode,sourceSha:env.GITHUB_SHA,pinsSha256:approvalDigest(pins),plan,attempted:[],deleted:[],pendingDelete:null,error:null};
 writeReport(report);
 if(mode==='dry-run')return report;
 try{
  const ordered=plan.rows.filter(r=>approval.deployIds.includes(r.id));
  need(ordered.length===approval.deployIds.length&&ordered.every(r=>r.decision==='CANDIDATE_ESTIMATE'),'candidate_not_eligible');
  for(const selected of ordered){
   authorize({pins,env,approval,confirmation,now});
   need(await api.readMain()===env.GITHUB_SHA,'main_drift');
   const runs=await api.readApkRuns();need(Array.isArray(runs)&&runs.every(r=>r.status==='completed'&&[r.created_at,r.run_started_at,r.updated_at].every(t=>Number.isFinite(Date.parse(t))&&Date.parse(t)<Date.parse(pins.apkPinsReviewedAt))),'apk_review_stale');
   const fresh=await api.collect();
   need(fresh.inventory.published===state.inventory.published,'publication_drift');
   need(fresh.inventory.rows.every(d=>['ready','error','canceled','skipped','rejected'].includes(d.state)),'deploy_in_progress');
   const pr=await api.readPr(selected.reviewId);need(approvalDigest(pr)===approvalDigest(state.pullRequests[String(selected.reviewId)]),'pr_drift');
   const policy=planPreviewRetention({...fresh,pins,asOf:now()});need(policy.rows.find(r=>r.id===selected.id)?.decision==='CANDIDATE_ESTIMATE','candidate_not_eligible');
   const before=state.inventory.rows.find(d=>d.id===selected.id),d=await api.readDeploy(selected.id),site=await api.readSite();
   need(site.id===SITE&&site.published_deploy?.id===state.inventory.published,'publication_drift');
   need(d&&sha(d.sha)&&d.siteId===SITE&&d.context==='deploy-preview'&&d.state==='ready'&&d.lockKnown===true&&d.locked===false&&d.reviewId===before.reviewId&&d.created===before.created&&d.sha===before.sha&&d.id!==site.published_deploy.id,'deploy_drift');
   const group=fresh.inventory.rows.filter(x=>String(x.reviewId)===String(d.reviewId)&&x.context==='deploy-preview'&&x.state==='ready').sort((a,b)=>Date.parse(b.created)-Date.parse(a.created));
   const alias=await api.readAlias(d.reviewId);need(validId(alias.deployId)&&sha(alias.sha)&&alias.deployId===group[0]?.id&&alias.sha===group[0]?.sha,'alias_drift');
   if(alias.deployId===d.id)need(pr.state!=='OPEN'&&group.length===1,'alias_fallback');
   report.pendingDelete=d.id;report.attempted.push(d.id);writeReport(report);
   try{await api.deleteDeploy(d.id);}catch{fail('delete_uncertain')}
   let gone=false;for(let check=0;check<5;check++){if(await api.readDeploy(d.id)===null){gone=true;break;}await sleep(1000);}
   need(gone,'delete_not_confirmed');report.deleted.push(d.id);report.pendingDelete=null;writeReport(report);
   need((await api.readSite()).published_deploy?.id===state.inventory.published,'publication_drift');
  }
  return report;
 }catch(error){report.error=/^retention_[a-z0-9_]+$/.test(error.message)?error.message:'retention_operation_failed';writeReport(report);throw Error(report.error);}
}
async function main(){
 const mode=process.env.RETENTION_OPERATION||'dry-run';
 const pins=JSON.parse(fs.readFileSync(PINS,'utf8'));
 let approval=null;try{if(process.env.RETENTION_APPROVAL)approval=JSON.parse(process.env.RETENTION_APPROVAL);}catch{fail('approval_invalid')}
 const api=createRetentionApi({netlifyToken:process.env.NETLIFY_PREVIEW_RETENTION_TOKEN,githubToken:process.env.GITHUB_TOKEN});
 const writeReport=report=>{fs.mkdirSync('retention-artifacts',{recursive:true});fs.writeFileSync('retention-artifacts/report.json',JSON.stringify(report,null,2)+'\n');};
 const report=await runRetention({mode,pins,approval,confirmation:process.env.RETENTION_CONFIRMATION||'',api,writeReport});
 process.stdout.write(`[klog] netlify_preview_retention ${JSON.stringify({mode,counts:report.plan.counts,deleted:report.deleted.length})}\n`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{const code=/^retention_[a-z0-9_]+$/.test(error.message)?error.message:'retention_failed';process.stderr.write(`[klog] ${code}\n`);process.exitCode=1;});
