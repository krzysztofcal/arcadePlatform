import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

const harness = createPokerTableHarness({ initialToken: null });

harness.fireDomContentLoaded();
await harness.flush();

assert.equal(harness.wsCreates.length, 0, 'no ws should start while unauthenticated');

harness.setAccessToken('aaa.' + Buffer.from(JSON.stringify({ sub: 'user-1' })).toString('base64') + '.zzz');
harness.runIntervals();
await harness.flush();

assert.equal(harness.fetchState.getCalls, 1, 'auth-watch recovery should run one baseline table load');
assert.equal(harness.wsCreates.length, 1, 'auth-watch recovery should create one ws client after baseline load');

const recoverStart = harness.timeline.findIndex((entry) => entry.kind === 'load_table_fetch_start');
const recoverDone = harness.timeline.findIndex((entry) => entry.kind === 'load_table_fetch_done');
const recoverWs = harness.timeline.findIndex((entry) => entry.kind === 'ws_start');
assert.ok(recoverStart >= 0 && recoverDone >= 0 && recoverWs >= 0, 'recovery timeline should include baseline and ws start events');
assert.ok(recoverStart < recoverDone && recoverDone < recoverWs, 'auth-watch recovery ordering must be baseline load completion before ws start');

harness.runIntervals();
await harness.flush();
assert.equal(harness.wsCreates.length, 1, 'repeated auth-watch ticks should remain idempotent and avoid duplicate ws clients');
