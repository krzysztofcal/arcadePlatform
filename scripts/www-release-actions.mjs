import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { SITE, netlifyApi, parseBuildInfo, expectedCsp, headerFailures, phrase, discardPhrase } from './www-production-release.mjs';

const SHA = /^[a-f0-9]{40}$/;
const ID = /^[a-f0-9]{24}$/;
const RUN = /^[1-9][0-9]{0,19}$/;
const REPO = 'krzysztofcal/arcadePlatform';
const fail = reason => { throw new Error(reason); };
const command = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180000 });
  if (r.status !== 0) fail(`${cmd}_failed`);
  return r.stdout.trim();
};
const gh = path => JSON.parse(command('gh', ['api', `repos/${REPO}/${path}`]));
const git = (...args) => command('git', args);
const currentMain = () => git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0];
const save = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

export function trustedOwnerRun(run, owner, workflow, completed = true) {
  if (owner !== 'krzysztofcal' || run?.repository?.full_name !== REPO || run.path !== `.github/workflows/${workflow}.yml`
    || run.event !== 'workflow_dispatch' || run.head_branch !== 'main' || run.actor?.login !== owner
    || run.triggering_actor?.login !== owner || !SHA.test(run.head_sha || '') || Number(run.run_attempt) !== 1
    || (completed && (run.status !== 'completed' || run.conclusion !== 'success'))) fail('untrusted_owner_run');
}

export function validateCandidate(run, p, owner, now = Date.now(), allowExpired = false) {
  trustedOwnerRun(run, owner, 'www-candidate');
  if (p?.schema !== 1 || p.status !== 'candidate_ready' || p.siteId !== SITE.id || !ID.test(p.deployId || '')
    || p.sha !== run.head_sha || String(p.runId) !== String(run.id) || String(p.attempt) !== String(run.run_attempt)
    || p.actor !== owner || p.triggeringActor !== owner) fail('candidate_provenance_mismatch');
  const age = now - Date.parse(p.createdAt);
  if (!Number.isFinite(age) || age < 0 || (!allowExpired && age > 30 * 60 * 1000)) fail('candidate_expired');
}

export function environmentFailures(settings, branches, owner) {
  const rule = settings?.protection_rules?.find(r => r.type === 'required_reviewers');
  const reviewers = rule?.reviewers || [];
  const policies = branches?.branch_policies || [];
  return [
    [settings?.can_admins_bypass === false, 'admin_bypass_enabled_or_unknown'],
    [rule?.prevent_self_review === false && reviewers.length === 1 && reviewers[0].type === 'User'
      && reviewers[0].reviewer?.login === owner, 'owner_reviewer_required'],
    [settings?.deployment_branch_policy?.custom_branch_policies === true
      && settings.deployment_branch_policy.protected_branches === false
      && policies.length === 1 && policies[0].name === 'main' && policies[0].type === 'branch', 'main_only_environment_required']
  ].filter(([ok]) => !ok).map(([, code]) => code);
}
export const ownerApproved = (reviews, environment, owner) => Array.isArray(reviews) && reviews.some(r =>
  r.state === 'approved' && r.user?.login === owner && r.environments?.some(e => e.name === environment));

export function correlatedCandidate(deploys, { marker, startedAt, previousIds }) {
  const matches = deploys.filter(d => d.title === marker);
  if (matches.length > 1) fail('ambiguous_hook_candidates');
  if (!matches.length) return null;
  const d = matches[0];
  if (!ID.test(d.id || '') || previousIds.includes(d.id) || !(Date.parse(d.created_at) >= Date.parse(startedAt) - 60000)
    || d.site_id !== SITE.id || d.context !== 'production' || d.branch !== 'main'
    || d.review_id || d.published_at) fail('hook_candidate_identity_mismatch');
  return d;
}

// The unique new ID is saved before final identity checks, so a stale-main build can still be safely discarded.
export function hookCandidateReady(deploy, sha) {
  if (!['ready', 'error'].includes(deploy.state)) return false; // commit_ref may be null before clone.
  if (deploy.state === 'error') fail('candidate_build_failed');
  if (deploy.commit_ref !== sha) fail('hook_candidate_sha_mismatch');
  return true;
}
const targetFile = (sha, path) => {
  const r = spawnSync('git', ['show', `${sha}:${path}`], { encoding: 'utf8' });
  if (r.status !== 0) fail('target_file_unreadable');
  return r.stdout;
};

