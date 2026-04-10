import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const tableHtml = await readFile(path.join(root, 'poker', 'table.html'), 'utf8');
const indexHtml = await readFile(path.join(root, 'poker', 'index.html'), 'utf8');
const tableV2Html = await readFile(path.join(root, 'poker', 'table-v2.html'), 'utf8');
const tableV2Css = await readFile(path.join(root, 'poker', 'poker-v2.css'), 'utf8');

assert.match(tableHtml, /src="\/js\/debug\.js"/, 'poker table should include shared debug recorder script');
assert.match(tableHtml, /id="pokerDumpLogsBtn"/, 'poker table should include dump logs button');
assert.match(tableHtml, /id="pokerDumpLogsStatus"/, 'poker table should include dump logs status element');
assert.match(tableHtml, /id="pokerCopyLogBtn"/, 'existing copy hand log button should remain present');


assert.match(tableHtml, /src="\/js\/build-info\.js" defer/, 'poker table should include build-info bootstrap script');
assert.equal(tableHtml.indexOf('/js/build-info.js') < tableHtml.indexOf('/poker/poker-ws-client.js'), true, 'poker table should load build-info before ws client');
assert.match(indexHtml, /src="\/js\/build-info\.js" defer/, 'poker index should include build-info bootstrap script');
assert.equal(indexHtml.indexOf('/js/build-info.js') < indexHtml.indexOf('/poker/poker-ws-client.js'), true, 'poker index should load build-info before ws client');
assert.match(indexHtml, /id="pokerClassicEntry"/, 'poker lobby should keep a visible classic table entry for testing');
assert.match(tableHtml, /id="pokerOpenV2Link"/, 'classic poker table should include an explicit open in v2 link');
assert.match(tableV2Html, /id="pokerV2JoinBtn"/, 'poker table v2 should include live join control');
assert.match(tableV2Html, /id="pokerLobbyLink"/, 'poker table v2 should include a back-to-lobby link in the hamburger menu');
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
