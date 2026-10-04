import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyCiImpact, normalizePath } from '../scripts/ci-impact.mjs';

const read = name => fs.readFileSync(`.github/workflows/${name}.yml`, 'utf8');
const domains = ['core', 'web', 'chips_db', 'ws_poker', 'games', 'infra'];

test('representative changes select only their owned domains', () => {
  const cases = [
    ['docs/ci.md', []], ['README.md', []],
    ['supabase/migrations/fixture.sql', ['chips_db']],
    ['tests/chips/fixture.test.mjs', ['chips_db']],
    ['scripts/ops/chips-ledger-stage-automation.mjs', ['chips_db']],
    ['js/consent.js', ['core', 'web']],
    ['tests/e2e/consent-footer.spec.js', ['web']],
    ['js/games.json', ['games']],
    ['ws-server/poker/handlers/join.mjs', ['core', 'ws_poker']],
    ['tests/poker-ws-client.test.mjs', ['core', 'web', 'ws_poker']],
    ['tests/poker-v2-live.behavior.test.mjs', ['core', 'web', 'ws_poker']],
    ['infra/vps/Caddyfile', ['infra']],
    ['ws-tests/vps-maintenance.behavior.test.mjs', ['infra']],
  ];
  for (const [path, expected] of cases) {
    const result = classifyCiImpact([path]);
    assert.deepEqual(domains.filter(d => result[d]), expected, path);
  }
  assert.equal(normalizePath(' ./js\\consent.js '), 'js/consent.js');
});

test('empty, unknown, shared and CI inputs fail safe; unions retain all affected domains', () => {
  for (const paths of [[], ['unexpected/new.file'], ['shared/profile-avatar-projection.mjs'],
    ['package.json'], ['package-lock.json'], ['scripts/test-all.mjs'],
    ['scripts/ci-impact.mjs'], ['.github/workflows/tests.yml']]) {
    const result = classifyCiImpact(paths);
    assert.ok(domains.every(d => result[d]), JSON.stringify(paths));
  }
  assert.equal(classifyCiImpact(['docs/notes.md', 'js/consent.js']).web, true);
});

test('generic Chromium has one owner and never reruns the core harness', () => {
  const ci = read('ci');
  const tests = read('tests');
  assert.doesNotMatch(ci, /playwright install|npm run test:e2e|npm run test:unit/);
  assert.match(tests, /playwright install --with-deps chromium/);
  assert.equal((tests.match(/run: npm run test:e2e/g) || []).length, 1);
  assert.equal((tests.match(/run: npm test\n/g) || []).length, 1);
  assert.doesNotMatch(tests, /PLAYWRIGHT=1 npm test/);
  assert.match(tests, /needs\.impact\.outputs\.web == 'true'/);
  assert.match(read('playwright-matrix'), /playwright install --with-deps/);
});

test('actionlint keeps its universal PR context and mutation workflow validation stays independent', () => {
  const ci = read('ci');
  assert.match(ci, /on:\n  pull_request:\n/);
  assert.match(ci, /actionlint:\n    name: actionlint\n    if: \$\{\{ github.event_name == 'pull_request' \}\}/);
  assert.match(read('db-stage-apply-pr'), /node scripts\/check-db-migrations.mjs/);
});

test('test-only WS changes validate without enabling Production deployment', () => {
  for (const path of ['ws-tests/ws-lockfile-integrity.test.mjs', 'tests/poker-ws-client.test.mjs']) {
    const result = classifyCiImpact([path]);
    assert.equal(result.ws_poker, true);
    assert.equal(result.deploy_ws, false);
  }
  assert.equal(classifyCiImpact(['ws-server/server.mjs']).deploy_ws, true);
  assert.equal(classifyCiImpact(['shared/profile-avatar-projection.mjs']).deploy_ws, true);
  assert.equal(classifyCiImpact(['.github/workflows/ws-server-deploy.yml']).deploy_ws, true);
  assert.equal(classifyCiImpact([]).deploy_ws, false);
});

test('classifier CLI uses explicit PR/push ranges and fails safe on a missing range/manual event', async () => {
  const { spawnSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'ci-impact-'));
  const script = path.resolve('scripts/ci-impact.mjs');
  const git = args => {
    const r = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  try {
    git(['init', '-q']);
    git(['config', 'user.name', 'CI fixture']);
    git(['config', 'user.email', 'fixture@example.test']);
    fs.writeFileSync(path.join(directory, 'README.md'), 'baseline');
    git(['add', '.']); git(['commit', '-qm', 'base']);
    const base = git(['rev-parse', 'HEAD']);
    fs.mkdirSync(path.join(directory, 'docs'));
    fs.writeFileSync(path.join(directory, 'docs', 'notes.md'), 'docs');
    git(['add', '.']); git(['commit', '-qm', 'docs']);
    const head = git(['rev-parse', 'HEAD']);
    for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
      const output = path.join(directory, `${event}.out`);
      const r = spawnSync(process.execPath, [script, '--github-output', output], {
        cwd: directory, encoding: 'utf8',
        env: { ...process.env, GITHUB_EVENT_NAME: event, CI_BASE_SHA: base, CI_HEAD_SHA: head },
      });
      assert.equal(r.status, 0, r.stderr);
      const result = Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map(l => l.split('=')));
      assert.ok(domains.every(d => result[d] === (event === 'workflow_dispatch' ? 'true' : 'false')));
      assert.equal(result.deploy_ws, event === 'workflow_dispatch' ? 'true' : 'false');
    }
    const output = path.join(directory, 'missing.out');
    const r = spawnSync(process.execPath, [script, '--github-output', output], {
      cwd: directory, encoding: 'utf8',
      env: { ...process.env, GITHUB_EVENT_NAME: 'push', CI_BASE_SHA: 'missing', CI_HEAD_SHA: head },
    });
    assert.equal(r.status, 0, r.stderr);
    const text = fs.readFileSync(output, 'utf8');
    for (const d of domains) assert.ok(text.includes(`${d}=true\n`));
    assert.match(text, /deploy_ws=false/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
