import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { githubWsRelease, parseBuildInfo } from './www-production-release.mjs';

// GitHub Release manifest for WWW, WS and Android (#1159 Addendum B). A release is an audited record of what is
// already running: it never deploys, restarts WS, migrates, publishes WWW or publishes to Google Play. Each record
// changes one component, verified from evidence that already exists, and carries the other components unchanged
// from the previous manifest. Only whitelisted fields are written; no input is copied through.
export const COMPONENTS = Object.freeze(['www', 'ws', 'android']);
export const WWW_ORIGIN = 'https://play.kcswh.pl';
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DEPLOY = /^[a-f0-9]{24}$/;
const RUN_ID = /^[1-9][0-9]{0,19}$/;
const TAG = /^release-[0-9]{8}-[1-9][0-9]{0,9}$/;
const ANDROID_TRACKS = Object.freeze(['internal', 'closed', 'open', 'production']);

const fail = (reason) => { throw new Error(reason); };

// WWW: the live Production build-info must name exactly the given deploy and commit.
export function wwwEvidence(buildInfoJs, deployId) {
  if (!DEPLOY.test(String(deployId))) fail('www_deploy_id_invalid');
  const info = parseBuildInfo(buildInfoJs);
  if (!info) fail('www_build_info_unreadable');
  if (info.context !== 'production' || info.isProduction !== true || info.branch !== 'main') fail('www_not_production_main');
  if (info.deployId !== deployId) fail('www_deploy_not_published');
  if (!SHA.test(String(info.commitHash))) fail('www_commit_invalid');
  return { sha: info.commitHash, netlifyDeployId: deployId, buildTime: String(info.buildTime || '') };
}

// WS: a successful owner-approved WS Server Deploy dispatch on main, the receipt its deploy job uploaded, and GitHub
// evidence that it is still the latest deploy (githubWsRelease: newest deploy job on main, nothing unfinished).
// Release Record does not read the VPS, so this is the last confirmed deployment, not a runtime check
// (scripts/www-production-release.mjs checks the VPS `current` release with SSH).
export function wsEvidence(run, jobs, receipt, recentRuns) {
  if (!run || run.path !== '.github/workflows/ws-server-deploy.yml' || run.event !== 'workflow_dispatch'
    || run.head_branch !== 'main' || run.status !== 'completed' || run.conclusion !== 'success') fail('ws_run_not_successful_main_dispatch');
  const deploy = (jobs?.jobs || []).filter((job) => job.name === 'deploy');
  if (deploy.length !== 1 || deploy[0].conclusion !== 'success') fail('ws_deploy_job_not_successful');
  if (!receipt || receipt.releaseSha !== run.head_sha || !SHA.test(String(receipt.releaseSha))
    || String(receipt.runId) !== String(run.id) || receipt.environment !== 'ws-production' || !SHA256.test(String(receipt.distSha256))) {
    fail('ws_receipt_mismatch');
  }
  if (!Array.isArray(recentRuns) || githubWsRelease(recentRuns) !== run.head_sha) fail('ws_not_latest_github_deploy');
  return { sha: receipt.releaseSha, distSha256: receipt.distSha256, deployRunId: String(run.id), environment: 'ws-production',
    evidence: 'latest-github-deploy' };
}

// Android: until M1 builds the signed AAB in CI, only the repository owner attests the Play upload (never an agent on
// the owner's behalf). Stage/debug APKs are never release evidence and nothing of the AAB is attached.
export function androidEvidence({ sha, versionName, versionCode, aabSha256, track, attestedBy, owner }) {
  if (!SHA.test(String(sha))) fail('android_sha_invalid');
  if (!/^[0-9]+\.[0-9]+(\.[0-9]+)?$/.test(String(versionName))) fail('android_version_name_invalid');
  if (!/^[1-9][0-9]{0,9}$/.test(String(versionCode))) fail('android_version_code_invalid');
  if (!SHA256.test(String(aabSha256))) fail('android_aab_sha256_invalid');
  if (!ANDROID_TRACKS.includes(track)) fail('android_track_invalid');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(owner)) || attestedBy !== owner) fail('android_attestation_owner_only');
  return { sha, versionName, versionCode: Number(versionCode), aabSha256, track, evidence: 'attested', attestedBy };
}

