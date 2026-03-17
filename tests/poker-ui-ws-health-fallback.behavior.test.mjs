import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

const source = fs.readFileSync('poker/poker.js', 'utf8');
assert.equal(/wsLiveHealthy/.test(source), false, 'dead wsLiveHealthy flag should be removed');

const harness = createPokerTableHarness({ disableWsClient: true });
harness.fireDomContentLoaded();
await harness.flush();

assert.equal(harness.fetchState.getCalls, 1, 'bootstrap loadTable(false) should still run when WS client is unavailable');
const baselineDoneIndex = harness.timeline.findIndex((entry) => entry.kind === 'load_table_fetch_done');
assert.ok(baselineDoneIndex >= 0, 'baseline table fetch should complete before fallback polling starts');
assert.ok(harness.getScheduledTimeoutCount() > 0, 'polling fallback should schedule an HTTP polling timer when WS is unavailable');

const throwingHarness = createPokerTableHarness({
  wsFactory(){
    throw new Error('ws_ctor_sync_fail');
  }
});
throwingHarness.fireDomContentLoaded();
await throwingHarness.flush();

const wsExceptionIndex = throwingHarness.logs.findIndex((entry) => entry.kind === 'poker_ws_exception');
const fallbackIndex = throwingHarness.logs.findIndex((entry) => entry.kind === 'poker_http_fallback_start');
assert.ok(wsExceptionIndex >= 0, 'sync WS bootstrap exception should be logged');
assert.ok(fallbackIndex >= 0, 'fallback start should be logged');
assert.ok(wsExceptionIndex < fallbackIndex, 'exception log must appear before fallback start');
