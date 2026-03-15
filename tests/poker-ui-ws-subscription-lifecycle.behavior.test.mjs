import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

const harness = createPokerTableHarness();

harness.fireDomContentLoaded();
await harness.flush();

assert.equal(harness.wsCreates.length, 1, 'startup should create exactly one WS client');

harness.fireDocumentEvent('visibilitychange');
await harness.flush();
assert.equal(harness.wsCreates.length, 1, 'repeated visible lifecycle runs should not create duplicate WS clients');

harness.fireWindowEvent('pagehide');
await harness.flush();
assert.equal(harness.wsDestroys.length, 1, 'pagehide should stop active WS client');

harness.setVisibility('hidden');
harness.fireDocumentEvent('visibilitychange');
await harness.flush();

harness.setVisibility('visible');
harness.fireDocumentEvent('visibilitychange');
await harness.flush();

assert.equal(harness.wsCreates.length, 2, 'becoming visible after teardown should create one new WS client');
assert.equal(harness.wsDestroys.length, 1, 'hidden transition after pagehide should not leave extra WS clients to destroy');
