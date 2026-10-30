import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// OWNER-run WWW Production publication of one immutable, already built Netlify deploy (#1159 PR5).
// Precondition: auto publishing is locked. This tool never removes the lock and never builds.
export const SITE = Object.freeze({ id: 'f7e19a84-28f7-41f7-978a-f3b4552a404d', name: 'playkcswh', url: 'https://play.kcswh.pl', ws: 'wss://ws.kcswh.pl/ws' });
export const WS_SURFACE = ['ws-server/', 'shared/', 'poker/poker-ws-client.js'];
const API = 'https://api.netlify.com/api/v1';
const SHA = /^[a-f0-9]{40}$/;
const DEPLOY = /^[a-f0-9]{24}$/;

export const phrase = (mode, sha, deployId) => `${mode === 'rollback' ? 'ROLLBACK' : 'PUBLISH'} WWW PRODUCTION ${sha} ${deployId}`;

export function parseBuildInfo(text) {
  const m = /window\.BUILD_INFO\s*=\s*(\{[\s\S]*\});?\s*$/.exec(String(text || '').trim());
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}

// Pure decision: every failure code, empty when the candidate may be published.
export function candidateFailures({ mode, sha, mainSha, site, deploy, buildInfo, functions, wsSurfaceChanged }) {
  const f = [];
  const add = (ok, code) => { if (!ok) f.push(code); };
  add(mode === 'publish' || mode === 'rollback', 'invalid_mode');
  add(SHA.test(sha || '') && DEPLOY.test(deploy?.id || ''), 'invalid_input');
  add(site?.id === SITE.id && site?.published_deploy?.locked === true, 'auto_publishing_not_locked');
  add(deploy?.site_id === SITE.id && deploy?.context === 'production' && deploy?.branch === 'main' && deploy?.state === 'ready' && !deploy?.review_id, 'not_ready_main_production_deploy');
  add(deploy?.commit_ref === sha, 'deploy_sha_mismatch');
  add(site?.published_deploy?.id !== deploy?.id, 'already_published');
  // Publish only the current approved main HEAD; rollback only to a deploy that was live before.
  if (mode === 'publish') add(mainSha === sha, 'not_current_main_head');
  if (mode === 'rollback') add(!!deploy?.published_at, 'rollback_target_never_published');
  add(buildInfo?.commitHash === sha && buildInfo?.context === 'production' && buildInfo?.deployId === deploy?.id && buildInfo?.siteUrl === SITE.url && buildInfo?.pokerWsUrl === SITE.ws, 'build_info_identity_mismatch');
  const live = (deploy?.available_functions || []).map(x => x.n).sort().join();
  add(!!functions?.length && live === [...functions].sort().join(), 'functions_mismatch');
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

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git_failed:${args[0]}`);
  return r.stdout;
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
export async function publishLocked(api, deployId, recheck) {
  const before = await api.site();
  if (before.published_deploy?.locked !== true) throw new Error('auto_publishing_not_locked');
  await recheck();
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
  return { previousDeployId: before.published_deploy.id, publishedDeployId: deployId, relocked };
}

async function text(url) {
  const r = await fetch(url, { redirect: 'manual', cache: 'no-store' });
  if (r.status !== 200) throw new Error(`smoke_http_${r.status}:${new URL(url).pathname}`);
  return { body: await r.text(), headers: r.headers };
}

async function main(argv, env) {
  const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const mode = argv.includes('--rollback') ? 'rollback' : 'publish';
  const sha = arg('--sha');
  const deployId = arg('--deploy');
  const wsRelease = arg('--ws-release');
  const execute = argv.includes('--execute');
  if (!SHA.test(sha || '') || !DEPLOY.test(deployId || '') || !SHA.test(wsRelease || '')) throw new Error('usage: --sha <40hex> --deploy <24hex> --ws-release <40hex> [--rollback] [--execute --confirm <phrase>] [--receipt <file>]');
  if (execute && arg('--confirm') !== phrase(mode, sha, deployId)) throw new Error('confirmation_mismatch');
  const api = netlifyApi(env.NETLIFY_AUTH_TOKEN);
  git(['fetch', '--quiet', 'origin', 'main', sha]);
  const mainSha = () => git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0];
  const permalink = `https://${deployId}--${SITE.name}.netlify.app`;
  const [site, deploy, info, root] = await Promise.all([api.site(), api.deploy(deployId), text(`${permalink}/js/build-info.js`), text(`${permalink}/`)]);
  const functions = git(['ls-tree', '--name-only', `${sha}:netlify/functions`]).split('\n').filter(n => /\.(m?js|cjs|ts)$/.test(n)).map(n => n.replace(/\.[^.]+$/, ''));
  const wsSurfaceChanged = spawnSync('git', ['diff', '--quiet', wsRelease, sha, '--', ...WS_SURFACE]).status !== 0;
  const failures = [
    ...candidateFailures({ mode, sha, mainSha: mainSha(), site, deploy, buildInfo: parseBuildInfo(info.body), functions, wsSurfaceChanged }),
    ...headerFailures(root.headers, expectedCsp(git(['show', `${sha}:_headers`])))
  ];
  const receipt = { site: SITE.name, mode, sha, deployId, wsRelease, previousDeployId: site.published_deploy?.id || null, checkedAt: new Date().toISOString(), failures, executed: false };
  if (!failures.length && execute) {
    const recheck = async () => { if (mode === 'publish' && mainSha() !== sha) throw new Error('not_current_main_head'); };
    Object.assign(receipt, await publishLocked(api, deployId, recheck), { executed: true });
    const live = parseBuildInfo((await text(`${SITE.url}/js/build-info.js`)).body);
    receipt.liveSmoke = live?.deployId === deployId && live?.commitHash === sha ? 'PASS' : 'FAIL';
    receipt.publishedAt = new Date().toISOString();
  }
  const out = `${JSON.stringify(receipt, null, 2)}\n`;
  if (arg('--receipt')) fs.writeFileSync(arg('--receipt'), out);
  process.stdout.write(out);
  if (failures.length || receipt.liveSmoke === 'FAIL') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).catch(e => { process.stderr.write(`${e.message}\n`); process.exitCode = 1; });
}
