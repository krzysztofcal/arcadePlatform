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
  // Evidence comes only from deploy-capable dispatch runs; a stuck validate-only push run cannot block it.
  const source = fs.readFileSync(new URL('../scripts/www-production-release.mjs', import.meta.url), 'utf8');
  assert.match(source, /ws-server-deploy\.yml\/runs\?branch=main&event=workflow_dispatch&per_page=50/);
  assert.match(source, /runs\.filter\(r => r\.event === 'workflow_dispatch'\)/);
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

// #1159 Addendum B: GitHub Release manifest. A record never deploys and carries unchanged components forward.
const manifestModule = await import('../scripts/release-manifest.mjs');
const { buildManifest, wwwEvidence, wsEvidence, androidEvidence, releaseNotes, previousRecord, RECORD_WORKFLOW } = manifestModule;
const buildInfoJs = (over = {}) => `window.BUILD_INFO = ${JSON.stringify({ commitHash: sha, context: 'production', isProduction: true, branch: 'main', deployId: id, buildTime: '2026-11-03T00:00:00Z', ...over }, null, 2)};\n`;
const wsRun = (over = {}) => ({ id: 41700000001, path: '.github/workflows/ws-server-deploy.yml', event: 'workflow_dispatch', head_branch: 'main', head_sha: ws, status: 'completed', conclusion: 'success', ...over });
const wsJobs = (conclusion = 'success') => ({ jobs: [{ name: 'impact', conclusion: 'success' }, { name: 'deploy', conclusion }] });
const wsReceipt = (over = {}) => ({ releaseSha: ws, runId: '41700000001', environment: 'ws-production', distSha256: 'd'.repeat(64), ...over });
const by = { actor: 'krzysztofcal', triggeringActor: 'krzysztofcal', runId: '1' };
const deployJob = (conclusion, started_at, status = 'completed') => ({ name: 'deploy', status, conclusion, started_at });
const recent = (...runs) => runs;
const current = recent({ id: 41700000001, head_sha: ws, status: 'completed', jobs: [deployJob('success', '2026-11-03T10:00:00Z')] });

test('release manifest: selective records keep the unchanged components and their original release', () => {
  const first = buildManifest({ previous: null, component: 'ws', evidence: wsEvidence(wsRun(), wsJobs(), wsReceipt(), current), tag: 'release-20261104-1', recordedAt: 't1', recordedBy: by });
  assert.equal(first.previous, null);
  assert.equal(first.components.www, null, 'a component never recorded stays explicitly unknown');
  assert.equal(first.components.android, null);
  assert.deepEqual(first.components.ws, { sha: ws, distSha256: 'd'.repeat(64), deployRunId: '41700000001', environment: 'ws-production', evidence: 'latest-github-deploy', releasedIn: 'release-20261104-1' });

  const wwwOnly = buildManifest({ previous: first, component: 'www', evidence: wwwEvidence(buildInfoJs(), id), tag: 'release-20261104-2', recordedAt: 't2', recordedBy: by });
  assert.deepEqual(wwwOnly.components.ws, first.components.ws, 'WS-only state is carried unchanged by a WWW-only record');
  assert.equal(wwwOnly.components.www.releasedIn, 'release-20261104-2');
  assert.equal(wwwOnly.previous, 'release-20261104-1');

  const android = androidEvidence({ sha, versionName: '1.0.0', versionCode: '3', aabSha256: 'e'.repeat(64), track: 'internal', attestedBy: 'krzysztofcal', owner: 'krzysztofcal' });
  const androidOnly = buildManifest({ previous: wwwOnly, component: 'android', evidence: android, tag: 'release-20261105-3', recordedAt: 't3', recordedBy: by });
  assert.deepEqual([androidOnly.components.www, androidOnly.components.ws], [wwwOnly.components.www, first.components.ws]);
  assert.equal(androidOnly.components.android.evidence, 'attested');
  assert.match(releaseNotes(androidOnly), /deploys nothing/);
  assert.match(releaseNotes(androidOnly), /- android \(changed\): a{40}/);
  assert.match(releaseNotes(androidOnly), /latest GitHub deploy when recorded; VPS not read/, 'the record never claims the WS runtime');

  assert.throws(() => buildManifest({ previous: androidOnly, component: 'ws', evidence: first.components.ws, tag: 'release-20261105-3', recordedAt: 't', recordedBy: by }), /tag_exists/);
  assert.throws(() => buildManifest({ previous: { schema: 2 }, component: 'ws', evidence: first.components.ws, tag: 'release-20261105-4', recordedAt: 't', recordedBy: by }), /previous_manifest_invalid/);
  assert.throws(() => buildManifest({ previous: null, component: 'db', evidence: {}, tag: 'release-20261105-4', recordedAt: 't', recordedBy: by }), /component_invalid/);
});

