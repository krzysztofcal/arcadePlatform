import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repositoryRoot, 'infra/vps/vps-maintenance.sh');
const NOW = 2_000_000_000;

function gitSha(index = 0) {
  return `${Number(index).toString(16).padStart(2, '0')}${'a'.repeat(38)}`;
}

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

function entrypointFixture(t) {
  const directory = fixture(t);
  const appRoot = path.join(directory, 'app');
  const releasesRoot = path.join(appRoot, 'releases');
  const tmpRoot = path.join(directory, 'tmp');
  const currentLink = path.join(appRoot, 'current');
  const lock = path.join(appRoot, '.deploy-maintenance.lock');
  fs.mkdirSync(releasesRoot, { recursive: true });
  fs.mkdirSync(tmpRoot);
  fs.writeFileSync(lock, '');
  const current = release(releasesRoot, gitSha(0), '2000-01-01T00:00:00Z\n');
  const app = path.join(current, 'ws-server');
  fs.mkdirSync(app);
  fs.symlinkSync(`releases/${path.basename(current)}/ws-server`, currentLink);
  const previous = Array.from({ length: 6 }, (_, index) =>
    release(releasesRoot, gitSha(index + 1), `2001-01-0${6 - index}T00:00:00Z\n`));
  const oldTemp = path.join(tmpRoot, 'arcadeplatform-ws-12345-1');
  fs.mkdirSync(oldTemp);
  fs.utimesSync(oldTemp, 946684800, 946684800);

  // Remap only the fixed constants in a fixture copy; execute its real CLI/main.
  // Production retains fixed paths and gains no test-only path overrides.
  let source = fs.readFileSync(script, 'utf8');
  for (const [name, value] of Object.entries({
    APP_ROOT: appRoot, RELEASES_ROOT: releasesRoot, CURRENT_RELEASE_LINK: currentLink,
    TMP_ROOT: tmpRoot, LOCK_FILE: lock,
  })) {
    assert.match(source, new RegExp(`^readonly ${name}='[^']*'$`, 'm'));
    source = source.replace(new RegExp(`^readonly ${name}='[^']*'$`, 'm'), `readonly ${name}='${value}'`);
  }
  const executable = path.join(directory, 'maintenance.sh');
  fs.writeFileSync(executable, source);
  const calls = path.join(directory, 'state-reads');
  const instrumentation = path.join(directory, 'instrumentation.sh');
  fs.writeFileSync(instrumentation, `
date() {
  if [[ "$*" == '-u +%s' ]]; then printf '%s\\n' '${NOW}'; else command date "$@"; fi
}
realpath() {
  printf 'realpath:%s\\n' "$*" >> "$CALLS";
  command realpath "$@"
}
find() {
  printf 'find:%s\\n' "$1" >> "$CALLS";
  if command flock -n "$LOCK_FILE" true; then
    printf 'enumeration ran without the maintenance lock\\n' >&2
    return 97
  fi
  command find "$@"
}
stat() {
  if [[ "$1" == '-c' && "$2" == '%U' && "$4" == "$FIXTURE_TMP_ROOT/"* ]]; then
    printf 'copilot\\n'
  else
    command stat "$@"
  fi
}
`);
  const options = {
    encoding: 'utf8', timeout: 3000,
    env: { ...process.env, BASH_ENV: instrumentation, CALLS: calls, FIXTURE_TMP_ROOT: tmpRoot },
  };
  return { executable, options, current, app, previous, oldTemp, currentLink, lock, calls, releasesRoot, tmpRoot };
}

