import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const retiredFiles = [
  'scripts/poker-join-smoke.mjs',
  'tools/_shared/poker-e2e-http.mjs',
  'tools/_shared/poker-e2e-cleanup.mjs'
];

const sourceByFile = Object.fromEntries(retiredFiles.map((file) => [file, fs.readFileSync(file, 'utf8')]));

const scriptsAndTools = [
  ...fs.readdirSync('scripts').map((name) => `scripts/${name}`),
  ...fs.readdirSync('tools').flatMap((name) => {
    const path = `tools/${name}`;
    if (!fs.statSync(path).isDirectory()) return [path];
    return fs.readdirSync(path).map((child) => `${path}/${child}`);
  })
].filter((file) => file.endsWith('.mjs') && !retiredFiles.includes(file));

test('legacy poker HTTP manual entrypoints are explicit retired stubs', () => {
  for (const file of retiredFiles) {
    const source = sourceByFile[file];
    assert.match(source, /retired/i, `${file} must explicitly announce retirement`);
    assert.match(source, /process\.exit\(1\)/, `${file} must fail fast as a retired entrypoint`);
    assert.doesNotMatch(source, /fetch\s*\(/, `${file} must not run HTTP gameplay calls`);
    assert.doesNotMatch(source, /\.netlify\/functions\/poker-/, `${file} must not target poker HTTP gameplay endpoints`);
  }
});

test('scripts/tools do not import retired poker HTTP helper modules', () => {
  for (const file of scriptsAndTools) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /poker-e2e-http\.mjs/, `${file} must not import retired poker-e2e-http helper`);
    assert.doesNotMatch(source, /poker-e2e-cleanup\.mjs/, `${file} must not import retired poker-e2e-cleanup helper`);
  }
});