// The previous record is trusted only as this workflow's own owner publication: an immutable release (assets and tag
// locked by GitHub) created by the publish job's GITHUB_TOKEN (github-actions[bot]) with the manifest as its only
// asset, in an owner-dispatched Release Record run on main that the manifest names and whose number the tag carries.
// A release created or changed by anyone else, including the code agent, stops the record.
export const RECORD_WORKFLOW = '.github/workflows/release-record.yml';
const ACTIONS_BOT = 'github-actions[bot]';
export function previousRecord(manifest, release, run, jobs, owner) {
  if (manifest == null && release == null) return null;
  const assets = release?.assets || [];
  if (!manifest || !release || release.tag_name !== manifest.tag || release.draft !== false || release.prerelease !== false
    || release.immutable !== true || release.author?.login !== ACTIONS_BOT || assets.length !== 1
    || assets[0].name !== 'release-manifest.json' || assets[0].uploader?.login !== ACTIONS_BOT) fail('previous_release_untrusted');
  const by = manifest.recordedBy || {};
  const publish = (jobs?.jobs || []).filter((job) => job.name === 'publish');
  if (!run || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(owner)) || String(run.id) !== String(by.runId) || run.path !== RECORD_WORKFLOW || run.event !== 'workflow_dispatch' || run.head_branch !== 'main'
    || run.actor?.login !== owner || run.triggering_actor?.login !== owner || by.actor !== owner || by.triggeringActor !== owner
    || String(manifest.tag).split('-')[2] !== String(run.run_number) || publish.length !== 1 || publish[0].conclusion !== 'success') {
    fail('previous_record_not_owner_published');
  }
  return manifest;
}

export function buildManifest({ previous, component, evidence, tag, recordedAt, recordedBy }) {
  if (!COMPONENTS.includes(component)) fail('component_invalid');
  if (!TAG.test(String(tag))) fail('tag_invalid');
  if (previous != null && (previous.schema !== 1 || !TAG.test(String(previous.tag)) || !previous.components)) fail('previous_manifest_invalid');
  if (previous && previous.tag === tag) fail('tag_exists');
  const components = {};
  for (const name of COMPONENTS) {
    components[name] = name === component ? { ...evidence, releasedIn: tag } : (previous?.components?.[name] ?? null);
  }
  return { schema: 1, tag, recordedAt, recordedBy, changed: component, previous: previous?.tag ?? null, components };
}

export function releaseNotes(manifest) {
  const line = (name) => {
    const c = manifest.components[name];
    if (!c) return `- ${name}: not recorded yet`;
    const extra = name === 'www' ? `Netlify deploy ${c.netlifyDeployId}`
      : name === 'ws' ? `dist sha256 ${c.distSha256}, run ${c.deployRunId} (latest GitHub deploy when recorded; VPS not read)`
        : `${c.versionName} (${c.versionCode}), AAB sha256 ${c.aabSha256}, track ${c.track}, attested by ${c.attestedBy}`;
    return `- ${name}${name === manifest.changed ? ' (changed)' : ''}: ${c.sha} — ${extra} — since ${c.releasedIn}`;
  };
  return [
    `Record of the running versions after a ${manifest.changed}-only release. This release deploys nothing.`,
    '',
    ...COMPONENTS.map(line),
    '',
    `Previous record: ${manifest.previous ?? 'none'}. Manifest: release-manifest.json.`,
  ].join('\n') + '\n';
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const env = process.env;
  const read = (file) => (file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
  try {
    const component = env.RELEASE_COMPONENT;
    if (!RUN_ID.test(String(env.GITHUB_RUN_ID)) || !RUN_ID.test(String(env.GITHUB_RUN_NUMBER))) fail('run_context_invalid');
    const tag = `release-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${env.GITHUB_RUN_NUMBER}`;
    let evidence;
    if (component === 'www') {
      evidence = wwwEvidence(fs.readFileSync(env.WWW_BUILD_INFO_FILE, 'utf8'), env.WWW_DEPLOY_ID);
    } else if (component === 'ws') {
      evidence = wsEvidence(read(env.WS_RUN_FILE), read(env.WS_JOBS_FILE), read(env.WS_RECEIPT_FILE), read(env.WS_RECENT_RUNS_FILE));
    } else {
      evidence = androidEvidence({ sha: env.ANDROID_SHA, versionName: env.ANDROID_VERSION_NAME, versionCode: env.ANDROID_VERSION_CODE,
        aabSha256: env.ANDROID_AAB_SHA256, track: env.ANDROID_TRACK, attestedBy: env.GITHUB_TRIGGERING_ACTOR, owner: env.GITHUB_REPOSITORY_OWNER });
    }
    const previous = previousRecord(read(env.PREVIOUS_MANIFEST_FILE), read(env.PREVIOUS_RELEASE_FILE), read(env.PREVIOUS_RUN_FILE),
      read(env.PREVIOUS_JOBS_FILE), env.GITHUB_REPOSITORY_OWNER);
    const manifest = buildManifest({ previous, component, evidence, tag,
      recordedAt: new Date().toISOString(), recordedBy: { actor: env.GITHUB_ACTOR, triggeringActor: env.GITHUB_TRIGGERING_ACTOR, runId: env.GITHUB_RUN_ID } });
    fs.writeFileSync('release-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync('release-notes.md', releaseNotes(manifest));
    process.stdout.write(`RELEASE_RECORD_READY ${tag} ${component} ${evidence.sha}\n`);
  } catch (error) {
    process.stdout.write(`RELEASE_RECORD_BLOCKED ${error.message}\n`);
    process.exitCode = 1;
  }
}
