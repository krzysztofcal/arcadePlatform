import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const script = path.join(root, 'scripts', 'check-xpbadge.js');

// The pre-commit hook runs `check-xpbadge.js --files <staged html>`; it must follow guard.config.json badge.include.
test('check-xpbadge --files skips pages outside badge.include and still fails included pages without a badge', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'arcade-xpbadge-guard-'));
  // Never let an inherited hook environment (GIT_DIR, GIT_INDEX_FILE, ...) point git at the real repository.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: fixture, env, encoding: 'utf8' });
  try {
    copyFileSync(path.join(root, 'guard.config.json'), path.join(fixture, 'guard.config.json'));
    mkdirSync(path.join(fixture, 'mobile', 'poker'), { recursive: true });
    copyFileSync(path.join(root, 'mobile', 'poker', 'launch.html'), path.join(fixture, 'mobile', 'poker', 'launch.html'));
    writeFileSync(path.join(fixture, 'game-fixture.html'), '<!doctype html><title>Fixture</title>');
    assert.equal(run('git', ['init', '-q']).status, 0);
    assert.equal(run('git', ['add', '.']).status, 0);

    const skipped = run(process.execPath, [script, '--files', 'mobile/poker/launch.html']);
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.match(skipped.stdout, /Badge: OK \(0 pages\)/);

    const failed = run(process.execPath, [script, '--files', 'game-fixture.html']);
    assert.equal(failed.status, 1, 'an included page without an XP badge must fail');
    assert.match(failed.stderr, /game-fixture\.html — missing xp badge anchor/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
