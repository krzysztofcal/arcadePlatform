import { readFile, writeFile, mkdir, cp, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import security from './security.cjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(here, 'www');
// Refuse stale output instead of deleting any existing data.
try { await access(out); throw new Error('www already exists: use a fresh build workspace'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const localConfig = JSON.parse(await readFile(path.join(here, 'stage-public.json'), 'utf8'));
const binding = process.env.MOBILE_PREVIEW_BINDING ? JSON.parse(await readFile(process.env.MOBILE_PREVIEW_BINDING, 'utf8')) : null;
if ((process.env.CI || process.env.GITHUB_ACTIONS) && !binding) throw new Error('CI requires a verified own-PR Preview binding');
const config = binding ? security.forPreview(localConfig, binding, Number(process.env.PR_NUMBER), process.env.SOURCE_SHA) : security.validate(localConfig);
const key = JSON.parse(Buffer.from(config.supabaseAnonKey.split('.')[1], 'base64url').toString());
if (key.ref !== 'krydukthwdvccggbyjfw' || key.role !== 'anon') throw new Error('Only pinned public Stage anon key permitted');
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
await put('mobile/runtime.js', await readFile(path.join(here, 'runtime.js')));
await put('mobile/mobile.css', await readFile(path.join(here, 'mobile.css')));
await put('js/auth/supabase-config.js', 'window.SUPABASE_CONFIG = ' + JSON.stringify({ SUPABASE_URL: config.supabaseUrl, SUPABASE_ANON_KEY: config.supabaseAnonKey, AUTH_GOOGLE_ENABLED: true }) + ';\n');
await put('js/build-info.js', 'window.BUILD_INFO = ' + JSON.stringify({ commit: config.sha, pokerWsUrl: config.wsUrl, mobileVersion: '0.0.1' }) + '; window.__POKER_WS_URL = ' + JSON.stringify(config.wsUrl) + ';\n');
await put('js/vendor/supabase.js', await readFile(path.join(here, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js')));
const launch = await readFile(path.join(here, 'launch.html'), 'utf8');
const launchStyle = launch.match(/<style id="pokerLaunchStyle">[\s\S]*?<\/style>/)[0];
const launchBody = launch.match(/<div id="pokerLaunch"[\s\S]*?<\/div>\n<\/div>/)[0];
await put('mobile/poker/launch.js', await readFile(path.join(here, 'launch.js')));
const pages = ['poker/index.html', 'poker/table-v2.html', 'poker/offline/play.html', 'account.html'];
for (const name of pages) {
  let html = await readFile(path.join(root, name), 'utf8');
  if (name === 'poker/offline/play.html') {
    // Preserve isolated CSP/SRI: no auth, online mobile bootstrap or remote config.
    await copy('poker/offline/game.generated.js');
    await copy('poker/offline/renderer.generated.js');
    await copy('poker/offline/offline.css');
    // Apply the same native-inset substitutions as Online, then rehash the isolated renderer.
    const hash = value => 'sha256-' + createHash('sha256').update(value).digest('base64');
    const rendererPath = 'poker/offline/renderer.generated.js';
    const sourceHash = hash(await readFile(path.join(root, rendererPath)));
    const packagedHash = hash(await readFile(path.join(out, rendererPath)));
    html = html.replaceAll(sourceHash, packagedHash);
    html = html.replace('</head>', '<link rel="stylesheet" href="/mobile/mobile.css"></head>');
    await put(name, html);
    continue;
  }
  if (name === 'poker/index.html') {
    html = html.replace('<head>', '<head>' + launchStyle + launch.match(/<script src="\/mobile\/poker\/launch\.js"[^>]*><\/script>/)[0]);
    html = html.replace('<body class="poker-lobby">', '<body class="poker-lobby">' + launchBody);
  }
  // Only the table draws behind cutouts; other pages retain native viewport margins.
  if (name !== 'poker/table-v2.html') html = html.replace('viewport-fit=cover', 'viewport-fit=auto');
  // Presentation composition only; account forms and Poker DOM remain shared.
  html = html.split("\n").filter(line => !/^\s*<script\b[^>]*src=["'][^"']*(?:analytics|klaro-config|consent-services|consent-manager|vendor\/klaro\/klaro)\.js["'][^>]*><\/script>\s*$/.test(line)).join("\n");
  html = html.replace(/<link\b[^>]*href=["']https:\/\/fonts\.[^>]+>/g, '');
  html = html.replace(/<ul class="sb-list">[\s\S]*?<\/ul>/g, '<ul class="sb-list"></ul>');
  html = html.replace(/Arcade Hub/g, 'Arcade Poker');
  html = html.replace(/<a\b[^>]*id="manageCookies"[^>]*>[\s\S]*?<\/a>/g, '');
  html = html.replace(/(?:href|data-href-en|data-href-pl)="([^"]+)"/g, (match, value) => {
    if (/^(#|data:|mailto:|https?:)/.test(value)) return match;
    const url = new URL(value, 'https://localhost/' + name);
    let target = url.pathname;
    if (target === '/index.html' || target === '/poker/') target = '/poker/index.html';
    if (target === '/xp.html') target = '/account.html';
    if (!['/poker/', '/poker/index.html', '/poker/table-v2.html', '/poker/offline/play.html', '/account.html'].includes(target) && !target.endsWith('.css')) {
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
  html = html.replace('<head>', '<head>\n<meta http-equiv="Content-Security-Policy" content="' + csp + '">\n<script src="/mobile/config.js"></script>\n<script src="/mobile/security.js"></script>\n<script src="/mobile/runtime.js" defer></script>\n<link rel="stylesheet" href="/mobile/mobile.css">');
  await put(name, html);
}
await cp(path.join(root, 'poker/assets'), path.join(out, 'poker/assets'), { recursive: true });
await put('index.html', launch);
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
const version = JSON.parse(await readFile(path.join(here, 'package.json'), 'utf8')).version;
await put('build-receipt.json', JSON.stringify({ sha: config.sha, prNumber: binding?.prNumber || null, preview: binding || null, appId: 'pl.kcswh.arcadepoker.stage', version, versionCode: 1, apiOrigin: config.apiOrigin, supabaseUrl: config.supabaseUrl, supabaseProjectRef: key.ref, wsUrl: config.wsUrl, securityChecks: { csp: 'PASS', sri: 'PASS', checkedPages: pages.length + 1 }, sourcePages: pages, updateModel: 'bundled assets; new APK required' }, null, 2));
process.stdout.write('Packaged shared Poker/account assets at SHA ' + config.sha + '\n');
