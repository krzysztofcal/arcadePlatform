import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { latestWsDeploy, wsPackagedPaths } from './www-production-release.mjs';

// Approval summary of a WS Production release (#1159). The unprivileged request job of WS Server Deploy renders it
// before the owner approves the ws-production environment: target, exact SHA, requester, scope since the last
// confirmed deploy, risk, side effects and way back. The last confirmed deploy is GitHub evidence (latestWsDeploy:
// the newest deploy job on main succeeded and nothing is unfinished), not a read of the VPS. Checks of the deploy
// job are listed as not run yet: nothing here reaches the VPS or reports a check that has not happened.
const SHA = /^[a-f0-9]{40}$/;
const RUN = /^[1-9][0-9]{0,19}$/;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(\[bot\])?$/;
const WS_WORKFLOW = '.github/workflows/ws-server-deploy.yml';
const MAX_LIST = 20;
const REPOSITORY = 'https://github.com/krzysztofcal/arcadePlatform';

export const TARGET = 'ws-production: Production WS server ws.kcswh.pl (/opt/ws-server, account arcade-release)';
export const RISK = 'Restarts ws-server.service once. Before the restart the restart gate holds new hands, waits for running hands and drains; the restart disconnects connected players, who reconnect. New hands resume only after local and public healthz and the WS handshake smoke pass. A failure after the release switch keeps the hold (play stays paused) until the owner decides.';
export const SIDE_EFFECTS = 'Holds the shared deploy/maintenance lock during the run, writes release-metadata.json on the VPS and uploads the ws-release-receipt artifact (90 days) used by Release Record. WWW Production is not published by this workflow.';
export const WAY_BACK = 'Before the release switch a failure aborts and the previous release keeps running. After the switch a failed check rolls the release link back to the previous V3 release through the restart gate; an uncertain restart is left to the owner. Returning to an older version later is a revert on main and a new exact-SHA dispatch: this workflow deploys only the current main HEAD.';
// Deploy job steps after the approval; none of them has run when the owner reads the summary.
export const AFTER_APPROVAL = Object.freeze([
  'authorize the exact SHA again (releaseSha, checkout and main HEAD)',
  'shared deploy/maintenance lock on the VPS',
  'build and package the WS artifact',
  'Production env preflight',
  'restart gate: hold new hands and drain',
  'main HEAD recheck before the release switch',
  'release switch and restart',
  'local and public healthz',
  'WS handshake smoke',
  'resume new hands and record the release receipt',
]);

const fail = (reason) => { throw new Error(reason); };

// Inputs reach this check only as values; every rule of the deploy job's authorize step is applied before approval.
export function checkRequest({ releaseSha, confirmation, githubSha, headSha, mainSha }) {
  if (!SHA.test(String(releaseSha))) fail('releaseSha must be a full lowercase commit SHA');
  if (releaseSha !== githubSha) fail('releaseSha does not match the dispatched main revision');
  if (headSha !== releaseSha) fail('checkout does not match releaseSha');
  if (confirmation !== `DEPLOY WS PRODUCTION ${releaseSha}`) fail('confirmation phrase mismatch');
  if (mainSha !== releaseSha) fail(`main advanced to ${SHA.test(String(mainSha)) ? mainSha : 'an unknown revision'}; dispatch the current main SHA`);
  return ['releaseSha is a full SHA equal to the dispatched main revision and the checkout', 'confirmation phrase matches', 'main HEAD still equals releaseSha'];
}

// The run being approved is in progress by definition, so it is left out; any other unfinished run gives no evidence.
// unfinished: every unfinished dispatch run on main, queried by status, so a run beyond the recent page still counts.
export const UNFINISHED = Object.freeze(['requested', 'queued', 'pending', 'waiting', 'in_progress']);
export function lastConfirmedDeploy(runs, currentRunId, unfinished) {
  if (!Array.isArray(runs) || !Array.isArray(unfinished)) return null;
  const other = (run) => String(run.id) !== String(currentRunId);
  if (unfinished.some(other)) return null;
  return latestWsDeploy(runs.filter(other));
}

