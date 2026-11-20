import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdtempSync, copyFileSync, mkdirSync, writeFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  callbackIntentFilter,
  configureManifest,
  resolveChannel,
  APPROVED_PRODUCTION_APP_ID,
  assertChannelIdentity,
  releaseVersion
} from '../mobile/poker/configure-android.mjs';

const require = createRequire(import.meta.url);
const security = require('../mobile/poker/security.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..');

const stageConfig = JSON.parse(readFileSync(new URL('../mobile/poker/stage-public.json', import.meta.url), 'utf8'));
const prodConfig = JSON.parse(readFileSync(new URL('../mobile/poker/production-public.json', import.meta.url), 'utf8'));

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

test('production config: validateProduction passes, validate throws (#1286 gate), channel === "production", anon JWT ref/role correct', () => {
  assert.equal(security.validateProduction(prodConfig), prodConfig);
  assert.throws(() => security.validate(prodConfig), /Invalid public Stage configuration/);
  assert.equal(security.channel(prodConfig), 'production');

  const anonPayload = JSON.parse(Buffer.from(prodConfig.supabaseAnonKey.split('.')[1], 'base64url').toString());
  assert.equal(anonPayload.ref, 'otbqfijerkieoxwpxjnm');
  assert.equal(anonPayload.role, 'anon');
});

test('bind: stage and production bind channel, config, and channel redirect', () => {
  const boundStage = security.bind(stageConfig);
  assert.equal(boundStage.channel, 'stage');
  assert.equal(boundStage.config, stageConfig);
  assert.equal(boundStage.redirectTo, 'arcadepoker-stage://auth/callback');

  const boundProd = security.bind(prodConfig);
  assert.equal(boundProd.channel, 'production');
  assert.equal(boundProd.config, prodConfig);
  assert.equal(boundProd.redirectTo, 'https://play.kcswh.pl/app/auth/callback');
});

test('redirectFor returns exact channel redirect string and throws on unknown channel', () => {
  assert.equal(security.redirectFor('stage'), 'arcadepoker-stage://auth/callback');
  assert.equal(security.redirectFor('production'), 'https://play.kcswh.pl/app/auth/callback');
  assert.throws(() => security.redirectFor('unknown'), /Unknown channel/);
  assert.throws(() => security.redirectFor(''), /Unknown channel/);
});

