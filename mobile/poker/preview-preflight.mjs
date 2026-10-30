import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import security from './security.cjs';

const repositoryName = 'krzysztofcal/arcadePlatform';
const stage = {supabaseUrl:'https://krydukthwdvccggbyjfw.supabase.co',wsUrl:'wss://ws-preview.kcswh.pl/ws'};
export function needsApk(files) {
  if (!Array.isArray(files) || files.length >= 300 || files.some(file => !file || typeof file.filename !== 'string')) return true;
  return files.some(file => [file.filename,file.previous_filename].filter(Boolean).some(name =>
    name === '.github/workflows/android-poc.yml' || name.startsWith('poker/assets/') ||
    !(/^(docs|specs|tests|ws-tests|\.agents|\.github)\//.test(name) || /\.md$/i.test(name))));
}

// Only completed, nonexpired APKs produced with this PR-aware artifact contract
// can cover a newer docs-only HEAD. API uncertainty always rebuilds.
export async function findCompatibleApk({repository,prNumber,sourceSha,branch,token,fetch=globalThis.fetch}) {
  if(repository!==repositoryName||!Number.isSafeInteger(prNumber)||prNumber<1||!/^[a-f0-9]{40}$/.test(sourceSha||'')||!branch)return null;
  const read=async route=>{
    const r=await fetch(`https://api.github.com/repos/${repository}/${route}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error('artifact_unverified');
    return r.json();
  };
  try{
    const data=await read(`actions/workflows/android-poc.yml/runs?event=pull_request&status=success&branch=${encodeURIComponent(branch)}&per_page=10`);
    for(const run of (data.workflow_runs||[]).slice(0,10)){
      if(run.status!=='completed'||run.conclusion!=='success'||run.event!=='pull_request'||run.path!=='.github/workflows/android-poc.yml'||run.head_branch!==branch||run.repository?.full_name!==repository||run.head_repository?.full_name!==repository||!run.pull_requests?.some(pr=>pr.number===prNumber)||!/^[a-f0-9]{40}$/.test(run.head_sha||''))continue;
      const artifacts=await read(`actions/runs/${run.id}/artifacts?per_page=100`);
      const artifact=artifacts.artifacts?.find(a=>a.name===`arcade-poker-stage-pr-${prNumber}-${run.head_sha}`&&a.expired===false&&a.size_in_bytes>0&&a.workflow_run?.id===run.id&&a.workflow_run.head_sha===run.head_sha&&a.workflow_run.repository_id===run.repository.id&&a.workflow_run.head_repository_id===run.repository.id);
      if(!artifact)continue;
      const comparison=await read(`compare/${run.head_sha}...${sourceSha}`);
      if(!['ahead','identical'].includes(comparison.status)||comparison.base_commit?.sha!==run.head_sha||comparison.merge_base_commit?.sha!==run.head_sha||!(comparison.total_commits<=250)||needsApk(comparison.files))continue;
      return {sourceSha:run.head_sha,runId:run.id,artifactId:artifact.id};
    }
  }catch{/* Missing permissions, incomplete evidence or API failure requires a fresh build. */}
  return null;
}

export async function waitForPreview({repository,prNumber,sourceSha,token,fetch=globalThis.fetch,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxWaitMs=600000,pollMs=20000}) {
  if (repository !== repositoryName || !Number.isSafeInteger(prNumber) || prNumber<1 || !/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('source_pr_changed');
  const origin=`https://deploy-preview-${prNumber}--playkcswh.netlify.app`,started=now(),deadline=started+maxWaitMs;
  const read=async (url,github=false,text=false) => {
    if (now()>=deadline) throw new Error('preview_timeout');
    const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(15000,deadline-now()))),headers:github?{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'}:{'Cache-Control':'no-cache'}});
    if (!r.ok) throw new Error(`preflight_http_${r.status}`);
    return text?r.text():r.json();
  };
  const currentHead=async()=>{
    const pr=await read(`https://api.github.com/repos/${repository}/pulls/${prNumber}`,true);
    if(pr.state!=='open'||!pr.draft||pr.head?.repo?.full_name!==repository||pr.head.sha!==sourceSha)throw new Error('source_pr_changed');
  };
  while(now()<deadline){
    await currentHead();
    const status=await read(`https://api.github.com/repos/${repository}/commits/${sourceSha}/status`,true);
    const preview=status.statuses?.find(s=>s.context==='netlify/playkcswh/deploy-preview');
    if(preview&&['failure','error'].includes(preview.state))throw new Error('preview_failed');
    if(preview?.state==='success'){
      const statusUrl=new URL(preview.target_url);
      if(statusUrl.origin!==origin||!['','/'].includes(statusUrl.pathname)||statusUrl.search||statusUrl.hash)throw new Error('preview_status_origin_invalid');
      const source=await read(`${origin}/js/build-info.js?sha=${sourceSha}`,false,true);
      let build;try{build=JSON.parse(source.match(/window\.BUILD_INFO\s*=\s*(\{[\s\S]*\})\s*;?\s*$/)[1]);}catch{throw new Error('preview_build_info_invalid');}
      if(build.commitHash!==sourceSha||build.context!=='deploy-preview'||Number(build.reviewId)!==prNumber||build.siteName!=='playkcswh'||build.deployUrl!==origin||!/^[a-f0-9]{24}$/.test(build.deployId||''))throw new Error('preview_build_info_mismatch');
      const deploy=await read(`https://api.netlify.com/api/v1/deploys/${build.deployId}`);
      const binding={prNumber,sourceSha,apiOrigin:origin,netlify:{deployId:deploy.id,sourceSha:deploy.commit_ref,reviewId:Number(deploy.review_id),context:deploy.context,state:deploy.state,siteId:deploy.site_id,siteName:deploy.name,origin:deploy.deploy_ssl_url},verifiedAt:new Date().toISOString(),waitMs:now()-started};
      security.forPreview(stage,binding,prNumber,sourceSha);
      const receipt=await read(`${origin}/netlify/functions/_generated/stage-context-receipt.json?sha=${sourceSha}`);
      if(receipt.sourceSha!==sourceSha||receipt.deployId!==deploy.id||receipt.context!=='deploy-preview'||receipt.artifactIdentity!=='netlify-functions'||receipt.origin!==origin||receipt.supabaseProjectRef!=='krydukthwdvccggbyjfw'||receipt.redisVersion!=='3'||receipt.redisEnvironment!=='stage'||receipt.namespace!=='kcswh:stage:xp:v3'||receipt.wsUrl!==stage.wsUrl)throw new Error('preview_stage_receipt_mismatch');
      await currentHead();
      if(now()>=deadline)throw new Error('preview_timeout');
      binding.waitMs=now()-started;
      return binding;
    }
    if(!pollMs)throw new Error('preview_not_ready');
    await sleep(Math.min(pollMs,Math.max(0,deadline-now())));
  }
  throw new Error('preview_timeout');
}

async function main(){
  const event=JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
  const prNumber=Number(process.env.PR_NUMBER),sourceSha=process.env.SOURCE_SHA,repository=process.env.GITHUB_REPOSITORY,token=process.env.GITHUB_TOKEN;
  if(!token||repository!==repositoryName)throw new Error('source_pr_changed');
  const verify=process.argv.includes('--verify');
  const currentSource=async()=>{
    const source=await fetch(`https://api.github.com/repos/${repository}/pulls/${prNumber}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!source.ok)throw new Error(`preflight_http_${source.status}`);
    const pr=await source.json();
    if(pr.state!=='open'||!pr.draft||pr.head?.repo?.full_name!==repository||pr.head.sha!==sourceSha)throw new Error('source_pr_changed');
    return pr;
  };
  const pr=await currentSource();
  if(!verify&&event.action==='synchronize'){
    const existing=await findCompatibleApk({repository,prNumber,sourceSha,branch:pr.head.ref,token});
    if(existing){
      await currentSource();
      await fs.appendFile(process.env.GITHUB_OUTPUT,'build=false\n');
      await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,`APK NOT BUILT: completed compatible artifact ${existing.artifactId} from run ${existing.runId}, actual source ${existing.sourceSha}, covers application inputs at PR #${prNumber} HEAD ${sourceSha}. Original receipt unchanged.\n`);
      process.stdout.write(`[klog] mobile_apk_reused ${JSON.stringify(existing)}\n`);
      return;
    }
  }
  const binding=await waitForPreview({repository,prNumber,sourceSha,token,...(verify?{maxWaitMs:30000,pollMs:0}:{})});
  if(verify){
    const previous=JSON.parse(await fs.readFile(process.env.MOBILE_PREVIEW_BINDING,'utf8'));
    if(previous.netlify.deployId!==binding.netlify.deployId)throw new Error('preview_replaced');
  }else{
    await fs.writeFile(process.env.MOBILE_PREVIEW_BINDING,JSON.stringify(binding,null,2)+'\n');
    await fs.appendFile(process.env.GITHUB_OUTPUT,'build=true\n');
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,`Preview READY: PR #${prNumber}, source ${sourceSha}, deploy ${binding.netlify.deployId}, wait ${binding.waitMs}ms.\n`);
  }
  process.stdout.write(`[klog] mobile_preview_verified ${JSON.stringify({prNumber,sourceSha,deployId:binding.netlify.deployId,waitMs:binding.waitMs})}\n`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
  const safe=/^(source_pr_changed|preview_[a-z_]+|preflight_http_[0-9]+)$/.test(error.message)?error.message:'preview_verification_failed';
  process.stderr.write(`[klog] mobile_preview_not_built ${safe}\n`);process.exitCode=1;
});
