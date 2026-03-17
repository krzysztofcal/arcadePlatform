import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

const harness = createPokerTableHarness();

harness.fireDomContentLoaded();
await harness.flush();

assert.equal(harness.wsCreates.length, 1, 'startup should create one ws client');

harness.setVisibility('hidden');
harness.fireDocumentEvent('visibilitychange');
await harness.flush();

assert.equal(harness.wsDestroys.length, 1, 'hidden transition should destroy current ws client');

const getCallsBeforeResume = harness.fetchState.getCalls;
harness.setVisibility('visible');
harness.fireDocumentEvent('visibilitychange');
await harness.flush();

assert.equal(harness.fetchState.getCalls, getCallsBeforeResume + 1, 'visibility resume should perform baseline loadTable(false) once');
assert.equal(harness.wsCreates.length, 2, 'visibility resume should create exactly one replacement ws client');
assert.equal(harness.wsDestroys.length, 1, 'visibility resume should not destroy additional ws client instances');

const resumeTimeline = harness.timeline.slice(-3);
assert.deepEqual(
  resumeTimeline.map((entry) => entry.kind),
  ['load_table_fetch_start', 'load_table_fetch_done', 'ws_start'],
  'visibility resume ordering must be baseline fetch then ws start'
);