test('bind rejects mixed tuples, swapped anon keys, and crafted service_role JWT', () => {
  // Mixed tuples
  assert.throws(() => security.bind({ ...stageConfig, apiOrigin: prodConfig.apiOrigin }));
  assert.throws(() => security.bind({ ...prodConfig, apiOrigin: stageConfig.apiOrigin }));
  assert.throws(() => security.bind({ ...stageConfig, wsUrl: prodConfig.wsUrl }));
  assert.throws(() => security.bind({ ...prodConfig, supabaseUrl: stageConfig.supabaseUrl }));

  // Swapped anon keys
  assert.throws(() => security.bind({ ...prodConfig, supabaseAnonKey: stageConfig.supabaseAnonKey }), /Invalid public anon key/);
  assert.throws(() => security.bind({ ...stageConfig, supabaseAnonKey: prodConfig.supabaseAnonKey }), /Invalid public anon key/);

  // Crafted service_role JWT
  const serviceRoleJwt = makeJwt({ iss: 'supabase', ref: 'otbqfijerkieoxwpxjnm', role: 'service_role' });
  assert.throws(() => security.bind({ ...prodConfig, supabaseAnonKey: serviceRoleJwt }), /Invalid public anon key/);

  // Corrupted / malformed anon keys
  assert.throws(() => security.bind({ ...prodConfig, supabaseAnonKey: 'not-a-jwt' }), /Invalid public anon key/);
  assert.throws(() => security.bind({ ...prodConfig, supabaseAnonKey: 'a.b' }), /Invalid public anon key/);
  assert.throws(() => security.bind({ ...prodConfig, supabaseAnonKey: 'a.invalid-base64!.c' }), /Invalid public anon key/);
  assert.throws(() => security.bind({ ...prodConfig, supabaseAnonKey: 'a.' + Buffer.from('not json').toString('base64url') + '.c' }), /Invalid public anon key/);
  assert.throws(() => security.bind({ ...prodConfig, supabaseAnonKey: null }), /Invalid public anon key/);
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

test('packager fail-closed for production with stage config, preview binding, and bogus channel without creating www', (t) => {
  const wwwPath = path.join(rootDir, 'mobile/poker/www');
  if (existsSync(wwwPath)) {
    t.skip('mobile/poker/www already exists; skipping to avoid deletion or interference');
    return;
  }

  const cleanEnv = { ...process.env };
  delete cleanEnv.CI;
  delete cleanEnv.GITHUB_ACTIONS;

  // 1. MOBILE_CHANNEL=production with Stage capacitor config in rootDir fails before www
  const prodRun = spawnSync(process.execPath, ['mobile/poker/package-web.mjs'], {
    cwd: rootDir,
    env: { ...cleanEnv, MOBILE_CHANNEL: 'production' },
    encoding: 'utf8'
  });
  assert.notEqual(prodRun.status, 0);
  assert.match(prodRun.stderr, /Production appId mismatch/);
  assert.equal(existsSync(wwwPath), false);

  // 2. MOBILE_CHANNEL=bogus fails before www
  const bogusRun = spawnSync(process.execPath, ['mobile/poker/package-web.mjs'], {
    cwd: rootDir,
    env: { ...cleanEnv, MOBILE_CHANNEL: 'bogus' },
    encoding: 'utf8'
  });
  assert.notEqual(bogusRun.status, 0);
  assert.match(bogusRun.stderr, /Unknown MOBILE_CHANNEL/);
  assert.equal(existsSync(wwwPath), false);

  // 2b. An empty MOBILE_CHANNEL never silently selects Stage
  const emptyRun = spawnSync(process.execPath, ['mobile/poker/package-web.mjs'], {
    cwd: rootDir,
    env: { ...cleanEnv, MOBILE_CHANNEL: '' },
    encoding: 'utf8'
  });
  assert.notEqual(emptyRun.status, 0);
  assert.match(emptyRun.stderr, /Empty MOBILE_CHANNEL/);
  assert.equal(existsSync(wwwPath), false);

  // 3. Production with Preview binding env fails in a temp copy before creating www
  const tempPoker = mkdtempSync(path.join(os.tmpdir(), 'poker-packager-'));
  try {
    for (const name of ['package-web.mjs', 'configure-android.mjs', 'security.cjs', 'production-public.json', 'stage-public.json', 'package.json', 'licensed-audio.mjs']) {
      copyFileSync(path.join(rootDir, 'mobile/poker', name), path.join(tempPoker, name));
    }
    copyFileSync(path.join(rootDir, 'mobile/poker/capacitor.production.json'), path.join(tempPoker, 'capacitor.config.json'));
    const bindingRun = spawnSync(process.execPath, ['package-web.mjs'], {
      cwd: tempPoker,
      env: {
        ...cleanEnv,
        MOBILE_CHANNEL: 'production',
        MOBILE_PREVIEW_BINDING: '/tmp/fake-binding.json',
        MOBILE_VERSION_NAME: '1.0.0',
        MOBILE_VERSION_CODE: '1'
      },
      encoding: 'utf8'
    });
    assert.notEqual(bindingRun.status, 0);
    assert.match(bindingRun.stderr, /Production packaging cannot use a Preview binding/);
    assert.equal(existsSync(path.join(tempPoker, 'www')), false);
  } finally {
    rmSync(tempPoker, { recursive: true, force: true });
  }
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

test('assertChannelIdentity: stage with Stage id passes, mismatches throw, production approved id passes', () => {
  assert.equal(APPROVED_PRODUCTION_APP_ID, 'pl.kcswh.arcadepoker');

  // Stage with the Stage id passes
  assert.doesNotThrow(() => assertChannelIdentity('stage', 'pl.kcswh.arcadepoker.stage'));

  // Stage with another id throws Stage appId mismatch
  assert.throws(() => assertChannelIdentity('stage', 'pl.kcswh.arcadepoker.other'), /Stage appId mismatch/);
  assert.throws(() => assertChannelIdentity('stage', 'pl.kcswh.arcadepoker'), /Stage appId mismatch/);

  // Production with approved id passes
  assert.doesNotThrow(() => assertChannelIdentity('production', 'pl.kcswh.arcadepoker'));

  // Production with Stage id or other id throws Production appId mismatch
  assert.throws(() => assertChannelIdentity('production', 'pl.kcswh.arcadepoker.stage'), /Production appId mismatch/);
  assert.throws(() => assertChannelIdentity('production', 'pl.kcswh.arcadepoker.other'), /Production appId mismatch/);

  // Invalid ids throw Invalid appId in capacitor.config.json
  const invalidIds = ['', ' ', 'pl', '123.app.id', 'pl.kcswh.ArcadePoker', 'pl..kcswh', 'pl.kcswh/poker'];
  for (const invalidId of invalidIds) {
    assert.throws(() => assertChannelIdentity('stage', invalidId), /Invalid appId in capacitor\.config\.json/);
    assert.throws(() => assertChannelIdentity('production', invalidId), /Invalid appId in capacitor\.config\.json/);
  }

  // Unknown channel throws
  assert.throws(() => assertChannelIdentity('bogus', 'pl.kcswh.arcadepoker'), /Unknown MOBILE_CHANNEL/);
});

test('releaseVersion: stage fixed, production valid, invalid or missing inputs throw', () => {
  // Stage is fixed and ignores env
  assert.deepEqual(releaseVersion('stage'), { name: '0.0.1', code: 1 });
  assert.deepEqual(releaseVersion('stage', {}), { name: '0.0.1', code: 1 });
  assert.deepEqual(releaseVersion('stage', { MOBILE_VERSION_NAME: 'bad', MOBILE_VERSION_CODE: 'bad' }), { name: '0.0.1', code: 1 });

  // Production valid
  assert.deepEqual(releaseVersion('production', { MOBILE_VERSION_NAME: '1.0.0', MOBILE_VERSION_CODE: '1' }), { name: '1.0.0', code: 1 });
  assert.deepEqual(releaseVersion('production', { MOBILE_VERSION_NAME: '10.20.300', MOBILE_VERSION_CODE: '2100000000' }), { name: '10.20.300', code: 2100000000 });

  // Missing or invalid MOBILE_VERSION_NAME
  assert.throws(() => releaseVersion('production', { MOBILE_VERSION_CODE: '1' }), /Invalid MOBILE_VERSION_NAME/);
  for (const badName of ['', '   ', '1.0', 'v1.0.0', '1.0.0.0', '1.0.0-beta', 'abc', null, 123]) {
    assert.throws(() => releaseVersion('production', { MOBILE_VERSION_NAME: badName, MOBILE_VERSION_CODE: '1' }), /Invalid MOBILE_VERSION_NAME/);
  }

  // Missing or invalid MOBILE_VERSION_CODE
  assert.throws(() => releaseVersion('production', { MOBILE_VERSION_NAME: '1.0.0' }), /Invalid MOBILE_VERSION_CODE/);
  for (const badCode of ['', '   ', '0', '01', '-1', '1.5', 'abc', '2100000001', '9999999999', null]) {
    assert.throws(() => releaseVersion('production', { MOBILE_VERSION_NAME: '1.0.0', MOBILE_VERSION_CODE: badCode }), /Invalid MOBILE_VERSION_CODE/);
  }

  // Unknown channel
  assert.throws(() => releaseVersion('bogus', {}), /Unknown MOBILE_CHANNEL/);
});

test('capacitor.production.json equals capacitor.config.json except appId and appName', () => {
  const stageCap = JSON.parse(readFileSync(new URL('../mobile/poker/capacitor.config.json', import.meta.url), 'utf8'));
  const prodCap = JSON.parse(readFileSync(new URL('../mobile/poker/capacitor.production.json', import.meta.url), 'utf8'));
  assert.equal(prodCap.appId, 'pl.kcswh.arcadepoker');
  assert.equal(prodCap.appName, 'Arcade Poker');
  assert.equal(stageCap.appId, 'pl.kcswh.arcadepoker.stage');
  assert.equal(stageCap.appName, 'Arcade Poker Stage');

  const { appId: _sId, appName: _sName, ...stageRest } = stageCap;
  const { appId: _pId, appName: _pName, ...prodRest } = prodCap;
  assert.deepEqual(prodRest, stageRest);
});

// Minimal writable copy of the generated Android tree; never touches mobile/poker itself.
function androidFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'configure-android-'));
  for (const name of ['configure-android.mjs', 'capacitor.config.json', 'PokerAudioPlugin.java', 'launch-mark.xml']) {
    copyFileSync(path.join(rootDir, 'mobile/poker', name), path.join(dir, name));
  }
  const files = {
    'android/app/src/main/AndroidManifest.xml': '<manifest><application><activity android:name=".MainActivity"><intent-filter><action android:name="android.intent.action.MAIN" /></intent-filter></activity></application></manifest>\n',
    'android/app/build.gradle': 'defaultConfig {\n  versionCode 1\n  versionName "1.0"\n}\n',
    'android/app/src/main/java/pl/kcswh/arcadepoker/stage/MainActivity.java': 'package pl.kcswh.arcadepoker.stage;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n',
    'android/app/src/main/res/values/styles.xml': '<style><item name="android:background">@null</item><item name="android:background">@drawable/splash</item></style>\n',
  };
  for (const [name, value] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), value);
  }
  mkdirSync(path.join(dir, 'android/app/src/main/res/drawable'), { recursive: true });
  return dir;
}
function treeSnapshot(dir) {
  const out = {};
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = readFileSync(full).toString('base64');
    }
  };
  walk(dir);
  return out;
}
function runConfigure(dir, channel) {
  const env = { ...process.env };
  delete env.MOBILE_CHANNEL;
  if (channel !== undefined) env.MOBILE_CHANNEL = channel;
  return spawnSync(process.execPath, ['configure-android.mjs'], { cwd: dir, env, encoding: 'utf8' });
}

function androidProductionFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'configure-android-prod-'));
  for (const name of ['configure-android.mjs', 'PokerAudioPlugin.java', 'launch-mark.xml']) {
    copyFileSync(path.join(rootDir, 'mobile/poker', name), path.join(dir, name));
  }
  copyFileSync(path.join(rootDir, 'mobile/poker/capacitor.production.json'), path.join(dir, 'capacitor.config.json'));
  const files = {
    'android/app/src/main/AndroidManifest.xml': '<manifest><application><activity android:name=".MainActivity"><intent-filter><action android:name="android.intent.action.MAIN" /></intent-filter></activity></application></manifest>\n',
    'android/app/build.gradle': 'defaultConfig {\n  versionCode 1\n  versionName "1.0"\n}\n',
    'android/app/src/main/java/pl/kcswh/arcadepoker/MainActivity.java': 'package pl.kcswh.arcadepoker;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n',
    'android/app/src/main/res/values/styles.xml': '<style><item name="android:background">@null</item><item name="android:background">@drawable/splash</item></style>\n',
  };
  for (const [name, value] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), value);
  }
  mkdirSync(path.join(dir, 'android/app/src/main/res/drawable'), { recursive: true });
  return dir;
}

test('configure script: Production with Stage config and empty/unknown channels fail before any file write', () => {
  const dir = androidFixture();
  try {
    const before = treeSnapshot(dir);
    for (const [channel, message] of [['production', /Production appId mismatch/], ['', /Empty MOBILE_CHANNEL/], ['bogus', /Unknown MOBILE_CHANNEL/]]) {
      const run = runConfigure(dir, channel);
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, message);
      assert.deepEqual(treeSnapshot(dir), before);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('configure script: Production in temporary tree with production config and version env writes expected files, missing version fails before write', () => {
  // 1. Missing version env fails before any write
  const dirMissing = androidProductionFixture();
  try {
    const before = treeSnapshot(dirMissing);
    const env = { ...process.env, MOBILE_CHANNEL: 'production' };
    delete env.MOBILE_VERSION_NAME;
    delete env.MOBILE_VERSION_CODE;
    const run = spawnSync(process.execPath, ['configure-android.mjs'], { cwd: dirMissing, env, encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Invalid MOBILE_VERSION_NAME/);
    assert.deepEqual(treeSnapshot(dirMissing), before);
  } finally {
    rmSync(dirMissing, { recursive: true, force: true });
  }

  // 2. Valid production run writes App Link filter, versionName, versionCode, PokerAudioPlugin with production package
  const dir = androidProductionFixture();
  try {
    const env = {
      ...process.env,
      MOBILE_CHANNEL: 'production',
      MOBILE_VERSION_NAME: '1.2.3',
      MOBILE_VERSION_CODE: '42'
    };
    const run = spawnSync(process.execPath, ['configure-android.mjs'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);

    const manifest = readFileSync(path.join(dir, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
    assert.ok(manifest.includes(callbackIntentFilter('production') + '\n</activity>'));
    assert.ok(manifest.includes('android:autoVerify="true"'));
    assert.ok(manifest.includes('play.kcswh.pl'));
    assert.ok(!manifest.includes('arcadepoker-stage'));

    const gradle = readFileSync(path.join(dir, 'android/app/build.gradle'), 'utf8');
    assert.ok(gradle.includes('versionName "1.2.3"'));
    assert.ok(gradle.includes('versionCode 42'));

    const pluginPath = path.join(dir, 'android/app/src/main/java/pl/kcswh/arcadepoker/PokerAudioPlugin.java');
    assert.ok(existsSync(pluginPath));
    const pluginSrc = readFileSync(pluginPath, 'utf8');
    assert.equal(pluginSrc.split(/\r?\n/, 1)[0], 'package pl.kcswh.arcadepoker;');

    const activityPath = path.join(dir, 'android/app/src/main/java/pl/kcswh/arcadepoker/MainActivity.java');
    assert.ok(existsSync(activityPath));
    const activitySrc = readFileSync(activityPath, 'utf8');
    assert.ok(activitySrc.includes('registerPlugin(PokerAudioPlugin.class);'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('configure script: unset channel configures Stage, also through a symlinked entry point', () => {
  for (const viaLink of [false, true]) {
    const dir = androidFixture();
    try {
      if (viaLink) symlinkSync(path.join(dir, 'configure-android.mjs'), path.join(dir, 'configure-link.mjs'));
      const env = { ...process.env };
      delete env.MOBILE_CHANNEL;
      const run = spawnSync(process.execPath, [viaLink ? 'configure-link.mjs' : 'configure-android.mjs'], { cwd: dir, env, encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      const manifest = readFileSync(path.join(dir, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
      assert.ok(manifest.includes(callbackIntentFilter('stage') + '\n</activity>'));
      assert.ok(!manifest.includes('play.kcswh.pl'));
      const gradle = readFileSync(path.join(dir, 'android/app/build.gradle'), 'utf8');
      assert.ok(gradle.includes('versionName "0.0.1"'));
      assert.ok(gradle.includes('versionCode 1'));
      const pluginSrc = readFileSync(path.join(dir, 'android/app/src/main/java/pl/kcswh/arcadepoker/stage/PokerAudioPlugin.java'), 'utf8');
      assert.equal(pluginSrc.split(/\r?\n/, 1)[0], 'package pl.kcswh.arcadepoker.stage;');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('importing configure-android.mjs performs no file writes', async () => {
  const dir = androidFixture();
  try {
    const before = treeSnapshot(dir);
    await import(pathToFileURL(path.join(dir, 'configure-android.mjs')).href);
    assert.deepEqual(treeSnapshot(dir), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