test('uses only fixed maintenance paths and a guarded dry-run CLI without process-management commands', () => {
  const source = fs.readFileSync(script, 'utf8');

  assert.match(source, /^readonly APP_ROOT='\/opt\/ws-server'$/m);
  assert.match(source, /^readonly RELEASES_ROOT='\/opt\/ws-server\/releases'$/m);
  assert.match(source, /^readonly CURRENT_RELEASE_LINK='\/opt\/ws-server\/current'$/m);
  assert.match(source, /^readonly TMP_ROOT='\/tmp'$/m);
  assert.match(source, /^readonly LOCK_FILE='\/opt\/ws-server\/.deploy-maintenance\.lock'$/m);
  assert.match(source, /^readonly DEPLOY_USER='copilot'$/m);
  assert.match(source, /if \[\[ "\$\{BASH_SOURCE\[0\]\}" == "\$0" \]\]; then\n  main "\$@"\nfi/);
  assert.match(source, /\[\[ "\$1" != --dry-run \]\]/);
  assert.match(source, /\[\[ "\$1" == --apply \]\]/);
  assert.match(source, /local dry_run=true/);
  assert.match(source, /dry_run=false/);
  assert.match(source, /elif \(\( \$# != 0 \)\); then\n    return 1/);
  assert.match(source, /arcadeplatform-\(ws\|infra\)-\[0-9\]\+-\[0-9\]\+/);
  assert.match(source, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(source, /owner=\$\(stat -c %U -- "\$candidate_real"\)/);
  assert.doesNotMatch(source, /^\s*(?:systemctl|docker|kill|pkill)\b/m);
  assert.doesNotMatch(source, /\b(?:prune|cache|runner|postgres)\b/i);
});

test('uses a valid deployment marker even when the release directory mtime is epoch', (t) => {
  const directory = fixture(t);
  const target = release(directory, gitSha(10), '2033-05-18T03:33:20Z\n');
  fs.utimesSync(target, 0, 0);

  const result = bash('release_age_epoch "$2" "$3"', [target, String(NOW)]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '2000000000');
});

test('uses a positive birth epoch for a markerless release', (t) => {
  const directory = fixture(t);
  const target = release(directory, gitSha(11));

  const result = bash('release_age_epoch "$2" "$3"', [target, String(NOW)]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^[1-9][0-9]*$/);
});

test('malformed markers abort release cleanup before any release is removed', (t) => {
  const directory = fixture(t);
  const current = release(directory, gitSha(12), '2033-05-18T03:33:19Z\n');
  const old = release(directory, gitSha(13), 'not-a-timestamp\n');

  const result = bash('cleanup_releases "$2" "$3" "$4" false', [directory, current, String(NOW)]);

  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(current), true);
  assert.equal(fs.existsSync(old), true);
});

test('an unavailable birth epoch aborts release cleanup before any release is removed', (t) => {
  const directory = fixture(t);
  const current = release(directory, gitSha(14), '2033-05-18T03:33:19Z\n');
  const old = release(directory, gitSha(15));

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
  const current = release(directory, gitSha(16), '2033-05-18T03:33:19Z\n');
  const previous = [
    [gitSha(17), '2033-05-18T03:33:18Z\n'],
    [gitSha(18), '2033-05-18T03:33:17Z\n'],
    [gitSha(19), '2033-05-18T03:33:16Z\n'],
    [gitSha(20), '2033-05-18T03:33:15Z\n'],
    [gitSha(21), '2033-05-18T03:33:14Z\n'],
    [gitSha(22), '2033-05-01T00:00:00Z\n'],
  ].map(([name, marker]) => release(directory, name, marker));

  const result = bash('cleanup_releases "$2" "$3" "$4" false', [directory, current, String(NOW)]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(current), true);
  for (const target of previous.slice(0, 5)) assert.equal(fs.existsSync(target), true);
  assert.equal(fs.existsSync(previous[5]), false);
});

test('ignores manual non-SHA release directories even with malformed metadata', (t) => {
  const directory = fixture(t);
  const current = release(directory, gitSha(23), '2033-05-18T03:33:19Z\n');
  const previous = [
    [24, '2033-05-18T03:33:18Z\n'],
    [25, '2033-05-05T00:00:00Z\n'],
    [26, '2033-05-04T00:00:00Z\n'],
    [27, '2033-05-03T00:00:00Z\n'],
    [28, '2033-05-02T00:00:00Z\n'],
    [29, '2033-05-01T00:00:00Z\n'],
  ].map(([index, marker]) => release(directory, gitSha(index), marker));
  const manual = release(directory, 'manual-release-2026-09-17', 'not-a-timestamp\n');

  const result = bash('cleanup_releases "$2" "$3" "$4" false', [directory, current, String(NOW)]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(manual), true);
  assert.equal(fs.existsSync(previous[5]), false);
});

test('removes only old allowlisted temporary directories', (t) => {
  const directory = fixture(t);
  const oldAllowed = path.join(directory, 'arcadeplatform-ws-12345-1');
  const oldInfraAllowed = path.join(directory, 'arcadeplatform-infra-67890-2');
  const recentAllowed = path.join(directory, 'arcadeplatform-infra-67890-3');
  const malformedAllowed = path.join(directory, 'arcadeplatform-ws-12345-1-extra');
  const oldOther = path.join(directory, 'unrelated-old');
  for (const target of [oldAllowed, oldInfraAllowed, recentAllowed, malformedAllowed, oldOther]) fs.mkdirSync(target);
  for (const target of [oldAllowed, oldInfraAllowed, malformedAllowed, oldOther]) {
    fs.utimesSync(target, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  }
  fs.utimesSync(oldOther, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  fs.utimesSync(recentAllowed, new Date('2100-01-01T00:00:00Z'), new Date('2100-01-01T00:00:00Z'));

  const ownerMock = `stat() {
  if [[ "$1" == '-c' && "$2" == '%U' && "$4" == "$TMP_FIXTURE_ROOT/"* ]]; then
    printf 'copilot\\n'
  else
    command stat "$@"
  fi
}; `;
  const result = bash(
    'cleanup_known_tmp_dirs "$2" "$3" false',
    [directory, String(NOW)],
    ownerMock,
    { env: { ...process.env, TMP_FIXTURE_ROOT: directory } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(oldAllowed), false);
  assert.equal(fs.existsSync(oldInfraAllowed), false);
  assert.equal(fs.existsSync(recentAllowed), true);
  assert.equal(fs.existsSync(malformedAllowed), true);
  assert.equal(fs.existsSync(oldOther), true);
});

test('skips old exact temporary directories not owned by the expected deploy user', (t) => {
  const directory = fixture(t);
  const legacy = path.join(directory, 'arcadeplatform-ws-99999-1');
  const eligible = path.join(directory, 'arcadeplatform-infra-88888-2');
  for (const target of [legacy, eligible]) {
    fs.mkdirSync(target);
    fs.utimesSync(target, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  }

  const ownerMock = `stat() {
  if [[ "$1" == '-c' && "$2" == '%U' ]]; then
    case "$4" in
      "$LEGACY_TMP") printf 'arcade\\n' ;;
      "$ELIGIBLE_TMP") printf 'copilot\\n' ;;
      *) return 99 ;;
    esac
  else
    command stat "$@"
  fi
}; `;
  const result = bash(
    'cleanup_known_tmp_dirs "$2" "$3" false',
    [directory, String(NOW)],
    ownerMock,
    { env: { ...process.env, LEGACY_TMP: legacy, ELIGIBLE_TMP: eligible } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(legacy), true);
  assert.equal(fs.existsSync(eligible), false);
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

test('entrypoint defaults to dry-run and never deletes without --apply', (t) => {
  const f = entrypointFixture(t);

  for (const args of [[], ['--dry-run']]) {
    const result = spawnSync('bash', [f.executable, ...args], f.options);

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(f.app), true);
    for (const target of [f.current, ...f.previous, f.oldTemp]) assert.equal(fs.existsSync(target), true);
  }
});

test('entrypoint accepts --apply for the Production app symlink and holds the lock through both reconciliations', (t) => {
  const f = entrypointFixture(t);
  const result = spawnSync('bash', [f.executable, '--apply'], f.options);

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(f.app), true);
  for (const target of f.previous.slice(0, 5)) assert.equal(fs.existsSync(target), true);
  assert.equal(fs.existsSync(f.previous[5]), false);
  assert.equal(fs.existsSync(f.oldTemp), false);
  const calls = fs.readFileSync(f.calls, 'utf8').split('\n');
  assert.ok(calls.includes(`find:${f.releasesRoot}`));
  assert.ok(calls.includes(`find:${f.tmpRoot}`));
});

test('failed release enumeration after valid candidates aborts without deletion', (t) => {
  const f = entrypointFixture(t);
  const result = bash(
    'cleanup_releases "$2" "$3" "$4" false',
    [f.releasesRoot, f.current, String(NOW)],
    'find() { command find "$@"; return 42; }; ',
  );

  for (const target of [f.current, ...f.previous]) assert.equal(fs.existsSync(target), true, target);
  assert.notEqual(result.status, 0);
});

test('failed temp enumeration after valid candidates aborts without deletion', (t) => {
  const f = entrypointFixture(t);
  const result = bash(
    'cleanup_known_tmp_dirs "$2" "$3" false',
    [f.tmpRoot, String(NOW)],
    'find() { command find "$@"; return 42; }; ',
  );

  assert.equal(fs.existsSync(f.oldTemp), true);
  assert.notEqual(result.status, 0);
});

test('held lock prevents entrypoint current resolution and reconciliation', (t) => {
  const f = entrypointFixture(t);
  // Keep the holder shell alive after its child, preventing a last-command exec.
  const result = spawnSync('bash', ['-c',
    'exec 9<> "$1"; flock -n 9 || exit 99; bash "$2"; status=$?; exit "$status"', 'bash', f.lock, f.executable,
  ], f.options);

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(f.calls), false, 'must not resolve current or enumerate while lock is held');
  for (const target of [f.current, ...f.previous, f.oldTemp]) assert.equal(fs.existsSync(target), true);
});

test('entrypoint rejects current targets outside the direct release ws-server layout', (t) => {
  for (const layout of ['release-root', 'wrong-app', 'nested-app', 'outside-releases']) {
    const f = entrypointFixture(t);
    const target = {
      'release-root': f.current,
      'wrong-app': path.join(f.current, 'other-app'),
      'nested-app': path.join(f.current, 'nested', 'ws-server'),
      'outside-releases': path.join(f.tmpRoot, 'outside', 'ws-server'),
    }[layout];
    fs.mkdirSync(target, { recursive: true });
    fs.unlinkSync(f.currentLink);
    fs.symlinkSync(target, f.currentLink);

    const result = spawnSync('bash', [f.executable], f.options);

    assert.equal(result.error, undefined, result.error?.message);
    assert.notEqual(result.status, 0, layout);
    for (const retained of [f.current, ...f.previous, f.oldTemp]) {
      assert.equal(fs.existsSync(retained), true, `${layout}: ${retained}`);
    }
    assert.doesNotMatch(fs.readFileSync(f.calls, 'utf8'), /^find:/m, layout);
  }
});
