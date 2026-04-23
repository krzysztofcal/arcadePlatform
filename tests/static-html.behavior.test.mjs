import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const indexHtml = await readFile(path.join(root, 'poker', 'index.html'), 'utf8');
const tableV2Html = await readFile(path.join(root, 'poker', 'table-v2.html'), 'utf8');
const tableV2Css = await readFile(path.join(root, 'poker', 'poker-v2.css'), 'utf8');
const portalCss = await readFile(path.join(root, 'css', 'portal.css'), 'utf8');
const gameCss = await readFile(path.join(root, 'css', 'game.css'), 'utf8');
const landingCss = await readFile(path.join(root, 'landing', 'css', 'landing.css'), 'utf8');
const trexCss = await readFile(path.join(root, 'games', 't-rex', 'style.css'), 'utf8');

const safeAreaViewportFiles = [
  'index.html',
  'play.html',
  'about.en.html',
  'about.pl.html',
  'legal/privacy.en.html',
  'legal/privacy.pl.html',
  'legal/terms.en.html',
  'legal/terms.pl.html',
  'legal/cookies-notice.en.html',
  'legal/cookies-notice.pl.html',
  'landing/index.html',
  'landing/about.html',
  'landing/legal/privacy.en.html',
  'landing/legal/privacy.pl.html',
  'poker/table-v2.html',
  'games/t-rex/index.html',
];

for (const file of safeAreaViewportFiles) {
  const html = await readFile(path.join(root, file), 'utf8');
  assert.match(
    html,
    /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"\s*\/?>/,
    `${file} should opt into viewport-fit=cover for mobile safe-area coverage`,
  );
}

[portalCss, gameCss, landingCss, tableV2Css, trexCss].forEach((css) => {
  assert.doesNotMatch(css, /background[^;]*fixed|background-attachment\s*:\s*fixed/, 'mobile shells should not rely on fixed backgrounds for root coverage');
});

assert.match(indexHtml, /src="\/js\/build-info\.js" defer/, 'poker index should include build-info bootstrap script');
assert.equal(indexHtml.indexOf('/js/build-info.js') < indexHtml.indexOf('/poker/poker-ws-client.js'), true, 'poker index should load build-info before ws client');
assert.doesNotMatch(indexHtml, /pokerClassicEntry/, 'poker lobby should no longer expose the classic table entry');
assert.match(tableV2Html, /id="pokerV2JoinBtn"/, 'poker table v2 should include live join control');
assert.match(tableV2Html, /id="pokerLobbyLink"/, 'poker table v2 should include a back-to-lobby link in the hamburger menu');
assert.doesNotMatch(tableV2Html, /pokerClassicLink/, 'poker table v2 should not expose the classic table link');
assert.doesNotMatch(tableV2Html, /pokerV2Link/, 'poker table v2 should not expose a self-link in the hamburger menu');
assert.doesNotMatch(tableV2Html, /pokerV2DemoPill/, 'poker table v2 should not render the legacy demo pill');
assert.match(tableV2Html, /src="\/poker\/poker-ws-client\.js" defer/, 'poker table v2 should bootstrap WS client for live runtime');
assert.equal(tableV2Html.indexOf('id="pokerSeatLayer"') < tableV2Html.indexOf('id="pokerDealerChip"'), true, 'dealer chip should be positioned in the full scene after the seat layer');
assert.equal(tableV2Html.indexOf('id="pokerDealerChip"') < tableV2Html.indexOf('class="poker-center-layer"'), true, 'dealer chip should not live inside the center layer');
assert.match(tableV2Css, /\.poker-menu-panel\[hidden\]\{display:none;\}/, 'poker table v2 menu should hard-hide when hidden attribute is present');
assert.match(tableV2Css, /\.poker-action-bar\{position:fixed; right:max\(10px, env\(safe-area-inset-right\)\); bottom:max\(10px, env\(safe-area-inset-bottom\)\); width:min\(33vw, 196px\); display:grid; grid-template-columns:40px minmax\(0, 1fr\);/, 'poker table v2 action rail should dock to the bottom-right with a left-side vertical amount slider');
assert.doesNotMatch(tableV2Css, /\.poker-seat--hero \.poker-seat-avatar\{[^}]*border-color:/, 'hero avatar should not keep an always-on active ring');
assert.match(tableV2Css, /\.poker-seat--hero\.poker-seat--active \.poker-seat-avatar\{border-color:rgba\(84,245,152,0\.88\);/, 'hero avatar should turn green only on the active turn');
assert.match(tableV2Html, /id="pokerBootSplash"/, 'poker table v2 should render a boot splash to avoid raw HTML flash');
assert.match(tableV2Html, /id="pokerV2AmountValue"/, 'poker table v2 should render a compact amount value for the action slider');
