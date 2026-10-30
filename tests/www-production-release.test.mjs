import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SITE, activeWsRelease, candidateFailures, expectedCsp, headerFailures, parseBuildInfo, phrase, publishLocked } from '../scripts/www-production-release.mjs';

const sha = 'a'.repeat(40);
const ws = 'f'.repeat(40);
const id = 'b'.repeat(24);
const live = 'c'.repeat(24);
const base = () => ({
  sha, mainSha: sha,
  site: { id: SITE.id, published_deploy: { id: live, locked: true } },
  deploy: { id, site_id: SITE.id, context: 'production', branch: 'main', state: 'ready', review_id: null, commit_ref: sha, available_functions: [{ n: 'b' }, { n: 'a' }] },
  buildInfo: { commitHash: sha, context: 'production', deployId: id, siteUrl: SITE.url, pokerWsUrl: SITE.ws },
  functions: ['a', 'b'], wsRelease: ws, wsSurfaceChanged: false
});
const with_ = (patch) => { const c = base(); patch(c); return candidateFailures(c); };

test('exact locked main production candidate passes', () => {
  assert.deepEqual(candidateFailures(base()), []);
  assert.equal(phrase(sha, id), `PUBLISH WWW PRODUCTION ${sha} ${id}`);
});

test('candidate fails closed on lock, context, stale SHA, identity, functions and WS', () => {
  assert.deepEqual(with_(c => { c.site.published_deploy.locked = false; }), ['auto_publishing_not_locked']);
  assert.ok(with_(c => { c.deploy.context = 'deploy-preview'; }).includes('not_ready_main_production_deploy'));
  assert.ok(with_(c => { c.deploy.review_id = 7; }).includes('not_ready_main_production_deploy'));
  assert.deepEqual(with_(c => { c.mainSha = 'd'.repeat(40); }), ['not_current_main_head']);
  assert.ok(with_(c => { c.deploy.commit_ref = 'd'.repeat(40); }).includes('deploy_sha_mismatch'));
  assert.deepEqual(with_(c => { c.buildInfo.pokerWsUrl = 'wss://ws-preview.kcswh.pl/ws'; }), ['build_info_identity_mismatch']);
  assert.deepEqual(with_(c => { c.functions = ['a']; }), ['functions_mismatch']);
  assert.deepEqual(with_(c => { c.wsSurfaceChanged = true; }), ['ws_release_incompatible']);
  assert.deepEqual(with_(c => { c.wsRelease = null; c.wsSurfaceChanged = null; }), ['ws_release_unproven', 'ws_release_incompatible']);
  assert.deepEqual(with_(c => { c.site.published_deploy.id = id; }), ['already_published']);
});

test('active WS release requires the latest started deploy job to have succeeded', () => {
  const job = (conclusion, started_at, status = 'completed') => ({ name: 'deploy', status, conclusion, started_at });
  const older = { head_sha: 'e'.repeat(40), jobs: [job('success', '2026-10-25T10:00:00Z')] };
  assert.equal(activeWsRelease([{ head_sha: ws, jobs: [job('success', '2026-10-26T10:00:00Z'), { name: 'validate', status: 'completed', conclusion: 'success', started_at: '2026-10-27T00:00:00Z' }] }, older]), ws);
  assert.equal(activeWsRelease([{ head_sha: sha, jobs: [job('skipped', null)] }, older]), 'e'.repeat(40));
  assert.equal(activeWsRelease([{ head_sha: ws, jobs: [job('failure', '2026-10-26T10:00:00Z')] }, older]), null);
  assert.equal(activeWsRelease([{ head_sha: ws, jobs: [job(null, '2026-10-26T10:00:00Z', 'in_progress')] }, older]), null);
  assert.equal(activeWsRelease([{ head_sha: ws, jobs: [job('failure', '2026-10-26T10:00:00Z'), job('success', '2026-10-26T11:00:00Z')] }]), ws);
  assert.equal(activeWsRelease([]), null);
});