test('release manifest: evidence must prove exactly the running release', () => {
  assert.throws(() => wwwEvidence(buildInfoJs({ deployId: live }), id), /www_deploy_not_published/, 'another deploy is published');
  assert.throws(() => wwwEvidence(buildInfoJs({ context: 'deploy-preview', isProduction: false }), id), /www_not_production_main/);
  assert.throws(() => wwwEvidence('not build info', id), /www_build_info_unreadable/);
  assert.throws(() => wwwEvidence(buildInfoJs(), 'x'), /www_deploy_id_invalid/);

  for (const run of [wsRun({ conclusion: 'failure' }), wsRun({ head_branch: 'feature' }), wsRun({ event: 'push' }), wsRun({ path: '.github/workflows/ws-preview-deploy.yml' }), wsRun({ status: 'in_progress' })]) {
    assert.throws(() => wsEvidence(run, wsJobs(), wsReceipt(), current), /ws_run_not_successful_main_dispatch/);
  }
  assert.throws(() => wsEvidence(wsRun(), wsJobs('skipped'), wsReceipt(), current), /ws_deploy_job_not_successful/);
  for (const receipt of [null, wsReceipt({ releaseSha: sha }), wsReceipt({ runId: '2' }), wsReceipt({ environment: 'stage' }), wsReceipt({ distSha256: 'x' })]) {
    assert.throws(() => wsEvidence(wsRun(), wsJobs(), receipt, current), /ws_receipt_mismatch/);
  }
  // A historical successful deploy is not recorded as current: a later deploy, an unfinished run or a later failed
  // deploy attempt all stop the record (existing githubWsRelease rule).
  const older = { id: 41700000001, head_sha: ws, status: 'completed', jobs: [deployJob('success', '2026-11-03T10:00:00Z')] };
  for (const [label, runs] of [
    ['newer deploy of another commit', recent({ id: 41700000009, head_sha: sha, status: 'completed', jobs: [deployJob('success', '2026-11-04T10:00:00Z')] }, older)],
    ['newer successful deploy of the same commit (another run)', recent({ id: 41700000009, head_sha: ws, status: 'completed', jobs: [deployJob('success', '2026-11-04T10:00:00Z')] }, older)],
    ['deploy still running', recent({ id: 41700000009, head_sha: sha, status: 'in_progress', jobs: [deployJob(null, '2026-11-04T10:00:00Z', 'in_progress')] }, older)],
    ['later deploy failed after switching', recent({ id: 41700000009, head_sha: sha, status: 'completed', jobs: [deployJob('failure', '2026-11-04T10:00:00Z')] }, older)],
    ['no deploy evidence', recent()],
    ['not collected', undefined],
  ]) assert.throws(() => wsEvidence(wsRun(), wsJobs(), wsReceipt(), runs), /ws_not_latest_github_deploy/, label);
  const skippedLater = recent({ id: 41700000009, head_sha: sha, status: 'completed', jobs: [deployJob('skipped', null)] }, older);
  assert.equal(wsEvidence(wsRun(), wsJobs(), wsReceipt(), skippedLater).sha, ws, 'a later run whose deploy was skipped changes nothing');

  const good = { sha, versionName: '1.0.0', versionCode: '3', aabSha256: 'e'.repeat(64), track: 'internal', attestedBy: 'krzysztofcal', owner: 'krzysztofcal' };
  for (const [field, value, reason] of [['aabSha256', 'debug.apk', 'aab_sha256_invalid'], ['track', 'stage', 'track_invalid'], ['versionCode', '0', 'version_code_invalid'], ['sha', 'main', 'sha_invalid'],
    ['attestedBy', 'release-agent[bot]', 'attestation_owner_only'], ['owner', '', 'attestation_owner_only']]) {
    assert.throws(() => androidEvidence({ ...good, [field]: value }), new RegExp(`android_${reason}`));
  }
});