function checkContext(workflow, env, requireHead = true) {
  if (env.GITHUB_REPOSITORY !== REPO || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_ACTOR !== 'krzysztofcal' || env.GITHUB_TRIGGERING_ACTOR !== 'krzysztofcal' || env.GITHUB_RUN_ATTEMPT !== '1'
    || env.GITHUB_WORKFLOW_REF !== `${REPO}/.github/workflows/${workflow}.yml@refs/heads/main`) fail('owner_main_dispatch_required');
  trustedOwnerRun(gh(`actions/runs/${env.GITHUB_RUN_ID}`), 'krzysztofcal', workflow, false);
  if (requireHead && (git('rev-parse', 'HEAD') !== env.GITHUB_SHA || currentMain() !== env.GITHUB_SHA)) fail('not_current_main_head');
}
function checkEnvironment(name, env, approval) {
  const failures = environmentFailures(gh(`environments/${name}`), gh(`environments/${name}/deployment-branch-policies`), 'krzysztofcal');
  if (failures.length) fail(failures.join(','));
  if (approval && !ownerApproved(gh(`actions/runs/${env.GITHUB_RUN_ID}/approvals`), name, 'krzysztofcal')) fail('owner_environment_approval_missing');
}

async function apiGet(path, env) {
  const response = await fetch(`https://api.netlify.com/api/v1${path}`, {
    headers: { authorization: `Bearer ${env.NETLIFY_AUTH_TOKEN}` }, signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) fail(`netlify_api_${response.status}`);
  return response.json();
}
async function staticGet(origin, path) {
  // Only fixed static paths selected by this file; never functions or API routes.
  const r = await fetch(`${origin}${path}`, { method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (r.status !== 200) fail(`static_http_${r.status}:${path}`);
  return { body: await r.text(), headers: r.headers };
}
export async function liveSmoke({ sha, deployId, api, readTarget, published = true, get = path => staticGet(SITE.url, path) }) {
  const info = parseBuildInfo((await get(`/js/build-info.js?release=${deployId}`)).body);
  if (info?.commitHash !== sha || info.deployId !== deployId || info.context !== 'production'
    || info.branch !== 'main' || info.siteUrl !== SITE.url || info.pokerWsUrl !== SITE.ws || info.isProduction !== true) fail('live_identity_mismatch');
  const root = await get('/');
  const errors = headerFailures(root.headers, expectedCsp(readTarget('_headers')));
  if (errors.length) fail(errors.join(','));
  for (const type of ['terms', 'privacy']) for (const language of ['pl', 'en']) {
    const path = `/legal/${type}.${language}.html`;
    // Match the entire canonical static document from the approved commit, including its version and deletion anchor.
    const target = readTarget(path.slice(1));
    if (!/(?:Wersja|Version):\s*\d{4}-\d\d-\d\d-[a-z0-9]+/.test(target)) fail('target_legal_version_missing');
    const actual = (await get(path)).body;
    if (actual !== target) fail(`live_legal_mismatch:${path}`);
    if (type === 'privacy' && !/id=["']account-deletion["']/.test(actual)) fail('live_deletion_anchor_missing');
  }
  // The public deletion entry point is an ordinary static page; never invoke the deletion function.
  const account = (await get('/account.html')).body;
  if (account !== readTarget('account.html')) fail('live_account_route_mismatch');
  const site = await api.site();
  if (site.id !== SITE.id || site.published_deploy?.locked !== true
    || (published ? site.published_deploy.id !== deployId : site.published_deploy.id === deployId)) fail('live_published_lock_mismatch');
  return { status: published ? 'live_verified' : 'candidate_static_verified', sha, deployId };
}

function release(args, file, env) {
  const r = spawnSync(process.execPath, ['scripts/www-production-release.mjs', ...args, '--receipt', file], {
    env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180000
  });
  if (!fs.existsSync(file)) { const e = new Error('release_receipt_missing_STOP'); e.uncertain = args.includes('--execute'); throw e; }
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (r.status !== 0) { const e = new Error(`release_${receipt.status}_STOP`); e.receipt = receipt; throw e; }
  return receipt;
}
function summary(text, env) {
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

async function candidate(env) {
  checkContext('www-candidate', env);
  checkEnvironment('www-candidate', env, true);
  const sha = env.REQUESTED_SHA || env.GITHUB_SHA;
  if (sha !== env.GITHUB_SHA || !SHA.test(sha)) fail('only_current_main_supported');
  const api = netlifyApi(env.NETLIFY_AUTH_TOKEN);
  const site = await api.site();
  if (site.id !== SITE.id || site.name !== SITE.name || site.published_deploy?.locked !== true) fail('site_identity_or_lock_missing');
  const before = await apiGet(`/sites/${SITE.id}/deploys?per_page=100`, env);
  const p = { schema: 1, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, sha, siteId: SITE.id,
    actor: env.GITHUB_ACTOR, triggeringActor: env.GITHUB_TRIGGERING_ACTOR, createdAt: new Date().toISOString(),
    marker: `www-candidate:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}:${randomUUID()}`, status: 'hook_not_called' };
  save('.www/candidate.json', p);
  try {
    const hook = new URL(env.NETLIFY_BUILD_HOOK);
    if (hook.origin !== 'https://api.netlify.com' || !/^\/build_hooks\/[a-f0-9]{24}$/.test(hook.pathname)) fail('invalid_build_hook');
    hook.search = new URLSearchParams({ trigger_branch: 'main', trigger_title: p.marker }).toString();
    p.status = 'hook_outcome_uncertain_STOP'; save('.www/candidate.json', p);
    // Never retry this POST. Correlate by the documented exact trigger_title, not by the latest deploy or response shape.
    const r = await fetch(hook, { method: 'POST', body: '{}', redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!r.ok) fail('hook_response_failed_STOP');
    const deadline = Date.now() + 10 * 60 * 1000;
    let ready = false;
    while (Date.now() < deadline) {
      const locked = await api.site();
      if (locked.published_deploy?.id !== site.published_deploy.id || locked.published_deploy?.locked !== true) fail('published_lock_changed_STOP');
      const deploys = await apiGet(`/sites/${SITE.id}/deploys?per_page=100`, env);
      const d = correlatedCandidate(deploys, { marker: p.marker, sha, startedAt: p.createdAt, previousIds: before.map(x => x.id) });
      if (d) {
        p.deployId = d.id; p.status = 'candidate_building'; save('.www/candidate.json', p);
        const full = await api.deploy(d.id);
        if (!correlatedCandidate([full], { marker: p.marker, startedAt: p.createdAt, previousIds: before.map(x => x.id) })) fail('hook_candidate_lost_STOP');
        if (hookCandidateReady(full, sha)) { ready = true; break; }
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(10000, Math.max(0, deadline - Date.now()))));
    }
    if (!p.deployId) fail('candidate_unidentified_STOP');
    if (!ready) fail('candidate_poll_timeout_STOP');
    p.validation = release(['--sha', sha, '--deploy', p.deployId], '.www/dry-run.json', env);
    p.staticValidation = await liveSmoke({ sha, deployId: p.deployId, api, published: false,
      readTarget: path => targetFile(sha, path), get: path => staticGet(`https://${p.deployId}--${SITE.name}.netlify.app`, path) });
    p.status = 'candidate_ready'; save('.www/candidate.json', p);
    summary(`Candidate ready: https://${p.deployId}--${SITE.name}.netlify.app\n\nSHA: ${sha}\n\nCandidate run: https://github.com/${REPO}/actions/runs/${p.runId} (attempt 1). Publish within 30 minutes; otherwise discard.`, env);
  } catch (e) {
    const hookNotCalled = p.status === 'hook_not_called';
    p.status = 'candidate_failed_STOP';
    if (p.deployId) {
      try { p.discard = release(['--discard', '--deploy', p.deployId, '--confirm', discardPhrase(p.deployId)], '.www/discard.json', env); }
      catch { p.status = 'discard_unverified_STOP'; }
    } else p.status = hookNotCalled ? 'hook_not_called' : 'unidentified_hook_outcome_STOP';
    save('.www/candidate.json', p);
    summary(`STOP: ${p.status}. Inspect this run's receipt and reconcile hook marker; do not guess or delete another deploy.`, env);
    throw e;
  }
}

async function publish(env) {
  checkContext('www-publish', env);
  checkEnvironment('www-production', env, true);
  if (!RUN.test(env.CANDIDATE_RUN_ID || '')) fail('invalid_candidate_run_id');
  const run = gh(`actions/runs/${env.CANDIDATE_RUN_ID}/attempts/1`);
  trustedOwnerRun(run, 'krzysztofcal', 'www-candidate');
  const artifacts = gh(`actions/runs/${run.id}/artifacts?per_page=100`).artifacts;
  const matches = artifacts.filter(a => a.name === 'www-candidate-1' && !a.expired);
  if (matches.length !== 1) fail('candidate_artifact_missing_or_ambiguous');
  command('gh', ['run', 'download', String(run.id), '--repo', REPO, '--name', 'www-candidate-1', '--dir', '.www/source']);
  const p = JSON.parse(fs.readFileSync('.www/source/candidate.json', 'utf8'));
  validateCandidate(run, p, 'krzysztofcal', Date.now(), true);
  // Expired/stale candidates can only be discarded. Identity/provenance must pass even on cleanup.
  const receipt = { schema: 1, runId: env.GITHUB_RUN_ID, candidateRunId: String(run.id), sha: p.sha, deployId: p.deployId, status: 'not_published' };
  save('.www/publication.json', receipt);
  let discardAttempted = false;
  try {
    if (env.DISCARD === 'true' || p.sha !== env.GITHUB_SHA || Date.now() - Date.parse(p.createdAt) > 30 * 60 * 1000) {
      discardAttempted = true;
      receipt.discard = release(['--discard', '--deploy', p.deployId, '--confirm', discardPhrase(p.deployId)], '.www/discard.json', env);
      receipt.status = 'discarded'; save('.www/publication.json', receipt);
      summary('Candidate discarded with API and permalink 404 proof. No publication.', env);
      if (env.DISCARD !== 'true') fail('stale_candidate_discarded_create_new_candidate');
      return;
    }
    // The existing script runs its complete validation and immediate main/WS rechecks; no alternative restore path.
    receipt.status = 'publication_uncertain_STOP'; save('.www/publication.json', receipt);
    receipt.release = release(['--sha', p.sha, '--deploy', p.deployId, '--execute', '--confirm', phrase(p.sha, p.deployId)], '.www/release.json', env);
    receipt.status = 'published_smoke_pending'; save('.www/publication.json', receipt);
    receipt.smoke = await liveSmoke({ sha: p.sha, deployId: p.deployId, api: netlifyApi(env.NETLIFY_AUTH_TOKEN), readTarget: path => targetFile(p.sha, path) });
    receipt.status = 'live_verified';
    fs.appendFileSync(env.GITHUB_OUTPUT, `deploy_id=${p.deployId}\nsha=${p.sha}\nverified=true\n`);
    summary(`Published and LIVE verified: ${p.sha}, deploy ${p.deployId}, locked. Release Record follows automatically.`, env);
  } catch (e) {
    if (e.receipt) {
      if (e.receipt.status?.startsWith('discard')) receipt.discard = e.receipt;
      else receipt.release = e.receipt;
    }
    if (e.uncertain || ['uncertain', 'published_smoke_failed', 'published'].includes(receipt.release?.status) || receipt.status === 'published_smoke_pending') {
      receipt.status = e.uncertain || receipt.release?.status === 'uncertain' ? 'uncertain_STOP' : 'published_smoke_failed_STOP';
      summary(`STOP: ${receipt.status}. Production may already have changed. No retry, rollback or deletion. OWNER decision required.`, env);
    } else if (receipt.status !== 'discarded') {
      try { if (discardAttempted) fail('discard_already_attempted_STOP'); receipt.discard = release(['--discard', '--deploy', p.deployId, '--confirm', discardPhrase(p.deployId)], '.www/discard.json', env); receipt.status = 'not_published_discarded'; }
      catch { receipt.status = 'discard_unverified_STOP'; }
      summary(`STOP: ${receipt.status}. Consult receipts.`, env);
    }
    throw e;
  } finally { save('.www/publication.json', receipt); }
}

async function candidateCleanup(env) {
  checkContext('www-candidate', env, false);
  checkEnvironment('www-candidate', env, true);
  if (!fs.existsSync('.www/candidate.json')) return; // No intent: the hook step never started.
  const p = JSON.parse(fs.readFileSync('.www/candidate.json', 'utf8'));
  if (p.discard?.status === 'discarded' || p.status === 'hook_not_called') return;
  if (String(p.runId) !== env.GITHUB_RUN_ID || p.sha !== env.GITHUB_SHA) fail('cleanup_intent_mismatch');
  if (!p.deployId) {
    const d = correlatedCandidate(await apiGet(`/sites/${SITE.id}/deploys?per_page=100`, env),
      { marker: p.marker, sha: p.sha, startedAt: p.createdAt, previousIds: [] });
    if (!d) fail('unidentified_hook_outcome_STOP');
    p.deployId = d.id;
  }
  // Existing discard refuses building, published, historical or foreign deploys; no cancellation or broad cleanup.
  try {
    p.discard = release(['--discard', '--deploy', p.deployId, '--confirm', discardPhrase(p.deployId)], '.www/discard.json', env);
    p.status = 'discarded';
  } catch { p.status = 'discard_unverified_STOP'; }
  save('.www/candidate.json', p);
  summary(`${p.status}: candidate cleanup. Missing API + permalink 404 proof requires OWNER reconciliation.`, env);
  if (p.status !== 'discarded') fail('discard_unverified_STOP');
}

async function recordChain(runId, destination, env) {
  if (!RUN.test(runId || '')) fail('invalid_record_run');
  const run = gh(`actions/runs/${runId}`);
  trustedOwnerRun(run, 'krzysztofcal', 'www-publish', false);
  const jobs = gh(`actions/runs/${runId}/jobs?per_page=100`);
  const reviews = gh(`actions/runs/${runId}/approvals`);
  const artifacts = gh(`actions/runs/${runId}/artifacts?per_page=100`).artifacts;
  if (artifacts.filter(a => a.name === 'www-publication-1' && !a.expired).length !== 1) fail('publication_artifact_untrusted');
  command('gh', ['run', 'download', runId, '--repo', REPO, '--name', 'www-publication-1', '--dir', `${destination}-source`]);
  const receipt = JSON.parse(fs.readFileSync(`${destination}-source/publication.json`, 'utf8'));
  const { approvedWwwRecord } = await import('./release-manifest.mjs');
  approvedWwwRecord(run, jobs, reviews, receipt, 'krzysztofcal');
  save(destination, { run, jobs, reviews, receipt });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  fs.mkdirSync('.www', { recursive: true });
  const operation = process.argv[2];
  Promise.resolve().then(() => {
    if (operation === 'check-candidate' || operation === 'check-publish') {
      const workflow = operation === 'check-candidate' ? 'www-candidate' : 'www-publish';
      checkContext(workflow, env); checkEnvironment(operation === 'check-candidate' ? 'www-candidate' : 'www-production', env, false);
    } else if (operation === 'record-chain') return recordChain(env.CHAIN_RUN_ID, env.CHAIN_DESTINATION, env);
    else if (operation === 'candidate-cleanup') return candidateCleanup(env);
    else if (operation === 'candidate') return candidate(env);
    else if (operation === 'publish') return publish(env);
    else fail('unknown_operation');
  }).catch(e => {
    // Do not log fetch errors: they can contain the secret hook URL.
    const code = /^[a-z0-9_,:./-]+(?:_STOP)?$/.test(e.message || '') ? e.message : 'details_suppressed';
    summary(`STOP: ${code}. Read the sanitized receipts; never retry an uncertain publication.`, env);
    process.stderr.write(`WWW_ACTION_STOP ${code} (see receipts)\n`); process.exitCode = 1;
  });
}
