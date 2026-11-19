import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callbackIntentFilter,
  configureManifest,
  resolveChannel,
  APPROVED_PRODUCTION_APP_ID,
  assertChannelIdentity
} from '../mobile/poker/configure-android.mjs';

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

const stageFilterLiteral = `<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="arcadepoker-stage" android:host="auth" android:path="/callback" />
</intent-filter>`;

const prodFilterLiteral = `<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="play.kcswh.pl" android:path="/app/auth/callback" />
</intent-filter>`;

test('callbackIntentFilter: stage matches exact literal, production matches expected App Link filter, unknown throws', () => {
  // 1. callbackIntentFilter('stage') equals the exact current literal
  assert.equal(callbackIntentFilter('stage'), stageFilterLiteral);

  // 2. callbackIntentFilter('production') equals the exact expected Production filter string
  const prodFilter = callbackIntentFilter('production');
  assert.equal(prodFilter, prodFilterLiteral);
  assert.equal(prodFilter.includes('android:autoVerify="true"'), true);
  assert.equal(prodFilter.includes('android:scheme="https"'), true);
  assert.equal(prodFilter.includes('android:host="play.kcswh.pl"'), true);
  assert.equal(prodFilter.includes('android:path="/app/auth/callback"'), true);
  assert.equal(prodFilter.includes('android.intent.action.VIEW'), true);
  assert.equal(prodFilter.includes('android.intent.category.DEFAULT'), true);
  assert.equal(prodFilter.includes('android.intent.category.BROWSABLE'), true);
  assert.equal(prodFilter.includes('arcadepoker-stage'), false);
  assert.equal(prodFilter.includes('pathPrefix'), false);
  assert.equal(prodFilter.includes('pathPattern'), false);

  // Unknown throws
  assert.throws(() => callbackIntentFilter('bogus'), /Unknown MOBILE_CHANNEL/);
});

test('configureManifest: stage byte-identical, production App Link, idempotent guard, activity missing guard', () => {
  const minimalTemplate = `<manifest><application><activity android:name=".MainActivity">\n    <intent-filter>MAIN/LAUNCHER</intent-filter>\n</activity></application></manifest>`;

  // 3. Stage output equals the template with the old replacement applied
  const expectedStage = minimalTemplate.replace('</activity>', `${stageFilterLiteral}\n</activity>`);
  const stageOutput = configureManifest(minimalTemplate, 'stage');
  assert.equal(stageOutput, expectedStage);

  // Production output contains the App Link filter and no Stage scheme
  const prodOutput = configureManifest(minimalTemplate, 'production');
  assert.equal(prodOutput.includes(prodFilterLiteral), true);
  assert.equal(prodOutput.includes('android:autoVerify="true"'), true);
  assert.equal(prodOutput.includes('arcadepoker-stage'), false);

  // Re-running on configured xml throws Callback already configured
  assert.throws(() => configureManifest(stageOutput, 'stage'), /Callback already configured/);
  assert.throws(() => configureManifest(stageOutput, 'production'), /Callback already configured/);
  assert.throws(() => configureManifest(prodOutput, 'stage'), /Callback already configured/);
  assert.throws(() => configureManifest(prodOutput, 'production'), /Callback already configured/);

  // Template without </activity> throws
  const templateNoActivity = '<manifest><application></application></manifest>';
  assert.throws(() => configureManifest(templateNoActivity, 'stage'), /Android template activity missing/);
  assert.throws(() => configureManifest(templateNoActivity, 'production'), /Android template activity missing/);
});

test('resolveChannel: undefined defaults to stage, empty/whitespace throws, valid channels preserved, unknown throws', () => {
  // 4. resolveChannel: undefined → stage; '' and '  ' → throw; 'bogus', 'Production', 'prod' → throw
  assert.equal(resolveChannel({}), 'stage');
  assert.equal(resolveChannel({ MOBILE_CHANNEL: undefined }), 'stage');
  assert.equal(resolveChannel({ MOBILE_CHANNEL: 'stage' }), 'stage');
  assert.equal(resolveChannel({ MOBILE_CHANNEL: 'production' }), 'production');

  assert.throws(() => resolveChannel({ MOBILE_CHANNEL: '' }), /Empty MOBILE_CHANNEL/);
  assert.throws(() => resolveChannel({ MOBILE_CHANNEL: '  ' }), /Empty MOBILE_CHANNEL/);
  assert.throws(() => resolveChannel({ MOBILE_CHANNEL: '\t\n' }), /Empty MOBILE_CHANNEL/);

  assert.throws(() => resolveChannel({ MOBILE_CHANNEL: 'bogus' }), /Unknown MOBILE_CHANNEL/);
  assert.throws(() => resolveChannel({ MOBILE_CHANNEL: 'Production' }), /Unknown MOBILE_CHANNEL/);
  assert.throws(() => resolveChannel({ MOBILE_CHANNEL: 'prod' }), /Unknown MOBILE_CHANNEL/);
});

test('assertChannelIdentity: stage with Stage id passes, mismatches throw, production fail-closed', () => {
  assert.equal(APPROVED_PRODUCTION_APP_ID, null);

  // 5. assertChannelIdentity: Stage with the Stage id passes
  assert.doesNotThrow(() => assertChannelIdentity('stage', 'pl.kcswh.arcadepoker.stage'));

  // Stage with another id throws Stage appId mismatch
  assert.throws(() => assertChannelIdentity('stage', 'pl.kcswh.arcadepoker.other'), /Stage appId mismatch/);
  assert.throws(() => assertChannelIdentity('stage', 'pl.kcswh.arcadepoker'), /Stage appId mismatch/);

  // Production throws Production applicationId not approved (with Stage id and with pl.kcswh.arcadepoker)
  assert.throws(() => assertChannelIdentity('production', 'pl.kcswh.arcadepoker.stage'), /Production applicationId not approved/);
  assert.throws(() => assertChannelIdentity('production', 'pl.kcswh.arcadepoker'), /Production applicationId not approved/);

  // Invalid ids throw Invalid appId in capacitor.config.json
  const invalidIds = ['', ' ', 'pl', '123.app.id', 'pl.kcswh.ArcadePoker', 'pl..kcswh', 'pl.kcswh/poker'];
  for (const invalidId of invalidIds) {
    assert.throws(() => assertChannelIdentity('stage', invalidId), /Invalid appId in capacitor\.config\.json/);
    assert.throws(() => assertChannelIdentity('production', invalidId), /Invalid appId in capacitor\.config\.json/);
  }
});

test('importing configure-android.mjs performs no file writes', async (t) => {
  // 6. Importing configure-android.mjs in the test performs no file writes
  const androidPath = path.join(rootDir, 'mobile/poker/android');
  if (existsSync(androidPath)) {
    t.skip('mobile/poker/android already exists; skipping to avoid deletion or interference');
    return;
  }
  assert.equal(existsSync(androidPath), false);
  await import(`../mobile/poker/configure-android.mjs?importCheck=${Date.now()}`);
  assert.equal(existsSync(androidPath), false);
});