test('release manifest: the previous record is trusted only as the owner\'s own immutable Release Record publication', () => {
  const manifest = { schema: 1, tag: 'release-20261104-7', recordedBy: { actor: 'krzysztofcal', triggeringActor: 'krzysztofcal', runId: '41800000007' }, components: {} };
  const bot = { login: 'github-actions[bot]' };
  const release = (over = {}) => ({ tag_name: 'release-20261104-7', draft: false, prerelease: false, immutable: true, author: bot, assets: [{ name: 'release-manifest.json', uploader: bot }], ...over });
  const run = (over = {}) => ({ id: 41800000007, run_number: 7, path: RECORD_WORKFLOW, event: 'workflow_dispatch', head_branch: 'main', actor: { login: 'krzysztofcal' }, triggering_actor: { login: 'krzysztofcal' }, ...over });
  const jobs = (conclusion = 'success') => ({ jobs: [{ name: 'record', conclusion: 'success' }, { name: 'publish', conclusion }] });
  assert.equal(previousRecord(manifest, release(), run(), jobs(), 'krzysztofcal'), manifest);
  assert.equal(previousRecord(null, null, null, null, 'krzysztofcal'), null, 'first record');

  for (const [label, rel] of [
    ['published by the code agent', release({ author: { login: 'arcade-code-agent[bot]' } })],
    ['asset replaced by someone else', release({ assets: [{ name: 'release-manifest.json', uploader: { login: 'arcade-code-agent[bot]' } }] })],
    ['mutable release', release({ immutable: false })],
    ['extra asset', release({ assets: [...release().assets, { name: 'app.apk', uploader: bot }] })],
    ['manifest of another tag', release({ tag_name: 'release-20261104-8' })],
    ['release missing', null],
  ]) assert.throws(() => previousRecord(manifest, rel, run(), jobs(), 'krzysztofcal'), /previous_release_untrusted/, label);
  for (const [label, r, j] of [
    ['run of another workflow', run({ path: '.github/workflows/ci.yml' }), jobs()],
    ['agent dispatch', run({ actor: { login: 'release-agent[bot]' }, triggering_actor: { login: 'release-agent[bot]' } }), jobs()],
    ['agent re-run of an owner run', run({ triggering_actor: { login: 'release-agent[bot]' } }), jobs()],
    ['other branch', run({ head_branch: 'feature' }), jobs()],
    ['tag not made by this run', run({ run_number: 8 }), jobs()],
    ['manifest names another run', run({ id: 41800000008 }), jobs()],
    ['dry run only', run(), jobs('skipped')],
    ['run missing', null, jobs()],
  ]) assert.throws(() => previousRecord(manifest, release(), r, j, 'krzysztofcal'), /previous_record_not_owner_published/, label);

  // The CLI applies the check before building: a previous record published by the agent blocks the next one.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-record-'));
  const file = (name, value) => { fs.writeFileSync(path.join(dir, name), JSON.stringify(value)); return path.join(dir, name); };
  const env = { PATH: process.env.PATH, GITHUB_RUN_ID: '41800000009', GITHUB_RUN_NUMBER: '9', GITHUB_REPOSITORY_OWNER: 'krzysztofcal', GITHUB_ACTOR: 'krzysztofcal', GITHUB_TRIGGERING_ACTOR: 'krzysztofcal',
    RELEASE_COMPONENT: 'android', ANDROID_SHA: sha, ANDROID_VERSION_NAME: '1.0.0', ANDROID_VERSION_CODE: '3', ANDROID_AAB_SHA256: 'e'.repeat(64), ANDROID_TRACK: 'internal',
    PREVIOUS_MANIFEST_FILE: file('m.json', manifest), PREVIOUS_RUN_FILE: file('r.json', run()), PREVIOUS_JOBS_FILE: file('j.json', jobs()) };
  const cli = (rel) => spawnSync(process.execPath, [new URL('../scripts/release-manifest.mjs', import.meta.url).pathname], { cwd: dir, env: { ...env, PREVIOUS_RELEASE_FILE: file('rel.json', rel) }, encoding: 'utf8' }).stdout;
  assert.match(cli(release({ author: { login: 'arcade-code-agent[bot]' } })), /^RELEASE_RECORD_BLOCKED previous_release_untrusted\n$/);
  assert.match(cli(release()), /^RELEASE_RECORD_READY release-\d{8}-9 android a{40}\n$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('release record workflow publishes one manifest asset and cannot reach any deployment', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/release-record.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|pull_request_target|schedule|workflow_run|release):/m);
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /secrets\.|environment:|appleboy|ssh|netlify-cli|netlify deploy --|api\.netlify\.com|workflow run|gh workflow|systemctl|arcade-ws-restart-gate|stage-db|play-console|fastlane/i);
  assert.match(workflow, /default: false/);
  // Dry run (owner or agent) is read-only; only the owner's own publish=true dispatch reaches contents: write.
  const record = workflow.slice(workflow.indexOf('\n  record:\n'), workflow.indexOf('\n  publish:\n'));
  const publish = workflow.slice(workflow.indexOf('\n  publish:\n'));
  assert.match(record, /    permissions:\n      contents: read\n      actions: read\n/);
  assert.doesNotMatch(record.replace(/^\s*#.*$/gm, ''), /contents: write|gh release create/);
  assert.match(publish, /\n    needs: record\n/);
  assert.match(publish, /    permissions:\n      contents: write\n    steps:/);
  assert.equal((workflow.replace(/^\s*#.*$/gm, '').match(/contents: write/g) || []).length, 1);
  const publishIf = publish.match(/\n    if: \$\{\{ (.+) \}\}\n/)[1];
  const publishes = ({ actor, triggeringActor = actor, flag = true }) => Function(`return (${publishIf.replaceAll('inputs.publish', String(flag)).replaceAll('github.event_name', '"workflow_dispatch"').replaceAll('github.ref', '"refs/heads/main"').replaceAll('github.triggering_actor', JSON.stringify(triggeringActor)).replaceAll('github.actor', JSON.stringify(actor)).replaceAll('github.repository_owner', '"krzysztofcal"').replaceAll("'", '"').replaceAll(' == ', ' === ')});`)();
  assert.equal(publishes({ actor: 'krzysztofcal' }), true);
  assert.equal(publishes({ actor: 'krzysztofcal', flag: false }), false, 'dry run never publishes');
  assert.equal(publishes({ actor: 'release-agent[bot]' }), false, 'the release agent never publishes');
  assert.equal(publishes({ actor: 'krzysztofcal', triggeringActor: 'release-agent[bot]' }), false, 'an agent re-run of an owner run never publishes');
  assert.match(record, /\[\[ "\$PUBLISH" != true \|\| "\$OWNER_RUN" == true \]\]/, 'an agent publish request fails instead of silently skipping');
  assert.match(record, /\[\[ "\$COMPONENT" != android \|\| "\$OWNER_RUN" == true \]\]/, 'Android attestation is the owner\'s own');
  assert.equal((workflow.match(/gh release create/g) || []).length, 1);
  assert.match(publish, /gh release create "\$TAG" release-manifest\.json --repo "\$GITHUB_REPOSITORY" --target "\$TARGET" --title "\$TAG" --notes-file release-notes\.md\n/, 'the manifest is the only asset');
  assert.match(record, /git merge-base --is-ancestor "\$TARGET" origin\/main/);
  assert.match(publish, /compare\/\$TARGET\.\.\.main/);
  assert.match(record, /\[\[ "\$CONFIRMATION" == "RECORD \$COMPONENT RELEASE" \]\]/);
  assert.match(record, /ws-server-deploy\.yml\/runs\?branch=main&event=workflow_dispatch/);
  assert.match(record, /releases\/tags\/\$LATEST" > \.release\/previous-release\.json/, 'the previous release is checked, not only its asset');
  assert.match(record, /actions\/runs\/\$PREVIOUS_RUN_ID\/jobs/, 'the run the previous manifest names is checked');
  assert.match(publish, /--jq \.immutable\)"\n.*\[\[ "\$IMMUTABLE" == true \]\]/, 'a published record must be immutable');
  for (const block of workflow.split(/\n      - name: /).slice(1)) {
    const script = block.split('run: |')[1] || '';
    assert.doesNotMatch(script, /\$\{\{/, 'inputs reach scripts only through env');
  }
  assert.match(workflow, /github\.actor == github\.repository_owner && github\.triggering_actor == github\.repository_owner/);

  // No workflow starts on a tag or a release; every push trigger is limited to main.
  const dir = new URL('../.github/workflows/', import.meta.url);
  let pushWorkflows = 0;
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.yml'))) {
    const on = fs.readFileSync(new URL(file, dir), 'utf8').split(/\n(?=[a-z])/).find((part) => part.startsWith('on:'));
    assert.ok(on, `${file}: top-level on:`);
    assert.doesNotMatch(on, /^  (release|create):/m, file);
    assert.doesNotMatch(on, /^\s+tags:/m, file);
    if (/^  push:/m.test(on)) {
      pushWorkflows += 1;
      assert.match(on, /^  push:\n    branches: \[ main \]\n/m, `${file}: push only on main`);
    }
  }
  assert.ok(pushWorkflows >= 5, 'the scan sees the push-triggered workflows');

  const script = fs.readFileSync(new URL('../scripts/release-manifest.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /spawn|exec|fetch\(|writeFileSync\((?!'release-(manifest\.json|notes\.md)')/, 'the builder only reads files and writes the two outputs');
});

test('WS release approval: request checks, last confirmed deploy, scope and summary never claim unrun checks', async () => {
  const { AFTER_APPROVAL, checkRequest, lastConfirmedDeploy, releaseScope, renderSummary } = await import('../scripts/ws-release-approval.mjs');
  const target = 'd'.repeat(40);
  const ok = { releaseSha: target, confirmation: `DEPLOY WS PRODUCTION ${target}`, githubSha: target, headSha: target, mainSha: target };
  assert.equal(checkRequest(ok).length, 3);
  for (const [field, value, reason] of [['releaseSha', 'D'.repeat(40), /full lowercase/], ['githubSha', sha, /dispatched main/], ['headSha', sha, /checkout/],
    ['confirmation', `DEPLOY WS PRODUCTION ${sha}`, /phrase/], ['mainSha', sha, /main advanced/]]) assert.throws(() => checkRequest({ ...ok, [field]: value }), reason, field);

  const job = (conclusion, startedAt, status = 'completed') => ({ name: 'deploy', status, conclusion, started_at: startedAt });
  const current = { id: 30, head_sha: target, status: 'in_progress', jobs: [job(null, null, 'waiting')] };
  const done = { id: 20, head_sha: ws, status: 'completed', jobs: [job('success', '2026-11-05T10:00:00Z')] };
  const older = { id: 10, head_sha: sha, status: 'completed', jobs: [job('success', '2026-11-01T10:00:00Z')] };
  assert.deepEqual(lastConfirmedDeploy([current, done, older], 30, [current]), { sha: ws, runId: 20 }, 'the run being approved is left out');
  assert.equal(lastConfirmedDeploy([current, done, older], 99, [current]), null, 'another unfinished run gives no evidence');
  assert.equal(lastConfirmedDeploy([current, done, older], 30, [current, { id: 5, status: 'waiting' }]), null, 'an unfinished run beyond the recent page counts');
  assert.equal(lastConfirmedDeploy([{ ...done, jobs: [job('failure', '2026-11-05T10:00:00Z')] }, older], 30, []), null, 'a failed newest deploy is not a confirmed release');
  assert.equal(lastConfirmedDeploy(null, 30, []), null);
  assert.equal(lastConfirmedDeploy([done], 30, null), null, 'unknown unfinished runs give no evidence');

  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-approval-'));
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  const commit = (file, text, message) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
    git(['add', '-A']);
    git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message]);
    return git(['rev-parse', 'HEAD']).stdout.trim();
  };
  git(['init', '-q']);
  fs.mkdirSync(path.join(repo, '.github/workflows'), { recursive: true });
  fs.copyFileSync('.github/workflows/ws-server-deploy.yml', path.join(repo, '.github/workflows/ws-server-deploy.yml'));
  const a = commit('ws-server/server.mjs', 'one\n', 'base');
  const b = commit('README.md', 'docs\n', 'docs only | `x` <b> [Approve](https://example.com) ![i](https://example.com/i.png)');
  const c = commit('ws-server/server.mjs', 'two\n', 'ws change');
  const wf = commit('.github/workflows/ws-server-deploy.yml', `${fs.readFileSync('.github/workflows/ws-server-deploy.yml', 'utf8')}# build change\n`, 'workflow only');
  assert.deepEqual(releaseScope(a, a, git), { relation: 'same', commits: [], commitCount: 0, wsFiles: [] });
  const docs = releaseScope(a, b, git);
  assert.equal(docs.relation, 'ahead');
  assert.equal(docs.commitCount, 1);
  assert.deepEqual(docs.wsFiles, [], 'a docs commit changes no packaged WS file');
  const change = releaseScope(a, c, git);
  assert.equal(change.commitCount, 2);
  assert.deepEqual(change.wsFiles, ['ws-server/server.mjs']);
  assert.deepEqual(releaseScope(c, wf, git).wsFiles, ['.github/workflows/ws-server-deploy.yml'], 'a deploy workflow change is a WS input change');
  assert.equal(releaseScope(c, a, git).relation, 'not_ancestor');
  assert.throws(() => releaseScope('e'.repeat(40), c, git), /scope_unknown/);

  const input = { releaseSha: c, actor: 'arcade-code-agent[bot]', triggeringActor: 'arcade-code-agent[bot]', runId: '30', attempt: '1', checks: checkRequest({ ...ok, releaseSha: c, confirmation: `DEPLOY WS PRODUCTION ${c}`, githubSha: c, headSha: c, mainSha: c }) };
  const text = renderSummary({ ...input, last: { sha: a, runId: 20 }, scope: change });
  for (const part of [`## Approve only if expected: WS Production release ${c}`, `| Last confirmed deploy | \`${a}\` (run 20). GitHub evidence`, 'not read from the VPS',
    '2 commit(s) since the last confirmed deploy; 1 WS input file(s) changed', '- [`ws-server/server.mjs`]', '- NOT RUN YET', 'the impact and validate jobs succeeded (their logs show which steps ran)', ...AFTER_APPROVAL]) assert.ok(text.includes(part), part);
  const compare = `https://github.com/krzysztofcal/arcadePlatform/compare/${a}..${c}`;
  assert.ok(text.includes(`[View changes](${compare})`));
  const { createHash } = await import('node:crypto');
  const fileAnchor = createHash('sha256').update('ws-server/server.mjs').digest('hex');
  assert.ok(text.includes(`- [\`ws-server/server.mjs\`](${compare}#diff-${fileAnchor})`), 'file links point into the exact comparison, including deleted files');
  const unknown = renderSummary({ ...input, last: null, scope: null });
  assert.ok(unknown.includes(`[View commit](https://github.com/krzysztofcal/arcadePlatform/commit/${c})`));
  assert.doesNotMatch(unknown, /\/compare\//, 'unknown baseline never invents a diff');
  assert.throws(() => renderSummary({ ...input, last: { sha: 'main', runId: 20 }, scope: change }), /invalid_summary_input/);
  assert.match(text, /\n- `[a-f0-9]{12}` `docs only x b \[Approve\]\(https:\/\/example\.com\) !\[i\]\(https:\/\/example\.com\/i\.png\)`\n/, 'a subject is one closed code span');
  assert.doesNotMatch(text, /PASS|<b>|\| `x`|^- `[a-f0-9]{12}` [^`]/m, 'no unrun check is reported as passed and no subject renders as Markdown');
  assert.match(renderSummary({ ...input, last: { sha: a, runId: 20 }, scope: docs }), /no WS input file changed \(packaged files and the deploy workflow\); the artifact is rebuilt, not compared/);
  assert.match(renderSummary({ ...input, last: null, scope: null }), /\| Last confirmed deploy \| unknown: [^|]+\|\n\| Scope \| unknown: /);
  assert.match(renderSummary({ ...input, last: { sha: a, runId: 20 }, scope: null, scopeError: true }), /\| Scope \| unknown: the history/);
  assert.match(renderSummary({ ...input, last: { sha: c, runId: 20 }, scope: releaseScope(c, a, git) }), /NOT an ancestor/);
  assert.throws(() => renderSummary({ ...input, actor: 'a b', last: null }), /invalid_summary_input/);
  fs.unlinkSync(path.join(repo, 'ws-server/server.mjs'));
  const deleted = commit('README.md', 'deleted WS input\n', 'delete WS input');
  const deletedScope = releaseScope(wf, deleted, git);
  assert.deepEqual(deletedScope.wsFiles, ['ws-server/server.mjs']);
  const deletedText = renderSummary({ ...input, releaseSha: deleted, last: { sha: wf, runId: 20 }, scope: deletedScope });
  assert.ok(deletedText.includes(`- [\`ws-server/server.mjs\`](https://github.com/krzysztofcal/arcadePlatform/compare/${wf}..${deleted}#diff-${fileAnchor})`), 'a deleted file links to its immutable diff, not a missing blob');

  git(['checkout', '--detach', a]);
  const diverged = commit('ws-server/server.mjs', 'other branch\n', 'divergent WS change');
  const divergentScope = releaseScope(c, diverged, git);
  assert.equal(divergentScope.relation, 'not_ancestor');
  assert.notEqual(git(['diff', c, diverged]).stdout, git(['diff', `${c}...${diverged}`]).stdout, 'a merge-base diff is not the deployed-to-candidate diff');
  const divergentText = renderSummary({ ...input, releaseSha: diverged, last: { sha: c, runId: 20 }, scope: divergentScope });
  assert.ok(divergentText.includes(`[View changes](https://github.com/krzysztofcal/arcadePlatform/compare/${c}..${diverged})`));
  assert.match(divergentText, /NOT an ancestor/);
  const unusualPath = 'shared/żółw "quoted"\nname.mjs';
  const unusual = commit(unusualPath, 'unusual path\n', 'unusual WS path');
  const unusualScope = releaseScope(diverged, unusual, git);
  assert.deepEqual(unusualScope.wsFiles, [unusualPath], 'diff paths are literal, not Git-quoted or split on embedded newlines');
  const unusualText = renderSummary({ ...input, releaseSha: unusual, last: { sha: diverged, runId: 20 }, scope: unusualScope });
  assert.ok(unusualText.includes(`#diff-${createHash('sha256').update(unusualPath).digest('hex')})`), 'the link hashes the original UTF-8 path');


  fs.rmSync(repo, { recursive: true, force: true });
});