// Commit subjects and paths are shown only inside code spans, so no Markdown (links, images, emphasis) renders;
// backticks, pipes, angle brackets and line breaks are removed so the span and the table cannot be closed.
export const inert = (text, max = 120) => String(text).replace(/[`|<>\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function releaseScope(fromSha, toSha, git) {
  if (fromSha === toSha) return { relation: 'same', commits: [], commitCount: 0, wsFiles: [] };
  const run = (args) => {
    const result = git(args);
    if (result.status !== 0) fail('scope_unknown');
    return result.stdout;
  };
  const relation = git(['merge-base', '--is-ancestor', fromSha, toSha]).status === 0 ? 'ahead' : 'not_ancestor';
  const commitCount = Number(run(['rev-list', '--count', `${fromSha}..${toSha}`]).trim());
  if (!Number.isInteger(commitCount)) fail('scope_unknown');
  const commits = run(['log', '--format=%H %s', `-${MAX_LIST}`, `${fromSha}..${toSha}`]).split('\n').filter(Boolean)
    .map((line) => ({ sha: line.slice(0, 40), subject: line.slice(41) }));
  // The deploy workflow itself builds and packages the artifact, so a change to it counts as a WS input change.
  const paths = [...new Set([WS_WORKFLOW, ...wsPackagedPaths(run(['show', `${fromSha}:${WS_WORKFLOW}`])), ...wsPackagedPaths(run(['show', `${toSha}:${WS_WORKFLOW}`]))])];
  const wsFiles = run(['diff', '--name-only', fromSha, toSha, '--', ...paths]).split('\n').filter(Boolean);
  return { relation, commits, commitCount, wsFiles };
}

export function renderSummary({ releaseSha, actor, triggeringActor, runId, attempt, checks, last, scope, scopeError }) {
  if (!SHA.test(String(releaseSha)) || !LOGIN.test(String(actor)) || !LOGIN.test(String(triggeringActor)) || !RUN.test(String(runId)) || !RUN.test(String(attempt))) fail('invalid_summary_input');
  if (last && !SHA.test(String(last.sha))) fail('invalid_summary_input');
  // Match releaseScope's direct tree diff, also when the deployed SHA is not an ancestor.
  const compare = last ? `${REPOSITORY}/compare/${last.sha}..${releaseSha}` : null;
  let lastText = 'unknown: no successful WS Production deploy is the newest one on main, or another deploy run is unfinished';
  let scopeText = 'unknown: no last confirmed deploy to compare with';
  const lines = [];
  if (last) {
    lastText = `\`${last.sha}\` (run ${last.runId}). GitHub evidence: the newest deploy job on main succeeded; not read from the VPS`;
    if (scopeError || !scope) scopeText = 'unknown: the history between the two revisions could not be read';
    else if (scope.relation === 'same') scopeText = 'same SHA as the last confirmed deploy: a restart into the same release';
    else {
      scopeText = `${scope.commitCount} commit(s) since the last confirmed deploy; ${scope.wsFiles.length ? `${scope.wsFiles.length} WS input file(s) changed (packaged files or the deploy workflow)` : 'no WS input file changed (packaged files and the deploy workflow); the artifact is rebuilt, not compared'}`;
      if (scope.relation === 'not_ancestor') scopeText += '. The last confirmed deploy is NOT an ancestor of this SHA: compare carefully';
      lines.push('', `### Commits since the last confirmed deploy (newest first, at most ${MAX_LIST})`, '');
      for (const c of scope.commits) lines.push(`- \`${c.sha.slice(0, 12)}\` \`${inert(c.subject) || '(no subject)'}\``);
      if (scope.commitCount > scope.commits.length) lines.push(`- … ${scope.commitCount - scope.commits.length} more`);
      lines.push('', '### WS input files changed (packaged files and the deploy workflow)', '');
      if (!scope.wsFiles.length) lines.push('- none');
      // Compare anchors also work for deleted files and never place an untrusted path in a URL.
      for (const f of scope.wsFiles.slice(0, MAX_LIST)) lines.push(`- [\`${inert(f, 200)}\`](${compare}#diff-${createHash('sha256').update(f).digest('hex')})`);
      if (scope.wsFiles.length > MAX_LIST) lines.push(`- … ${scope.wsFiles.length - MAX_LIST} more`);
    }
  }
  return [
    `## Approve only if expected: WS Production release ${releaseSha}`,
    '',
    '| | |',
    '|---|---|',
    `| Target | ${TARGET} |`,
    `| Release SHA | \`${releaseSha}\` (main HEAD at dispatch) |`,
    `| Requested by | \`${actor}\`, triggered by \`${triggeringActor}\` |`,
    `| Run | ${runId}, attempt ${attempt} |`,
    `| Last confirmed deploy | ${lastText} |`,
    `| Scope | ${scopeText} |`,
    `| Risk and downtime | ${RISK} |`,
    `| Side effects | ${SIDE_EFFECTS} |`,
    `| Way back | ${WAY_BACK} |`,
    '',
    compare ? `[View changes](${compare})` : `[View commit](${REPOSITORY}/commit/${releaseSha})`,
    ...lines,
    '',
    '### Checks',
    '',
    '- Passed in this run before approval: the impact and validate jobs succeeded (their logs show which steps ran) and the request checks:',
    ...checks.map((c) => `  - ${c}`),
    '- NOT RUN YET: they run only after approval, in the deploy job:',
    ...AFTER_APPROVAL.map((c) => `  - ${c}`),
    '',
  ].join('\n');
}

