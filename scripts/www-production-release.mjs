import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// OWNER-run WWW Production publication of one immutable, already built Netlify deploy (#1159 PR5).
// Precondition: auto publishing is locked. This tool never removes the lock, never builds and has no rollback mode.
export const SITE = Object.freeze({ id: 'f7e19a84-28f7-41f7-978a-f3b4552a404d', name: 'playkcswh', url: 'https://play.kcswh.pl', ws: 'wss://ws.kcswh.pl/ws' });
export const WS_SURFACE = ['ws-server/', 'shared/', 'poker/poker-ws-client.js'];
// Partial by design: redirects, function code digests and runtime Supabase/Redis identity are not verified here.
export const CHECKED = ['deploy-metadata', 'build-info-identity', 'function-names', 'root-csp-hsts', 'ws-release-evidence'];
const API = 'https://api.netlify.com/api/v1';
const SHA = /^[a-f0-9]{40}$/;
const DEPLOY = /^[a-f0-9]{24}$/;

export const phrase = (sha, deployId) => `PUBLISH WWW PRODUCTION ${sha} ${deployId}`;

export function parseBuildInfo(text) {
  const m = /window\.BUILD_INFO\s*=\s*(\{[\s\S]*\});?\s*$/.exec(String(text || '').trim());
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}

// Active WS Production SHA = the most recently started, non-skipped WS `deploy` job on main (any attempt), only if it succeeded.
// A later failed, cancelled or running deploy makes the live release uncertain.
export function activeWsRelease(runs) {
  const jobs = runs.flatMap(r => (r.jobs || []).filter(j => j.name === 'deploy' && j.conclusion !== 'skipped' && j.started_at).map(j => ({ ...j, sha: r.head_sha })));
  const last = jobs.sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
  return last?.status === 'completed' && last.conclusion === 'success' && SHA.test(last.sha) ? last.sha : null;
}

// Pure decision: every failure code, empty when the candidate may be published.
export function candidateFailures({ sha, mainSha, site, deploy, buildInfo, functions, wsRelease, wsSurfaceChanged }) {
  const f = [];
  const add = (ok, code) => { if (!ok) f.push(code); };
  add(SHA.test(sha || '') && DEPLOY.test(deploy?.id || ''), 'invalid_input');
  add(site?.id === SITE.id && site?.published_deploy?.locked === true, 'auto_publishing_not_locked');
  add(deploy?.site_id === SITE.id && deploy?.context === 'production' && deploy?.branch === 'main' && deploy?.state === 'ready' && !deploy?.review_id, 'not_ready_main_production_deploy');
  add(deploy?.commit_ref === sha, 'deploy_sha_mismatch');
  add(site?.published_deploy?.id !== deploy?.id, 'already_published');
  add(mainSha === sha, 'not_current_main_head');
  add(buildInfo?.commitHash === sha && buildInfo?.context === 'production' && buildInfo?.deployId === deploy?.id && buildInfo?.siteUrl === SITE.url && buildInfo?.pokerWsUrl === SITE.ws, 'build_info_identity_mismatch');
  const live = (deploy?.available_functions || []).map(x => x.n).sort().join();
  add(!!functions?.length && live === [...functions].sort().join(), 'functions_mismatch');
  add(SHA.test(wsRelease || ''), 'ws_release_unproven');
  add(wsSurfaceChanged === false, 'ws_release_incompatible');
  return f;
}

export function headerFailures(headers, expectedCsp) {
  const f = [];
  if (!expectedCsp || headers.get('content-security-policy') !== expectedCsp) f.push('csp_mismatch');
  if (!/max-age=\d+/.test(headers.get('strict-transport-security') || '')) f.push('hsts_missing');
  return f;
}

