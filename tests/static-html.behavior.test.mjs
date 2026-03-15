import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const tableHtml = await readFile(path.join(root, 'poker', 'table.html'), 'utf8');

assert.match(tableHtml, /src="\/js\/debug\.js"/, 'poker table should include shared debug recorder script');
assert.match(tableHtml, /id="pokerDumpLogsBtn"/, 'poker table should include dump logs button');
assert.match(tableHtml, /id="pokerDumpLogsStatus"/, 'poker table should include dump logs status element');
assert.match(tableHtml, /id="pokerCopyLogBtn"/, 'existing copy hand log button should remain present');
