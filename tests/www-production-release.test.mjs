import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { SITE, activeWsRelease, candidateFailures, discardCandidate, expectedCsp, githubWsRelease, headerFailures, parseBuildInfo, phrase, publishLocked, vpsWsRelease, wsPackagedPaths, wsSurfaceChanged } from '../scripts/www-production-release.mjs';

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

test('GitHub WS evidence: latest started deploy succeeded and nothing unfinished can still change Production', () => {
  const job = (conclusion, started_at, status = 'completed') => ({ name: 'deploy', status, conclusion, started_at });
  const run = (head_sha, jobs, status = 'completed') => ({ head_sha, status, jobs });
  const older = run('e'.repeat(40), [job('success', '2026-10-25T10:00:00Z')]);
  assert.equal(githubWsRelease([run(ws, [job('success', '2026-10-26T10:00:00Z'), { name: 'validate', status: 'completed', conclusion: 'success', started_at: '2026-10-27T00:00:00Z' }]), older]), ws);
  assert.equal(githubWsRelease([run(sha, [job('skipped', null)]), older]), 'e'.repeat(40));
  assert.equal(githubWsRelease([run(ws, [job('failure', '2026-10-26T10:00:00Z')]), older]), null);
  assert.equal(githubWsRelease([run(ws, [job(null, '2026-10-26T10:00:00Z', 'in_progress')]), older]), null);
  assert.equal(githubWsRelease([run(ws, [job(null, null, 'queued')]), older]), null);
  assert.equal(githubWsRelease([run(ws, [job(null, null, 'waiting')]), older]), null);
  assert.equal(githubWsRelease([run(ws, [], 'queued'), older]), null);
  assert.equal(githubWsRelease([run(ws, [job('failure', '2026-10-26T10:00:00Z'), job('success', '2026-10-26T11:00:00Z')])]), ws);
  assert.equal(githubWsRelease([]), null);
});

test('VPS WS evidence: current release, metadata and a service started after installation; both sources must agree', () => {
  const out = (o = {}) => [o.dir ?? `/opt/ws-server/releases/${ws}/ws-server`, JSON.stringify({ releaseSha: o.meta ?? ws, deployRef: 'main', environment: o.env ?? 'production' }), '', '2026-10-26T12:10:52Z', `MainPID=582106`, `ExecMainStartTimestamp=@${o.start ?? 1793292839}`, `ActiveState=${o.state ?? 'active'}`].join('\n');
  assert.equal(vpsWsRelease(out()), ws);
  assert.equal(vpsWsRelease(out({ meta: sha })), null);
  assert.equal(vpsWsRelease(out({ env: 'preview' })), null);
  assert.equal(vpsWsRelease(out({ dir: '/opt/arcade-ws/ws-server' })), null);
  assert.equal(vpsWsRelease(out({ state: 'failed' })), null);
  assert.equal(vpsWsRelease(out({ start: Date.parse('2026-10-26T12:00:00Z') / 1000 })), null);
  assert.equal(vpsWsRelease(''), null);
  assert.equal(activeWsRelease(ws, ws), ws);
  assert.equal(activeWsRelease(ws, 'e'.repeat(40)), null);
  assert.equal(activeWsRelease(null, ws), null);
  assert.equal(activeWsRelease(ws, null), null);
});

test('WS compatibility covers every module packaged by WS Server Deploy, including netlify/functions/_shared', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/ws-server-deploy.yml', import.meta.url), 'utf8');
  const paths = wsPackagedPaths(workflow);
  for (const p of ['netlify/functions/_shared/chips-ledger.mjs', 'netlify/functions/_shared/poker-*.mjs', 'netlify/functions/_shared/supabase-admin.mjs', 'netlify/functions/_shared/api-cors.mjs', 'netlify/functions/_shared/store-upstash.mjs', 'netlify/functions/_shared/xp-ledger.mjs', 'netlify/functions/_generated/deploy-context.mjs', 'scripts/generate-build-info.js', 'shared', 'ws-server/server.mjs']) assert.ok(paths.includes(p), p);
  assert.throws(() => wsPackagedPaths('steps: []'), /ws_surface_unknown/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'www-ws-surface-'));
  const git = (...a) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const write = (f, c) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); };
  try {
    git('init', '-q');
    write('.github/workflows/ws-server-deploy.yml', workflow);
    write('netlify/functions/_shared/xp-ledger.mjs', 'export const v = 1;\n');
    write('netlify/functions/_shared/poker-state.mjs', 'export const v = 1;\n');
    write('netlify/functions/_shared/browser-only.mjs', 'export const v = 1;\n');
    git('add', '-A'); git('commit', '-qm', 'ws');
    const ws = git('rev-parse', 'HEAD');
    write('netlify/functions/_shared/browser-only.mjs', 'export const v = 2;\n');
    git('commit', '-qam', 'www only');
    assert.equal(wsSurfaceChanged(ws, git('rev-parse', 'HEAD'), dir), false);
    write('netlify/functions/_shared/xp-ledger.mjs', 'export const v = 2;\n');
    git('commit', '-qam', 'shared ws module');
    assert.equal(wsSurfaceChanged(ws, git('rev-parse', 'HEAD'), dir), true);
    git('reset', '-q', '--hard', ws);
    write('netlify/functions/_shared/poker-state.mjs', 'export const v = 2;\n');
    git('commit', '-qam', 'poker glob');
    assert.equal(wsSurfaceChanged(ws, git('rev-parse', 'HEAD'), dir), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('discard deletes only an unpublished candidate and reports deletion only when API and permalink are gone', async () => {
  const api = (deploy, after = 'gone') => {
    const calls = [];
    let deleted = false;
    return { calls, site: async () => ({ published_deploy: { id: live } }), deploy: async () => { if (deleted && after === 'gone') throw new Error('netlify_api_404'); return deploy; }, discard: async x => { calls.push(`discard:${x}`); deleted = true; } };
  };
  const cand = { id, site_id: SITE.id, context: 'production', state: 'ready', published_at: null };
  assert.deepEqual(await discardCandidate(api(cand), id, async () => 404), { apiGone: true, permalinkStatus: 404, discarded: true });
  assert.equal((await discardCandidate(api(cand), id, async () => 200)).discarded, false);
  assert.equal((await discardCandidate(api(cand, 'kept'), id, async () => 404)).discarded, false);
  for (const bad of [{ ...cand, published_at: '2026-10-29T16:53:56Z' }, { ...cand, state: 'building' }, { ...cand, context: 'deploy-preview' }]) {
    const a = api(bad);
    await assert.rejects(discardCandidate(a, id, async () => 404), /not_discardable_candidate/);
    assert.deepEqual(a.calls, []);
  }
  const current = api({ ...cand, id: live });
  await assert.rejects(discardCandidate(current, live, async () => 404), /not_discardable_candidate/);
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
