import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

const source = fs.readFileSync('poker/poker.js', 'utf8');
assert.equal(/wsLiveHealthy/.test(source), false, 'dead wsLiveHealthy flag should be removed');

const harness = createPokerTableHarness({ disableWsClient: true });
harness.fireDomContentLoaded();
await harness.flush();

assert.equal(harness.fetchState.getCalls, 1, 'bootstrap loadTable(false) should still run when WS client is unavailable');
assert.ok(harness.getScheduledTimeoutCount() > 0, 'polling fallback should schedule an HTTP polling timer when WS is unavailable');
