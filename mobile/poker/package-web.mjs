import { readFile, writeFile, mkdir, cp, access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import security from './security.cjs';
import { assertLobbyPackaged, lobbyEntry } from './licensed-audio.mjs';
import { assertChannelIdentity, releaseVersion } from './configure-android.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(here, 'www');
// Refuse stale output instead of deleting any existing data.
try { await access(out); throw new Error('www already exists: use a fresh build workspace'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const capacitorConfig = JSON.parse(await readFile(path.join(here, 'capacitor.config.json'), 'utf8'));
const appId = capacitorConfig?.appId;
const channel = process.env.MOBILE_CHANNEL || 'stage';
if (channel !== 'stage' && channel !== 'production') throw new Error('Unknown MOBILE_CHANNEL');
assertChannelIdentity(channel, appId);
const version = releaseVersion(channel);
let config;
let key;
let binding = null;
if (channel === 'production') {
  if (process.env.MOBILE_PREVIEW_BINDING) {
    throw new Error('Production packaging cannot use a Preview binding');
  }
  const prodConfig = JSON.parse(await readFile(path.join(here, 'production-public.json'), 'utf8'));
  security.validateProduction(prodConfig);
  key = JSON.parse(Buffer.from(prodConfig.supabaseAnonKey.split('.')[1], 'base64url').toString());
  if (key.ref !== 'otbqfijerkieoxwpxjnm' || key.role !== 'anon') throw new Error('Only pinned public Production anon key permitted');
  config = prodConfig;
} else {
  const localConfig = JSON.parse(await readFile(path.join(here, 'stage-public.json'), 'utf8'));
  binding = process.env.MOBILE_PREVIEW_BINDING ? JSON.parse(await readFile(process.env.MOBILE_PREVIEW_BINDING, 'utf8')) : null;
  if ((process.env.CI || process.env.GITHUB_ACTIONS) && !binding) throw new Error('CI requires a verified own-PR Preview binding');
  config = binding ? security.forPreview(localConfig, binding, Number(process.env.PR_NUMBER), process.env.SOURCE_SHA) : security.validate(localConfig);
  key = JSON.parse(Buffer.from(config.supabaseAnonKey.split('.')[1], 'base64url').toString());
  if (key.ref !== 'krydukthwdvccggbyjfw' || key.role !== 'anon') throw new Error('Only pinned public Stage anon key permitted');
}
config.sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (process.env.SOURCE_SHA && config.sha !== process.env.SOURCE_SHA) throw new Error('Build SHA mismatch');
await mkdir(out, { recursive: true });
const copied = new Set();
async function put(name, value){
  const dest = path.join(out, name);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, value);
  copied.add(name);
}
async function copy(name){
  if (copied.has(name)) return;
  if (name.startsWith('../') || path.isAbsolute(name)) throw new Error('Asset outside repository');
  let value = await readFile(path.join(root, name));
  // Reuse table styles (including JS panel styles) with the native single-owner values.
  if (name === 'poker/poker-v2.css' || name === 'poker/poker-v2.js' || name === 'poker/offline/renderer.generated.js') value = Buffer.from(value.toString().replace(/env\(safe-area-inset-(top|right|bottom|left)(?:,\s*0px)?\)/g, 'var(--mobile-safe-$1,0px)'));
  await put(name, value);
  if (name.endsWith('.css')) {
    for (const match of value.toString().matchAll(/url\(["']?([^\s)"']+)/g)) {
      if (/^(data:|https?:|#)/.test(match[1])) continue;
      await copy(new URL(match[1], 'https://localhost/' + name).pathname.slice(1));
    }
  }
}
await put('mobile/config.js', 'window.MOBILE_POKER_CONFIG = ' + JSON.stringify(config) + ';\n');
await put('mobile/security.js', await readFile(path.join(here, 'security.cjs')));
await put('mobile/audio.js', await readFile(path.join(here, 'audio.js')));
await put('mobile/runtime.js', await readFile(path.join(here, 'runtime.js')));
await put('mobile/mobile.css', await readFile(path.join(here, 'mobile.css')));
await put('js/auth/supabase-config.js', 'window.SUPABASE_CONFIG = ' + JSON.stringify({ SUPABASE_URL: config.supabaseUrl, SUPABASE_ANON_KEY: config.supabaseAnonKey, AUTH_GOOGLE_ENABLED: true }) + ';\n');
await put('js/build-info.js', 'window.BUILD_INFO = ' + JSON.stringify({ commit: config.sha, pokerWsUrl: config.wsUrl, mobileVersion: version.name }) + '; window.__POKER_WS_URL = ' + JSON.stringify(config.wsUrl) + ';\n');
await put('js/vendor/supabase.js', await readFile(path.join(here, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js')));
const launch = await readFile(path.join(here, 'launch.html'), 'utf8');
const launchStyle = launch.match(/<style id="pokerLaunchStyle">[\s\S]*?<\/style>/)[0];
const launchBody = launch.match(/<div id="pokerLaunch"[\s\S]*?<\/div>\n<\/div>/)[0];
await put('mobile/poker/launch.js', await readFile(path.join(here, 'launch.js')));
// Keep current aliases and legacy policy documents; bundling a2 never activates it.
const legalPages = ['legal/privacy.en.html','legal/privacy.pl.html','legal/terms.en.html','legal/terms.pl.html'];
for (const version of ['2026-10-26-a1', '2026-10-28-a2']) {
  for (const lang of ['en', 'pl']) {
    for (const kind of ['terms', 'privacy']) legalPages.push(`legal/${kind}.${version}.${lang}.html`);
  }
}
// #1157: Privacy a3 is bundled as a versioned page only; aliases are now Privacy a3 / Terms a2 in the repo.
for (const lang of ['en', 'pl']) legalPages.push(`legal/privacy.2026-11-12-a3.${lang}.html`);
const pages = ['poker/index.html', 'poker/table-v2.html', 'poker/offline/play.html', 'account.html', ...legalPages];
await copy('css/profile-account.css');
await copy('js/profile-onboarding.js');
for(const variant of (await import('../../shared/profile-avatar-projection.mjs')).PUBLIC_AVATAR_VARIANTS)await copy('assets/avatars/arcade/'+variant+'.webp');
for (const name of pages) {
  let html = await readFile(path.join(root, name), 'utf8');
  if (name === 'poker/offline/play.html') {
    // Preserve isolated CSP/SRI: local audio adapter only; no auth, online bootstrap, config or network.
    await copy('poker/offline/avatar-catalog.generated.js');
    await copy('poker/offline/game.generated.js');
    await copy('poker/offline/renderer.generated.js');
    await copy('poker/offline/offline.css');
    // Apply the same native-inset substitutions as Online, then rehash the isolated renderer.
    const hash = value => 'sha256-' + createHash('sha256').update(value).digest('base64');
    const rendererPath = 'poker/offline/renderer.generated.js';
    const sourceHash = hash(await readFile(path.join(root, rendererPath)));
    const packagedHash = hash(await readFile(path.join(out, rendererPath)));
    html = html.replaceAll(sourceHash, packagedHash);
    const audioHash = hash(await readFile(path.join(out, 'mobile/audio.js')));
    if (!html.includes('script-src ')) throw new Error('Missing script-src anchor in poker/offline/play.html');
    html = html.replace('script-src ', `script-src '${audioHash}' `);
    const rendererTag = '<script src="/poker/offline/renderer.generated.js"';
    if (!html.includes(rendererTag)) throw new Error('Missing renderer script tag in poker/offline/play.html');
    html = html.replace(rendererTag, `<script src="/mobile/audio.js" integrity="${audioHash}" defer></script>` + rendererTag);
    html = html.replace('</head>', '<link rel="stylesheet" href="/mobile/mobile.css"></head>');
    await put(name, html);
    continue;
  }
  if (legalPages.includes(name)) {
    var main = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/)[0];
    html = '<!doctype html><html lang="'+(name.includes('.pl.html')?'pl':'en')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arcade Poker</title><link rel="stylesheet" href="/css/legal-document.css"></head><body>'+main+'</body></html>';
  }
  if (name === 'poker/index.html') {
    html = html.replace('<head>', '<head>' + launchStyle + launch.match(/<script src="\/mobile\/poker\/launch\.js"[^>]*><\/script>/)[0]);
    html = html.replace('<body class="poker-lobby">', '<body class="poker-lobby">' + launchBody);
    // sidebar.js owns the one shared APK navigation on Lobby and Account.
    html = html.replace(/<nav class="shortcuts"[\s\S]*?<\/nav>/, '');
  }
  // Only the table draws behind cutouts; other pages retain native viewport margins.
  if (name !== 'poker/table-v2.html') html = html.replace('viewport-fit=cover', 'viewport-fit=auto');
  // Presentation composition only; account forms and Poker DOM remain shared.
  html = html.split("\n").filter(line => !/^\s*<script\b[^>]*src=["'][^"']*(?:analytics|klaro-config|consent-services|consent-manager|vendor\/klaro\/klaro)\.js["'][^>]*><\/script>\s*$/.test(line)).join("\n");
  html = html.replace(/<link\b[^>]*href=["']https:\/\/fonts\.[^>]+>/g, '');
  html = html.replace(/<ul class="sb-list">[\s\S]*?<\/ul>/g, '<ul class="sb-list"></ul>');
  if (!legalPages.includes(name)) html = html.replace(/Arcade Hub/g, 'Arcade Poker');
  html = html.replace(/<a\b[^>]*id="manageCookies"[^>]*>[\s\S]*?<\/a>/g, '');
  html = html.replace(/(?:href|data-href-en|data-href-pl)="([^"]+)"/g, (match, value) => {
    if (/^(#|data:|mailto:|https?:)/.test(value)) return match;
    const url = new URL(value, 'https://localhost/' + name);
    let target = url.pathname;
    if (target === '/index.html' || target === '/poker/') target = '/poker/index.html';
    if (target === '/xp.html') target = '/account.html';
    if (!['/poker/', '/poker/index.html', '/poker/table-v2.html', '/poker/offline/play.html', '/account.html', ...legalPages.map(page=>'/'+page)].includes(target) && !target.endsWith('.css')) {
      if (/^\/(legal\/|about[./])/.test(target)) target = config.apiOrigin + target;
      else return match.replace(value, '/account.html');
    }
    return match.replace(value, target + url.search + url.hash);
  });
  html = html.replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js', '/js/vendor/supabase.js');
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^(https?:|data:|#|mailto:)/.test(match[1])) continue;
    const url = new URL(match[1], 'https://localhost/' + name);
    if (/\.(js|css|png|webp|svg|jpg|woff2?)$/.test(url.pathname)) await copy(url.pathname.slice(1));
  }
  const hashes = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => "'sha256-" + createHash('sha256').update(m[1]).digest('base64') + "'");
  const csp = `default-src 'self'; script-src 'self' ${hashes.join(' ')} ${name === 'poker/index.html' ? "'" + launch.match(/integrity="([^"]+)"/)[1] + "'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${config.supabaseUrl}; connect-src 'self' ${config.apiOrigin} ${config.supabaseUrl} ${config.wsUrl}; font-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'`;
  html = html.replace('<head>', '<head>\n<meta http-equiv="Content-Security-Policy" content="' + csp + '">\n<script src="/mobile/config.js"></script>\n<script src="/mobile/security.js"></script>\n<script src="/mobile/audio.js" defer></script>\n<script src="/mobile/runtime.js" defer></script>\n<link rel="stylesheet" href="/mobile/mobile.css">');
  await put(name, html);
}
await cp(path.join(root, 'poker/assets'), path.join(out, 'poker/assets'), { recursive: true });
await put('index.html', launch);
// #1146: local audio for the native Android owner; WWW never references these files.
const audioFiles = [];
for (const name of (await readdir(path.join(here, 'audio'))).filter(name => /^[a-z0-9_]+\.(wav|ogg|mp3|m4a)$/.test(name)).sort()) {
  const data = await readFile(path.join(here, 'audio', name));
  await put('mobile/audio/' + name, data);
  audioFiles.push({ name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
// The licensed lobby track is decrypted only in the APK workflow; official CI builds fail without it.
if (process.env.CI || process.env.GITHUB_ACTIONS) assertLobbyPackaged(audioFiles, await lobbyEntry());
// Validate the composed documents, including isolated Offline, before claiming CSP/SRI PASS.
for (const name of [...pages, 'index.html']) {
  const html = await readFile(path.join(out, name), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1];
  if (!csp || /script-src[^;]*'unsafe-inline'/.test(csp)) throw new Error('Invalid packaged script policy');
  for (const match of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (!csp.includes("'sha256-" + createHash('sha256').update(match[1]).digest('base64') + "'")) throw new Error('Packaged inline CSP mismatch');
  }
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const tag = match[0], src = tag.match(/\b(?:src|href)="([^"]+)"/i)?.[1], integrity = tag.match(/\bintegrity="([^"]+)"/i)?.[1];
    if (tag.toLowerCase().startsWith('<script') && /^(?:https?:)?\/\//.test(src || '')) throw new Error('External packaged script');
    if (integrity) {
      const bytes = await readFile(path.join(out, new URL(src, 'https://localhost/' + name).pathname.slice(1)));
      if (!integrity.split(/\s+/).some(token => { const parts = token.split('-'); return /^sha(256|384|512)$/.test(parts[0]) && createHash(parts[0]).update(bytes).digest('base64') === parts[1]; })) throw new Error('Packaged SRI mismatch');
    }
  }
}
const pkgVersion = JSON.parse(await readFile(path.join(here, 'package.json'), 'utf8')).version;
await put('build-receipt.json', JSON.stringify({ sha: config.sha, channel, prNumber: binding?.prNumber || null, preview: binding || null, appId: capacitorConfig.appId, version: pkgVersion, versionName: version.name, versionCode: version.code, apiOrigin: config.apiOrigin, supabaseUrl: config.supabaseUrl, supabaseProjectRef: key.ref, wsUrl: config.wsUrl, audio: { files: audioFiles }, securityChecks: { csp: 'PASS', sri: 'PASS', checkedPages: pages.length + 1 }, sourcePages: pages, updateModel: 'bundled assets; new APK required' }, null, 2));
process.stdout.write('Packaged shared Poker/account assets at SHA ' + config.sha + '\n');