test('build info, CSP and HSTS checks use the deployed files', () => {
  assert.equal(parseBuildInfo(`// x\nwindow.BUILD_INFO = {"commitHash":"${sha}"};\n`).commitHash, sha);
  assert.equal(parseBuildInfo('window.BUILD_INFO = {bad};'), null);
  const csp = expectedCsp(fs.readFileSync(new URL('../_headers', import.meta.url), 'utf8'));
  assert.match(csp, /^default-src 'self';/);
  assert.deepEqual(headerFailures(new Headers({ 'content-security-policy': csp, 'strict-transport-security': 'max-age=31536000' }), csp), []);
  assert.deepEqual(headerFailures(new Headers({ 'content-security-policy': `${csp} x` }), csp), ['csp_mismatch', 'hsts_missing']);
});

function fakeApi(states, failRestore = false) {
  const calls = [];
  return { calls, site: async () => { calls.push('site'); return { published_deploy: states.shift() }; }, restore: async x => { calls.push(`restore:${x}`); if (failRestore) throw new Error('netlify_api_502'); }, lock: async x => { calls.push(`lock:${x}`); } };
}

test('publication requires a lock, rechecks before restore, keeps the target locked and marks later errors uncertain', async () => {
  const unlocked = fakeApi([{ id: live, locked: false }]);
  await assert.rejects(publishLocked(unlocked, id, async () => {}), e => e.message === 'auto_publishing_not_locked' && !e.uncertain);
  assert.deepEqual(unlocked.calls, ['site']);

  const stale = fakeApi([{ id: live, locked: true }]);
  await assert.rejects(publishLocked(stale, id, async () => { throw new Error('not_current_main_head'); }), e => !e.uncertain);
  assert.ok(!stale.calls.some(c => c.startsWith('restore')));

  const dropped = fakeApi([{ id: live, locked: true }, { id, locked: false }, { id, locked: true }]);
  assert.deepEqual(await publishLocked(dropped, id, async () => {}), { previousDeployId: live, relocked: true });
  assert.deepEqual(dropped.calls, ['site', `restore:${id}`, 'site', `lock:${id}`, 'site']);

  const raced = fakeApi([{ id: live, locked: true }, { id: 'e'.repeat(24), locked: false }]);
  await assert.rejects(publishLocked(raced, id, async () => {}), e => e.message === 'published_deploy_mismatch' && e.uncertain);
  assert.ok(!raced.calls.some(c => c.startsWith('lock')));

  const lost = fakeApi([{ id: live, locked: true }, { id, locked: false }, { id, locked: false }]);
  await assert.rejects(publishLocked(lost, id, async () => {}), e => e.message === 'lock_not_restored' && e.uncertain);

  const timeout = fakeApi([{ id: live, locked: true }], true);
  await assert.rejects(publishLocked(timeout, id, async () => {}), e => e.uncertain);
});

test('Netlify ignore skips only main Git builds and keeps PR Previews and branch deploys', () => {
  const cmd = /^\s*ignore = "(.*)"$/m.exec(fs.readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8'))[1].replaceAll('\\"', '"');
  const exit = env => spawnSync('sh', ['-c', cmd], { env: { PATH: process.env.PATH, ...env } }).status;
  assert.equal(exit({ BRANCH: 'main', PULL_REQUEST: 'false' }), 0);
  assert.equal(exit({}), 0);
  assert.equal(exit({ BRANCH: 'feat/x', PULL_REQUEST: 'true' }), 1);
  assert.equal(exit({ BRANCH: 'main', PULL_REQUEST: 'true' }), 1);
  assert.equal(exit({ BRANCH: 'feat/1114-profiles-phase-a', PULL_REQUEST: 'false' }), 1);
});

test('release tool has no unlock, build or rollback path', () => {
  const src = fs.readFileSync(new URL('../scripts/www-production-release.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /unlock|\/builds|deploy --prod|stop_builds|--rollback|build_hooks/);
});
