import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const security = require('../mobile/poker/security.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..');

const stageConfig = JSON.parse(readFileSync(new URL('../mobile/poker/stage-public.json', import.meta.url), 'utf8'));
const prodConfig = JSON.parse(readFileSync(new URL('../mobile/poker/production-public.json', import.meta.url), 'utf8'));

test('production config: validateProduction passes, validate throws (#1286 gate), channel === "production", anon JWT ref/role correct', () => {
  assert.equal(security.validateProduction(prodConfig), prodConfig);
  assert.throws(() => security.validate(prodConfig), /Invalid public Stage configuration/);
  assert.equal(security.channel(prodConfig), 'production');

  const anonPayload = JSON.parse(Buffer.from(prodConfig.supabaseAnonKey.split('.')[1], 'base64url').toString());
  assert.equal(anonPayload.ref, 'otbqfijerkieoxwpxjnm');
  assert.equal(anonPayload.role, 'anon');
});

test('stage config: validate passes, validateProduction throws, channel === "stage"', () => {
  assert.equal(security.validate(stageConfig).apiOrigin, stageConfig.apiOrigin);
  assert.throws(() => security.validateProduction(stageConfig), /Invalid public Production configuration/);
  assert.equal(security.channel(stageConfig), 'stage');
});

test('mixed tuples and invalid origin variants fail both validators and channel throws', () => {
  const fields = ['apiOrigin', 'supabaseUrl', 'wsUrl'];

  for (const field of fields) {
    // Stage config with one Production value
    const stageWithProd = { ...stageConfig, [field]: prodConfig[field] };
    assert.throws(() => security.validate(stageWithProd));
    assert.throws(() => security.validateProduction(stageWithProd));
    assert.throws(() => security.channel(stageWithProd));

    // Production config with one Stage value
    const prodWithStage = { ...prodConfig, [field]: stageConfig[field] };
    assert.throws(() => security.validate(prodWithStage));
    assert.throws(() => security.validateProduction(prodWithStage));
    assert.throws(() => security.channel(prodWithStage));
  }

  // Extra-path, credential, trailing-slash, and protocol variants of https://play.kcswh.pl
  const originVariants = [
    'https://play.kcswh.pl/',
    'https://play.kcswh.pl/path',
    'https://play.kcswh.pl/u/test',
    'https://user:pass@play.kcswh.pl',
    'https://user@play.kcswh.pl',
    'http://play.kcswh.pl',
    'https://play.kcswh.pl:443',
    'https://evil.kcswh.pl'
  ];

  for (const apiOrigin of originVariants) {
    const invalidProd = { ...prodConfig, apiOrigin };
    assert.throws(() => security.validateProduction(invalidProd));
    assert.throws(() => security.channel(invalidProd));
  }
});

test('forPreview still rejects a binding whose resulting config is Production', () => {
  const sha = 'a'.repeat(40);
  const binding = {
    prNumber: 1160,
    sourceSha: sha,
    apiOrigin: 'https://deploy-preview-1160--playkcswh.netlify.app',
    netlify: {
      deployId: '6ae3c8f8dfcc32f97a6aba47',
      sourceSha: sha,
      reviewId: 1160,
      context: 'deploy-preview',
      state: 'ready',
      siteId: 'f7e19a84-28f7-41f7-978a-f3b4552a404d',
      siteName: 'playkcswh',
      origin: 'https://deploy-preview-1160--playkcswh.netlify.app'
    }
  };

  // Binding with Production origin fails
  assert.throws(() => security.forPreview(stageConfig, { ...binding, apiOrigin: 'https://play.kcswh.pl' }, 1160, sha));

  // Passing Production config as base fails validation in forPreview
  assert.throws(() => security.forPreview(prodConfig, binding, 1160, sha));
});

test('packager fail-closed for production and bogus channel without creating www', (t) => {
  const wwwPath = path.join(rootDir, 'mobile/poker/www');
  if (existsSync(wwwPath)) {
    t.skip('mobile/poker/www already exists; skipping to avoid deletion or interference');
    return;
  }

  const cleanEnv = { ...process.env };
  delete cleanEnv.CI;
  delete cleanEnv.GITHUB_ACTIONS;

  // 1. MOBILE_CHANNEL=production
  const prodRun = spawnSync(process.execPath, ['mobile/poker/package-web.mjs'], {
    cwd: rootDir,
    env: { ...cleanEnv, MOBILE_CHANNEL: 'production' },
    encoding: 'utf8'
  });
  assert.notEqual(prodRun.status, 0);
  assert.match(prodRun.stderr, /Production packaging is disabled until the T2\/T3 release gates/);
  assert.equal(existsSync(wwwPath), false);

  // 2. MOBILE_CHANNEL=bogus
  const bogusRun = spawnSync(process.execPath, ['mobile/poker/package-web.mjs'], {
    cwd: rootDir,
    env: { ...cleanEnv, MOBILE_CHANNEL: 'bogus' },
    encoding: 'utf8'
  });
  assert.notEqual(bogusRun.status, 0);
  assert.match(bogusRun.stderr, /Unknown MOBILE_CHANNEL/);
  assert.equal(existsSync(wwwPath), false);
});

test('stage regression: capacitor appId, redirectTo, and configure-android path derivation', () => {
  const capConfig = JSON.parse(readFileSync(new URL('../mobile/poker/capacitor.config.json', import.meta.url), 'utf8'));
  assert.equal(capConfig.appId, 'pl.kcswh.arcadepoker.stage');
  assert.equal(security.redirectTo, 'arcadepoker-stage://auth/callback');

  const configureSrc = readFileSync(new URL('../mobile/poker/configure-android.mjs', import.meta.url), 'utf8');
  assert.equal(configureSrc.includes('pl/kcswh/arcadepoker/stage'), false);

  const derivedPath = capConfig.appId.split('.').join('/');
  assert.equal(derivedPath, 'pl/kcswh/arcadepoker/stage');
});
