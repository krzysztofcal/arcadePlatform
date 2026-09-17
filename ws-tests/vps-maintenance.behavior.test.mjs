import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repositoryRoot, 'infra/vps/vps-maintenance.sh');
const NOW = 2_000_000_000;

function bash(functionCall, args = [], prefix = '', options = {}) {
  return spawnSync('bash', ['-c', `source "$1"; ${prefix}${functionCall}`, 'bash', script, ...args], {
    encoding: 'utf8',
    ...options,
  });
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vps-maintenance-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function release(directory, name, deployedAt) {
  const releaseDirectory = path.join(directory, name);
  fs.mkdirSync(releaseDirectory);
  if (deployedAt !== undefined) {
    fs.writeFileSync(path.join(releaseDirectory, '.deployed-at'), deployedAt);
  }
  return releaseDirectory;
}

test('uses only fixed maintenance paths and a guarded dry-run CLI without process-management commands', () => {
  const source = fs.readFileSync(script, 'utf8');

  assert.match(source, /^readonly APP_ROOT='\/opt\/ws-server'$/m);
  assert.match(source, /^readonly RELEASES_ROOT='\/opt\/ws-server\/releases'$/m);
  assert.match(source, /^readonly CURRENT_RELEASE_LINK='\/opt\/ws-server\/current'$/m);
  assert.match(source, /^readonly TMP_ROOT='\/tmp'$/m);
  assert.match(source, /^readonly LOCK_FILE='\/opt\/ws-server\/.deploy-maintenance\.lock'$/m);
  assert.match(source, /if \[\[ "\$\{BASH_SOURCE\[0\]\}" == "\$0" \]\]; then\n  main "\$@"\nfi/);
  assert.match(source, /\[\[ "\$1" == --dry-run \]\] \|\| return 1/);
  assert.match(source, /elif \(\( \$# != 0 \)\); then\n    return 1/);
  assert.doesNotMatch(source, /^\s*(?:systemctl|docker|kill|pkill)\b/m);
  assert.doesNotMatch(source, /\b(?:prune|cache|runner|postgres)\b/i);
});

test('uses a valid deployment marker even when the release directory mtime is epoch', (t) => {
  const directory = fixture(t);
  const target = release(directory, 'release-a', '2033-05-18T03:33:20Z\n');
  fs.utimesSync(target, 0, 0);

  const result = bash('release_age_epoch "$2" "$3"', [target, String(NOW)]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '2000000000');
});

test('uses a positive birth epoch for a markerless release', (t) => {
  const directory = fixture(t);
  const target = release(directory, 'release-a');

  const result = bash('release_age_epoch "$2" "$3"', [target, String(NOW)]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^[1-9][0-9]*$/);
});

test('malformed markers abort release cleanup before any release is removed', (t) => {
  const directory = fixture(t);
  const current = release(directory, 'current-release', '2033-05-18T03:33:19Z\n');
  const old = release(directory, 'old-release', 'not-a-timestamp\n');

  const result = bash('cleanup_releases "$2" "$3" "$4" false', [directory, current, String(NOW)]);

  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(current), true);
  assert.equal(fs.existsSync(old), true);
});

test('an unavailable birth epoch aborts release cleanup before any release is removed', (t) => {
  const directory = fixture(t);
  const current = release(directory, 'current-release', '2033-05-18T03:33:19Z\n');
  const old = release(directory, 'old-release');

  const result = bash(
    'cleanup_releases "$2" "$3" "$4" false',
    [directory, current, String(NOW)],
    "stat() { if [[ \"$1\" == '-c' && \"$2\" == '%W' ]]; then printf '0\\n'; else command stat \"$@\"; fi; }; ",
  );

  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(current), true);
  assert.equal(fs.existsSync(old), true);
});

test('retains current plus five newest previous releases and removes the old sixth previous release', (t) => {
  const directory = fixture(t);
  const current = release(directory, 'release-current', '2033-05-18T03:33:19Z\n');
  const previous = [
    ['release-1', '2033-05-18T03:33:18Z\n'],
    ['release-2', '2033-05-18T03:33:17Z\n'],
    ['release-3', '2033-05-18T03:33:16Z\n'],
    ['release-4', '2033-05-18T03:33:15Z\n'],
    ['release-5', '2033-05-18T03:33:14Z\n'],
    ['release-6', '2033-05-01T00:00:00Z\n'],
  ].map(([name, marker]) => release(directory, name, marker));

  const result = bash('cleanup_releases "$2" "$3" "$4" false', [directory, current, String(NOW)]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(current), true);
  for (const target of previous.slice(0, 5)) assert.equal(fs.existsSync(target), true);
  assert.equal(fs.existsSync(previous[5]), false);
});

test('removes only old allowlisted temporary directories', (t) => {
  const directory = fixture(t);
  const oldAllowed = path.join(directory, 'arcadeplatform-ws-old');
  const recentAllowed = path.join(directory, 'arcadeplatform-infra-recent');
  const oldOther = path.join(directory, 'unrelated-old');
  for (const target of [oldAllowed, recentAllowed, oldOther]) fs.mkdirSync(target);
  fs.utimesSync(oldAllowed, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  fs.utimesSync(oldOther, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  fs.utimesSync(recentAllowed, new Date('2100-01-01T00:00:00Z'), new Date('2100-01-01T00:00:00Z'));

  const result = bash('cleanup_known_tmp_dirs "$2" "$3" false', [directory, String(NOW)]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(oldAllowed), false);
  assert.equal(fs.existsSync(recentAllowed), true);
  assert.equal(fs.existsSync(oldOther), true);
});

test('fails immediately when another process holds the fd-9 maintenance lock', async (t) => {
  const directory = fixture(t);
  const lock = path.join(directory, 'maintenance.lock');
  fs.writeFileSync(lock, '');
  const holder = spawn('bash', ['-c', 'exec 9>"$1"; flock -n 9; printf ready; read ignored', 'bash', lock], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    holder.stdout.once('data', resolve);
    holder.once('error', reject);
    holder.once('exit', (code) => reject(new Error(`lock holder exited early: ${code}`)));
  });
  t.after(() => holder.stdin.end());

  const result = bash('acquire_maintenance_lock "$2"', [lock], '', { timeout: 1000 });

  assert.notEqual(result.status, 0);
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
});
