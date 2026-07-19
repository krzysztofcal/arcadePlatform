import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const portalIndexHtml = await readFile(path.join(root, 'index.html'), 'utf8');
const indexHtml = await readFile(path.join(root, 'poker', 'index.html'), 'utf8');
const tableV2Html = await readFile(path.join(root, 'poker', 'table-v2.html'), 'utf8');
const tableV2Css = await readFile(path.join(root, 'poker', 'poker-v2.css'), 'utf8');
const consentManagerJs = await readFile(path.join(root, 'js', 'consent-manager.js'), 'utf8');
const debugJs = await readFile(path.join(root, 'js', 'debug.js'), 'utf8');
const consentServicesJs = await readFile(path.join(root, 'js', 'consent-services.js'), 'utf8');
const klaroConfigJs = await readFile(path.join(root, 'js', 'klaro-config.js'), 'utf8');
const adsenseInitJs = await readFile(path.join(root, 'js', 'adsense-init.js'), 'utf8');
const landingConsentManagerJs = await readFile(path.join(root, 'landing', 'js', 'consent-manager.js'), 'utf8');
const landingConsentServicesJs = await readFile(path.join(root, 'landing', 'js', 'consent-services.js'), 'utf8');
const landingKlaroConfigJs = await readFile(path.join(root, 'landing', 'js', 'klaro-config.js'), 'utf8');
const landingAdsenseInitJs = await readFile(path.join(root, 'landing', 'js', 'adsense-init.js'), 'utf8');
const landingIndexHtml = await readFile(path.join(root, 'landing', 'index.html'), 'utf8');
const landingAboutHtml = await readFile(path.join(root, 'landing', 'about.html'), 'utf8');
const landingPrivacyEnHtml = await readFile(path.join(root, 'landing', 'legal', 'privacy.en.html'), 'utf8');
const landingPrivacyPlHtml = await readFile(path.join(root, 'landing', 'legal', 'privacy.pl.html'), 'utf8');
const landingGameJs = await readFile(path.join(root, 'landing', 'js', 'landing-game.js'), 'utf8');
const freedoomHtml = await readFile(path.join(root, 'games-open', 'freedoom', 'index.html'), 'utf8');
const freedoomJs = await readFile(path.join(root, 'games-open', 'freedoom', 'script.js'), 'utf8');
const freedoomCss = await readFile(path.join(root, 'games-open', 'freedoom', 'style.css'), 'utf8');
const headersFile = await readFile(path.join(root, '_headers'), 'utf8');
const playHtml = await readFile(path.join(root, 'play.html'), 'utf8');
const netlifyToml = await readFile(path.join(root, 'netlify.toml'), 'utf8');
const gamesCatalog = JSON.parse(await readFile(path.join(root, 'js', 'games.json'), 'utf8'));
assert.match(indexHtml, /src="\/js\/build-info\.js" defer/, 'poker index should include build-info bootstrap script');
assert.equal(indexHtml.indexOf('/js/build-info.js') < indexHtml.indexOf('/poker/poker-ws-client.js'), true, 'poker index should load build-info before ws client');
assert.doesNotMatch(indexHtml, /pokerClassicEntry/, 'poker lobby should no longer expose the classic table entry');
assert.match(tableV2Html, /id="pokerV2JoinBtn"/, 'poker table v2 should include live join control');
assert.match(tableV2Html, /id="pokerLobbyLink"/, 'poker table v2 should include a back-to-lobby link in the hamburger menu');
assert.match(tableV2Html, /id="pokerV2ClosedTableModal"/, 'poker table v2 should render the closed-table redirect notice');
assert.match(tableV2Html, /id="pokerV2GuestPanel"/, 'poker table v2 should render the guest restrictions panel');
assert.match(indexHtml, /Create account or sign in/, 'poker lobby signed-out CTA should not promise the welcome bonus before eligibility is known');
assert.match(indexHtml, /id="pokerWelcomeBonusBanner"/, 'poker lobby should render an eligible-user welcome bonus banner');
assert.match(indexHtml, /Claim bonus/, 'poker lobby welcome bonus banner should include a claim CTA');
assert.match(tableV2Html, /Create account and get 500 CH Welcome Bonus/, 'poker table guest CTA should advertise the welcome bonus');
assert.match(tableV2Html, /\+500 CH welcome bonus/, 'guest panel should list the welcome bonus as an account unlock');
assert.doesNotMatch(indexHtml + tableV2Html, /Sign in and get 500 CH/i, 'guest bonus copy should not promise a sign-in reward');
assert.doesNotMatch(tableV2Html, /pokerClassicLink/, 'poker table v2 should not expose the classic table link');
assert.doesNotMatch(tableV2Html, /pokerV2Link/, 'poker table v2 should not expose a self-link in the hamburger menu');
assert.doesNotMatch(tableV2Html, /pokerV2DemoPill/, 'poker table v2 should not render the legacy demo pill');
assert.match(tableV2Html, /src="\/poker\/poker-ws-client\.js" defer/, 'poker table v2 should bootstrap WS client for live runtime');
assert.equal(tableV2Html.indexOf('id="pokerSeatLayer"') < tableV2Html.indexOf('id="pokerDealerChip"'), true, 'dealer chip should be positioned in the full scene after the seat layer');
assert.equal(tableV2Html.indexOf('id="pokerDealerChip"') < tableV2Html.indexOf('class="poker-center-layer"'), true, 'dealer chip should not live inside the center layer');
assert.match(tableV2Css, /\.poker-menu-panel\[hidden\]\{display:none;\}/, 'poker table v2 menu should hard-hide when hidden attribute is present');
assert.match(tableV2Css, /\.poker-closed-table-modal\{z-index:65;\}/, 'poker table v2 should style the closed-table redirect notice');
assert.match(tableV2Css, /\.poker-guest-panel\{margin-top:12px; padding:14px 14px 12px; border-radius:18px; border:1px solid rgba\(255,223,180,0\.2\); background:rgba\(8,13,22,0\.72\);\}/, 'poker table v2 should style the guest restrictions panel');
assert.match(tableV2Css, /\.poker-guest-panel__item--blocked::before\{content:"✕"; color:#ffb5b5;\}/, 'guest restrictions panel should visibly mark blocked items');
assert.match(tableV2Css, /\.poker-action-bar\{position:fixed; right:max\(10px, env\(safe-area-inset-right\)\); bottom:max\(10px, env\(safe-area-inset-bottom\)\); width:min\(33vw, 196px\); display:grid; grid-template-columns:40px minmax\(0, 1fr\);/, 'poker table v2 action rail should dock to the bottom-right with a left-side vertical amount slider');
assert.doesNotMatch(tableV2Css, /\.poker-seat--hero \.poker-seat-avatar\{[^}]*border-color:/, 'hero avatar should not keep an always-on active ring');
assert.match(tableV2Css, /\.poker-seat--hero\.poker-seat--active \.poker-seat-avatar\{border-color:rgba\(84,245,152,0\.88\);/, 'hero avatar should turn green only on the active turn');
assert.match(tableV2Html, /id="pokerBootSplash"/, 'poker table v2 should render a boot splash to avoid raw HTML flash');
assert.match(tableV2Html, /id="pokerV2AmountValue"/, 'poker table v2 should render a compact amount value for the action slider');
assert.match(consentManagerJs, /#manageCookies, \.manage-cookies, \[data-manage-cookies\]/, 'consent manager should delegate clicks from all manage cookies links');
assert.match(consentManagerJs, /window\.klaro\.show\(window\.klaroConfig, true\)/, 'manage cookies should open the Klaro preference modal');
assert.match(consentServicesJs, /arcadeConsentChanged/, 'consent services should emit consent updates for AdSense slot initialization');
assert.match(klaroConfigJs, /cookieDomain: sharedDomain/, 'Klaro should share consent across matching kcswh.pl subdomains');
assert.match(indexHtml, /js\/vendor\/klaro\/klaro\.js/, 'portal pages should load Klaro');
assert.doesNotMatch(indexHtml, /Cookiebot|data-cookieconsent/, 'portal index should no longer load Cookiebot-managed scripts');
assert.equal(landingConsentManagerJs, consentManagerJs, 'landing deploy should publish the shared consent manager at /js/consent-manager.js');
assert.equal(landingConsentServicesJs, consentServicesJs, 'landing deploy should publish the shared consent services helper at /js/consent-services.js');
assert.equal(landingKlaroConfigJs, klaroConfigJs, 'landing deploy should publish the shared Klaro config at /js/klaro-config.js');
assert.equal(landingAdsenseInitJs, adsenseInitJs, 'landing deploy should publish the AdSense init helper at /js/adsense-init.js');
assert.match(landingIndexHtml, /data-landing-game/, 'landing page should render the mini game surface');
assert.match(landingIndexHtml, /\.\/js\/landing-game\.js/, 'landing page should load the mini game controller');
assert.match(landingGameJs, /landingPixelBest/, 'landing mini game should persist the best score locally');
assert.equal([landingIndexHtml, landingAboutHtml, landingPrivacyEnHtml, landingPrivacyPlHtml].every((html) => html.includes('href="https://play.kcswh.pl/xp.html"')), true, 'landing XP badges should link to the play subdomain XP panel');
assert.equal([landingIndexHtml, landingAboutHtml, landingPrivacyEnHtml, landingPrivacyPlHtml].some((html) => /href="\.\.?\/.*xp\.html"|xp-badge--loading/.test(html)), false, 'landing XP badges should not point to missing local XP pages or show a permanent loading state');
assert.match(freedoomHtml, /id="doomCanvas"/, 'Freedoom should render the Dwasm canvas target');
assert.match(freedoomHtml, /window\.XP_REQUIRE_SCORE\s*=\s*0;[\s\S]*src="\/js\/xp\/core\.js" defer/, 'Freedoom should allow activity-based XP because the Dwasm runtime does not emit score pulses');
assert.match(freedoomHtml, /js\/vendor\/klaro\/klaro\.js/, 'Freedoom should use the shared Klaro consent runtime');
assert.doesNotMatch(freedoomHtml, /Cookiebot|cookiebot-manager|js-dos|v8\.js-dos\.com/, 'Freedoom should not depend on Cookiebot or js-dos assets');
assert.doesNotMatch(freedoomJs, /freedoom2\.bin|libarchive|Archive\.open|fetchBlob/, 'Freedoom should boot the source-built Dwasm preload instead of extracting a local archive');
assert.match(freedoomJs, /freedoom2\.wad/, 'Freedoom should boot the Freedoom WAD');
assert.match(freedoomJs, /'-config',\s*'\/arcade-prboomx\.cfg'/, 'Freedoom should boot with the Arcade Hub PrBoom control config');
assert.match(freedoomJs, /'-warp',\s*'1'/, 'Freedoom should start in a playable map instead of the demo loop');
assert.match(freedoomJs, /vendor\/dwasm\/index\.js/, 'Freedoom should use the vendored Dwasm runtime');
assert.match(freedoomJs, /window\.FS\.analyzePath\(wadPath\)\.exists/, 'Freedoom should verify that the IWAD is preloaded in the Dwasm data bundle');
assert.doesNotMatch(freedoomJs, /digger\.jsdos|v8\.js-dos\.com|cdn\.dos\.zone/, 'Freedoom should not boot the old Digger/js-dos placeholder');
assert.match(freedoomJs, /setPointerCapture\(activePointerId\)/, 'Freedoom mobile joysticks should capture independent pointer IDs');
assert.doesNotMatch(freedoomJs, /event\.touches\[0\]/, 'Freedoom mobile controls should not read the first global touch');
assert.match(freedoomJs, /key_up\s+0x77/, 'Freedoom PrBoom config should bind forward to W');
assert.match(freedoomJs, /key_down\s+0x73/, 'Freedoom PrBoom config should bind backward to S');
assert.match(freedoomJs, /key_strafeleft\s+0x61/, 'Freedoom PrBoom config should bind strafe-left to A');
assert.match(freedoomJs, /key_straferight\s+0x64/, 'Freedoom PrBoom config should bind strafe-right to D');
assert.match(freedoomJs, /key_use\s+0x65/, 'Freedoom PrBoom config should bind use to E');
assert.match(freedoomJs, /sendKey\('KeyW',\s*shouldMoveUp\)/, 'Freedoom mobile forward control should send the configured forward key');
assert.match(freedoomJs, /sendKey\('KeyA',\s*shouldMoveLeft\)/, 'Freedoom mobile strafe-left control should send the configured strafe key');
assert.match(freedoomJs, /sendKey\('KeyD',\s*shouldMoveRight\)/, 'Freedoom mobile strafe-right control should send the configured strafe key');
assert.match(freedoomJs, /bindKeyButton\(useBtn,\s*'KeyE'\)/, 'Freedoom mobile use button should send the configured use key');
assert.match(freedoomJs, /document\.pointerLockElement === \(state\.renderCanvas \|\| elements\.canvas\)/, 'Freedoom desktop pointer lock should follow the runtime canvas');
assert.match(freedoomJs, /target\.requestPointerLock\(\)/, 'Freedoom desktop controls should request pointer lock on the runtime canvas');
assert.match(freedoomJs, /desktopTurnThreshold:\s*6/, 'Freedoom desktop look should ignore tiny pointer-lock jitter');
assert.match(freedoomJs, /if \(Math\.abs\(deltaX\) < state\.desktopTurnThreshold\) return;/, 'Freedoom desktop look should only turn after a minimum mouse delta');
assert.match(freedoomJs, /pulseDesktopTurn\(turnCode,\s*18\);/, 'Freedoom desktop look should use a short turn pulse close to tapping the arrow keys');
assert.match(freedoomJs, /document\.addEventListener\('mousedown', function\(event\) \{\s*if \(event\.__arcadeSynthetic \|\| event\.button !== 0\) return;[\s\S]*sendKey\('ControlLeft',\s*true\);/, 'Freedoom desktop firing should press the configured fire key from the left mouse button');
assert.match(freedoomJs, /document\.addEventListener\('mouseup', function\(event\) \{\s*if \(event\.__arcadeSynthetic \|\| event\.button !== 0 \|\| !fireHeld\) return;[\s\S]*sendKey\('ControlLeft',\s*false\);/, 'Freedoom desktop firing should release the configured fire key on mouse up');
assert.match(freedoomJs, /window\.addEventListener\('orientationchange'[\s\S]*startGame\(\);/, 'Freedoom should auto-start on page load instead of waiting for a manual Play click');
assert.match(freedoomJs, /movement_mouselook\s+1/, 'Freedoom PrBoom config should enable mouselook for vertical look controls');
assert.match(freedoomJs, /sendMouseMove\(0,\s*Math\.round\(lookVector\.y \* 18\)\)/, 'Freedoom mobile look joystick should drive vertical mouselook');
assert.match(freedoomJs, /document,\s*window/, 'Freedoom synthetic key events should reach the runtime keyboard listeners');
assert.match(freedoomJs, /canvas:\s*renderCanvas/, 'Freedoom runtime should render to an internal canvas instead of the visible presentation canvas');
assert.match(freedoomJs, /ctx\.drawImage\(source,\s*0,\s*0,\s*sourceWidth,\s*sourceHeight,\s*drawX,\s*drawY,\s*drawWidth,\s*drawHeight\)/, 'Freedoom presentation canvas should scale the full runtime frame');
assert.match(freedoomCss, /\.doom-canvas\s*\{[^}]*width:\s*100% !important;[^}]*height:\s*100% !important;/, 'Freedoom canvas should be forced to fit inside the game frame');
assert.match(freedoomCss, /\.freedoom-frame\s*\{[^}]*aspect-ratio:\s*16 \/ 9;/, 'Freedoom frame should match the Dwasm widescreen render aspect');
assert.ok(statSync(path.join(root, 'games-open', 'freedoom', 'vendor', 'dwasm', 'index.data')).size > 20_000_000, 'Freedoom should ship the preloaded Dwasm data bundle');
assert.ok(statSync(path.join(root, 'games-open', 'freedoom', 'vendor', 'dwasm', 'index.wasm')).size > 1_500_000, 'Freedoom should ship the prebuilt Dwasm WebAssembly module');
assert.equal(existsSync(path.join(root, 'games-open', 'freedoom', 'vendor', 'dwasm', 'libarchive.js')), false, 'Freedoom should not keep the old libarchive loader in the runtime path');
assert.equal(existsSync(path.join(root, 'games-open', 'freedoom', 'vendor', 'dwasm', 'libarchive.wasm')), false, 'Freedoom should not keep the old libarchive WASM in the runtime path');
assert.equal(existsSync(path.join(root, 'games-open', 'freedoom', 'vendor', 'dwasm', 'worker-bundle.js')), false, 'Freedoom should not keep the old archive worker bundle in the runtime path');
assert.match(headersFile, /\/games-open\/freedoom\/\*/, 'Freedoom should have a scoped CSP in _headers');
assert.doesNotMatch(headersFile, /dwasm\.m-h\.org\.uk/, 'Freedoom CSP should not rely on a remote WAD mirror');
assert.match(headersFile, /\/\*\s+[\s\S]*?frame-ancestors 'none'[\s\S]*?X-Frame-Options: DENY/, 'portal routes should deny framing by default');
const cspBlocks = [...headersFile.matchAll(/Content-Security-Policy:\s*([^\n]+)/g)].map((match) => match[1]);
assert.equal(cspBlocks.length > 0, true, 'canonical headers should define CSP blocks');
cspBlocks.forEach((csp) => {
  assert.match(csp, /frame-src[^;]*https:\/\/app\.netlify\.com/, 'every CSP variant should allow the Netlify Deploy Preview toolbar frame');
});
for (const route of ['/games-open/*', '/game*.html', '/poker/*', '/games-open/freedoom/*']) {
  const routeStart = headersFile.indexOf(`\n${route}\n`);
  assert.notEqual(routeStart, -1, `${route} should have a scoped frame policy`);
  const routeBlock = headersFile.slice(routeStart, headersFile.indexOf('\n/', routeStart + route.length + 2) === -1 ? undefined : headersFile.indexOf('\n/', routeStart + route.length + 2));
  assert.match(routeBlock, /frame-ancestors 'self'/, `${route} should allow same-origin framing`);
  assert.match(routeBlock, /X-Frame-Options: SAMEORIGIN/, `${route} should use a matching X-Frame-Options policy`);
}
const framedPages = gamesCatalog.games.map((game) => game?.source?.page).filter((page) => typeof page === 'string');
for (const page of framedPages) {
  assert.equal(/^(games-open\/|game[^/]*\.html$|poker\/)/.test(page), true, `catalog frame page must match a scoped header route: ${page}`);
}
assert.doesNotMatch(netlifyToml, /Content-Security-Policy\s*=/, 'CSP should have one canonical source in _headers');
assert.doesNotMatch(netlifyToml, /X-Frame-Options\s*=/, 'X-Frame-Options should have one canonical source in _headers');
assert.doesNotMatch(netlifyToml, /cookiebot/i, 'Netlify CSP should not require Cookiebot hosts after the Klaro migration');
const playInlineScriptHashes = [...playHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => createHash('sha256').update(match[1]).digest('base64'));
playInlineScriptHashes.forEach((hash) => {
  assert.ok(headersFile.includes(`'sha256-${hash}'`), `play.html inline script hash ${hash} must be allowlisted by CSP`);
});
assert.doesNotMatch(portalIndexHtml, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i, 'portal entry page should not require an inline script for its dev badge');
assert.match(debugJs, /actions\/workflows\/tests\.yml/, 'external debug runtime should own the optional CI badge');
assert.match(netlifyToml, /WELCOME_BONUS_START_AT = "2025-06-01T00:00:00Z"/, 'Netlify config should set the welcome bonus rollout date');
assert.match(netlifyToml, /WELCOME_BONUS_CHIPS = "500"/, 'Netlify config should set the welcome bonus amount');
assert.match(netlifyToml, /for = "\/css\/\*"[\s\S]*?Cache-Control = "public, max-age=0, must-revalidate"/, 'CSS files use stable names and should revalidate after deploys');
assert.match(netlifyToml, /for = "\/js\/\*"[\s\S]*?Cache-Control = "public, max-age=0, must-revalidate"/, 'JS files use stable names and should revalidate after deploys');
const cssHeaderBlock = netlifyToml.match(/\[\[headers\]\]\s+for = "\/css\/\*"[\s\S]*?(?=\n\[\[headers\]\]|$)/)?.[0] || '';
const jsHeaderBlock = netlifyToml.match(/\[\[headers\]\]\s+for = "\/js\/\*"[\s\S]*?(?=\n\[\[headers\]\]|$)/)?.[0] || '';
assert.doesNotMatch(cssHeaderBlock, /immutable/, 'Stable CSS paths must not be cached as immutable');
assert.doesNotMatch(jsHeaderBlock, /immutable/, 'Stable JS paths must not be cached as immutable');


const supabaseConfigSource = await readFile(path.join(root, "js", "auth", "supabase-config.js"), "utf8");
assert.doesNotMatch(supabaseConfigSource, /otbqfijerkieoxwpxjnm\.supabase\.co/, "checked-in Supabase browser config should not hardcode the production project");

const supabaseClientSource = await readFile(path.join(root, "js", "auth", "supabaseClient.js"), "utf8");
{
  let bridgeCalls = 0;
  const context = {
    window: {
      SUPABASE_CONFIG: { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" },
      SupabaseAuthBridge: {
        getAccessToken(){
          bridgeCalls += 1;
          return Promise.resolve("fallback-token");
        },
      },
      KLog: { log(){} },
    },
    document: {
      readyState: "loading",
      addEventListener(){},
      getElementById(){ return null; },
      querySelector(){ return null; },
    },
    Promise,
    console,
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(supabaseClientSource, context, { filename: "js/auth/supabaseClient.js" });
  const token = await context.window.SupabaseAuthBridge.getAccessToken();
  assert.equal(token, "fallback-token", "SupabaseAuthBridge should preserve an existing token provider when browser config is empty");
  assert.equal(bridgeCalls, 1, "preserved SupabaseAuthBridge provider should be called exactly once");
}

{
  let signUpPayload = null;
  const context = {
    window: {
      location: { origin: "https://deploy-preview-656--playkcswh.netlify.app", protocol: "https:" },
      SUPABASE_CONFIG: { SUPABASE_URL: "https://stageabc.supabase.co", SUPABASE_ANON_KEY: "anon" },
      supabase: {
        createClient(){
          return {
            auth: {
              getSession(){ return Promise.resolve({ data: { session: null } }); },
              onAuthStateChange(){ return { data: { subscription: { unsubscribe(){} } } }; },
              signUp(payload){ signUpPayload = payload; return Promise.resolve({ data: {} }); },
            },
          };
        },
      },
      KLog: { log(){} },
    },
    document: {
      readyState: "loading",
      addEventListener(){},
      getElementById(){ return null; },
      querySelector(){ return null; },
    },
    Promise,
    console,
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(supabaseClientSource, context, { filename: "js/auth/supabaseClient.js" });
  await context.window.SupabaseAuth.signUp("new.test", "password");
  assert.equal(signUpPayload.options.emailRedirectTo, "https://deploy-preview-656--playkcswh.netlify.app/account.html", "signup confirmation should redirect back to the current deploy origin");
}

const buildTmpDir = await mkdtemp(path.join(os.tmpdir(), "arcade-build-config-"));
try {
  execFileSync(process.execPath, [path.join(root, "scripts", "generate-build-info.js")], {
    cwd: buildTmpDir,
    env: {
      ...process.env,
      CONTEXT: "deploy-preview",
      DEPLOY_PRIME_URL: "https://deploy-preview-388--arcade.netlify.app/build/path",
      SUPABASE_URL: "https://stageabc.supabase.co",
      SUPABASE_ANON_KEY: "stage-anon-key",
    },
    stdio: "pipe",
  });
  const generatedSupabaseConfig = await readFile(path.join(buildTmpDir, "js", "auth", "supabase-config.js"), "utf8");
  const generatedDeployContext = await readFile(path.join(buildTmpDir, "netlify", "functions", "_generated", "deploy-context.mjs"), "utf8");
  assert.match(generatedSupabaseConfig, /https:\/\/stageabc\.supabase\.co/, "build should publish the deploy context Supabase URL to the browser config");
  assert.match(generatedSupabaseConfig, /stage-anon-key/, "build should publish the deploy context Supabase anon key to the browser config");
  assert.doesNotMatch(generatedSupabaseConfig, /otbqfijerkieoxwpxjnm/, "deploy-preview browser config should not retain the production project ref");
  assert.match(generatedDeployContext, /BUILD_DEPLOY_CONTEXT = "deploy-preview"/, "build should embed the Netlify context for server functions");
  assert.match(generatedDeployContext, /BUILD_DEPLOY_ORIGIN = "https:\/\/deploy-preview-388--arcade\.netlify\.app"/, "build should embed only the exact deploy origin for server functions");
} finally {
  await rm(buildTmpDir, { recursive: true, force: true });
}
