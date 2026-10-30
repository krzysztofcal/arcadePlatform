import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SITE, candidateFailures, expectedCsp, headerFailures, parseBuildInfo, phrase, publishLocked } from '../scripts/www-production-release.mjs';

const sha = 'a'.repeat(40);
const id = 'b'.repeat(24);
const live = 'c'.repeat(24);
const base = () => ({
  mode: 'publish', sha, mainSha: sha,
  site: { id: SITE.id, published_deploy: { id: live, locked: true } },
  deploy: { id, site_id: SITE.id, context: 'production', branch: 'main', state: 'ready', review_id: null, commit_ref: sha, published_at: null, available_functions: [{ n: 'b' }, { n: 'a' }] },
  buildInfo: { commitHash: sha, context: 'production', deployId: id, siteUrl: SITE.url, pokerWsUrl: SITE.ws },
  functions: ['a', 'b'], wsSurfaceChanged: false
});
const with_ = (patch) => { const c = base(); patch(c); return candidateFailures(c); };

test('exact locked main production candidate passes', () => {
  assert.deepEqual(candidateFailures(base()), []);
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
  assert.deepEqual(with_(c => { c.site.published_deploy.id = id; }), ['already_published']);
});

test('rollback needs a previously published deploy but not current main HEAD', () => {
  assert.deepEqual(with_(c => { c.mode = 'rollback'; c.mainSha = 'd'.repeat(40); }), ['rollback_target_never_published']);
  assert.deepEqual(with_(c => { c.mode = 'rollback'; c.mainSha = 'd'.repeat(40); c.deploy.published_at = '2026-10-29T16:53:56.555Z'; }), []);
  assert.equal(phrase('rollback', sha, id), `ROLLBACK WWW PRODUCTION ${sha} ${id}`);
  assert.equal(phrase('publish', sha, id), `PUBLISH WWW PRODUCTION ${sha} ${id}`);
});

test('build info, CSP and HSTS checks use the deployed files', () => {
  assert.equal(parseBuildInfo(`// x\nwindow.BUILD_INFO = {"commitHash":"${sha}"};\n`).commitHash, sha);
  assert.equal(parseBuildInfo('window.BUILD_INFO = {bad};'), null);
  const csp = expectedCsp(fs.readFileSync(new URL('../_headers', import.meta.url), 'utf8'));
  assert.match(csp, /^default-src 'self';/);
  assert.deepEqual(headerFailures(new Headers({ 'content-security-policy': csp, 'strict-transport-security': 'max-age=31536000' }), csp), []);
  assert.deepEqual(headerFailures(new Headers({ 'content-security-policy': `${csp} x` }), csp), ['csp_mismatch', 'hsts_missing']);
});

function fakeApi(states) {
  const calls = [];
  return { calls, site: async () => { calls.push('site'); return { published_deploy: states.shift() }; }, restore: async x => { calls.push(`restore:${x}`); }, lock: async x => { calls.push(`lock:${x}`); } };
}

test('publication requires a lock, rechecks before restore and keeps the target locked', async () => {
  const unlocked = fakeApi([{ id: live, locked: false }]);
  await assert.rejects(publishLocked(unlocked, id, async () => {}), /auto_publishing_not_locked/);
  assert.deepEqual(unlocked.calls, ['site']);

  const stale = fakeApi([{ id: live, locked: true }]);
  await assert.rejects(publishLocked(stale, id, async () => { throw new Error('not_current_main_head'); }), /not_current_main_head/);
  assert.ok(!stale.calls.some(c => c.startsWith('restore')));

  const dropped = fakeApi([{ id: live, locked: true }, { id, locked: false }, { id, locked: true }]);
  assert.deepEqual(await publishLocked(dropped, id, async () => {}), { previousDeployId: live, publishedDeployId: id, relocked: true });
  assert.deepEqual(dropped.calls, ['site', `restore:${id}`, 'site', `lock:${id}`, 'site']);

  const raced = fakeApi([{ id: live, locked: true }, { id: 'e'.repeat(24), locked: false }]);
  await assert.rejects(publishLocked(raced, id, async () => {}), /published_deploy_mismatch/);
  assert.ok(!raced.calls.some(c => c.startsWith('lock')));
});

test('release tool has no unlock or build path', () => {
  const src = fs.readFileSync(new URL('../scripts/www-production-release.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /unlock|\/builds|deploy --prod|stop_builds/);
});
