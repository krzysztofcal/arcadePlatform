import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const tableHtml = await readFile(path.join(root, 'poker', 'table.html'), 'utf8');
const indexHtml = await readFile(path.join(root, 'poker', 'index.html'), 'utf8');
const tableV2Html = await readFile(path.join(root, 'poker', 'table-v2.html'), 'utf8');

assert.match(tableHtml, /src="\/js\/debug\.js"/, 'poker table should include shared debug recorder script');
assert.match(tableHtml, /id="pokerDumpLogsBtn"/, 'poker table should include dump logs button');
assert.match(tableHtml, /id="pokerDumpLogsStatus"/, 'poker table should include dump logs status element');
assert.match(tableHtml, /id="pokerCopyLogBtn"/, 'existing copy hand log button should remain present');


assert.match(tableHtml, /src="\/js\/build-info\.js" defer/, 'poker table should include build-info bootstrap script');
assert.equal(tableHtml.indexOf('/js/build-info.js') < tableHtml.indexOf('/poker/poker-ws-client.js'), true, 'poker table should load build-info before ws client');
assert.match(indexHtml, /src="\/js\/build-info\.js" defer/, 'poker index should include build-info bootstrap script');
assert.equal(indexHtml.indexOf('/js/build-info.js') < indexHtml.indexOf('/poker/poker-ws-client.js'), true, 'poker index should load build-info before ws client');
assert.match(indexHtml, /id="pokerClassicEntry"/, 'poker lobby should keep a visible classic table entry for testing');
assert.match(tableV2Html, /id="pokerV2JoinBtn"/, 'poker table v2 should include live join control');
assert.match(tableV2Html, /src="\/poker\/poker-ws-client\.js" defer/, 'poker table v2 should bootstrap WS client for live runtime');