export const expectedCsp = headersFile => (/^\s*Content-Security-Policy:\s*(.+)$/m.exec(headersFile || '') || [])[1]?.trim() || null;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd}_failed:${args[0]}`);
  return r.stdout;
}

function wsRuns() {
  const runs = JSON.parse(run('gh', ['api', 'repos/krzysztofcal/arcadePlatform/actions/workflows/ws-server-deploy.yml/runs?branch=main&per_page=50'])).workflow_runs;
  return runs.filter(r => r.event !== 'pull_request').map(r => ({ head_sha: r.head_sha, jobs: JSON.parse(run('gh', ['api', `repos/krzysztofcal/arcadePlatform/actions/runs/${r.id}/jobs?filter=all&per_page=100`])).jobs }));
}

export function netlifyApi(token, fetchImpl = fetch) {
  if (!token) throw new Error('netlify_token_missing');
  const call = async (method, path) => {
    const r = await fetchImpl(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`netlify_api_${r.status}`);
    return r.json();
  };
  return {
    site: () => call('GET', `/sites/${SITE.id}`),
    deploy: id => call('GET', `/deploys/${id}`),
    restore: id => call('POST', `/sites/${SITE.id}/deploys/${id}/restore`),
    lock: id => call('POST', `/deploys/${id}/lock`)
  };
}

// Publishes, then requires the site to stay locked on exactly the target; relocks once if Netlify dropped the lock.
// Any error from the restore call onwards is marked uncertain: the live state must be read, not assumed.
export async function publishLocked(api, deployId, recheck) {
  const before = await api.site();
  if (before.published_deploy?.locked !== true) throw new Error('auto_publishing_not_locked');
  await recheck();
  try {
    await api.restore(deployId);
    let after = await api.site();
    let relocked = false;
    if (after.published_deploy?.id === deployId && after.published_deploy?.locked !== true) {
      await api.lock(deployId);
      relocked = true;
      after = await api.site();
    }
    if (after.published_deploy?.id !== deployId) throw new Error('published_deploy_mismatch');
    if (after.published_deploy?.locked !== true) throw new Error('lock_not_restored');
    return { previousDeployId: before.published_deploy.id, relocked };
  } catch (e) {
    e.uncertain = true;
    throw e;
  }
}

async function text(url) {
  const r = await fetch(url, { redirect: 'manual', cache: 'no-store' });
  if (r.status !== 200) throw new Error(`smoke_http_${r.status}:${new URL(url).pathname}`);
  return { body: await r.text(), headers: r.headers };
}

async function main(argv, env) {
  const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const sha = arg('--sha');
  const deployId = arg('--deploy');
  const execute = argv.includes('--execute');
  if (!SHA.test(sha || '') || !DEPLOY.test(deployId || '')) throw new Error('usage: --sha <40hex> --deploy <24hex> [--execute --confirm <phrase>] [--receipt <file>]');
  if (execute && arg('--confirm') !== phrase(sha, deployId)) throw new Error('confirmation_mismatch');
  const api = netlifyApi(env.NETLIFY_AUTH_TOKEN);
  const receipt = { site: SITE.name, sha, deployId, checked: CHECKED, startedAt: new Date().toISOString(), status: 'not_published', failures: [] };
  const finish = () => {
    const out = `${JSON.stringify(receipt, null, 2)}\n`;
    if (arg('--receipt')) fs.writeFileSync(arg('--receipt'), out);
    process.stdout.write(out);
    if (receipt.status !== (execute ? 'published' : 'dry_run_pass')) process.exitCode = 1;
  };
  try {
    run('git', ['fetch', '--quiet', 'origin', 'main', sha]);
    const mainSha = () => run('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0];
    const permalink = `https://${deployId}--${SITE.name}.netlify.app`;
    const [site, deploy, info, root] = await Promise.all([api.site(), api.deploy(deployId), text(`${permalink}/js/build-info.js`), text(`${permalink}/`)]);
    const functions = run('git', ['ls-tree', '--name-only', `${sha}:netlify/functions`]).split('\n').filter(n => /\.(m?js|cjs|ts)$/.test(n)).map(n => n.replace(/\.[^.]+$/, ''));
    receipt.wsRelease = activeWsRelease(wsRuns());
    receipt.previousDeployId = site.published_deploy?.id || null;
    const wsSurfaceChanged = receipt.wsRelease ? spawnSync('git', ['diff', '--quiet', receipt.wsRelease, sha, '--', ...WS_SURFACE]).status !== 0 : null;
    receipt.failures = [
      ...candidateFailures({ sha, mainSha: mainSha(), site, deploy, buildInfo: parseBuildInfo(info.body), functions, wsRelease: receipt.wsRelease, wsSurfaceChanged }),
      ...headerFailures(root.headers, expectedCsp(run('git', ['show', `${sha}:_headers`])))
    ];
    if (receipt.failures.length) receipt.status = 'checks_failed';
    else if (!execute) receipt.status = 'dry_run_pass';
    else {
      const recheck = async () => { if (mainSha() !== sha) throw new Error('not_current_main_head'); };
      Object.assign(receipt, await publishLocked(api, deployId, recheck));
      const live = await text(`${SITE.url}/js/build-info.js?release=${deployId}`).then(r => parseBuildInfo(r.body), () => null);
      receipt.status = live?.deployId === deployId && live?.commitHash === sha ? 'published' : 'published_smoke_failed';
    }
  } catch (e) {
    receipt.error = e.message;
    receipt.status = e.uncertain ? 'uncertain' : 'not_published';
    if (e.uncertain) receipt.observed = await api.site().then(s => ({ deployId: s.published_deploy?.id, locked: s.published_deploy?.locked }), () => null);
  }
  receipt.finishedAt = new Date().toISOString();
  finish();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).catch(e => { process.stderr.write(`${e.message}\n`); process.exitCode = 1; });
}