async function main(env) {
  const git = (args) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const api = async (route) => {
    const res = await fetch(`${env.GITHUB_API_URL}/repos/${env.GITHUB_REPOSITORY}/${route}`, {
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!res.ok) fail(`github_api_${res.status}`);
    return res.json();
  };
  const mainSha = (await api('commits/main')).sha;
  const checks = checkRequest({ releaseSha: env.RELEASE_SHA_INPUT, confirmation: env.RELEASE_CONFIRMATION, githubSha: env.GITHUB_SHA,
    headSha: git(['rev-parse', 'HEAD']).stdout.trim(), mainSha });
  let last = null;
  let scope = null;
  let scopeError = false;
  try {
    const route = 'actions/workflows/ws-server-deploy.yml/runs?branch=main&event=workflow_dispatch';
    const unfinished = [];
    for (const status of UNFINISHED) unfinished.push(...(await api(`${route}&status=${status}&per_page=100`)).workflow_runs);
    const { workflow_runs: runs } = await api(`${route}&per_page=50`);
    for (const run of runs) run.jobs = (await api(`actions/runs/${run.id}/jobs?filter=all&per_page=100`)).jobs;
    last = lastConfirmedDeploy(runs, env.GITHUB_RUN_ID, unfinished);
  } catch {
    last = null;
  }
  if (last) {
    try {
      scope = releaseScope(last.sha, env.RELEASE_SHA_INPUT, git);
    } catch {
      scopeError = true;
    }
  }
  fs.appendFileSync(env.GITHUB_STEP_SUMMARY, renderSummary({ releaseSha: env.RELEASE_SHA_INPUT, actor: env.GITHUB_ACTOR,
    triggeringActor: env.GITHUB_TRIGGERING_ACTOR, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, checks, last, scope, scopeError }));
  const scopeNote = !last ? 'last confirmed deploy unknown' : scopeError ? 'scope unknown' : scope.relation === 'same' ? 'same SHA as the last confirmed deploy' : `${scope.commitCount} commit(s), ${scope.wsFiles.length} WS input file(s) changed`;
  process.stdout.write(`::notice title=WS Production release ${env.RELEASE_SHA_INPUT}::Restarts Production WS (${scopeNote}). Read the request job summary before approving ws-production.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.env).catch((error) => {
    process.stderr.write(`ws-release-approval: ${error.message}\n`);
    process.exit(1);
  });
}
