import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCiImpact } from '../scripts/ci-impact.mjs';
test('consolidated main WS validation covers runtime, browser contracts and shared inputs', () => {
  for (const path of ['ws-server/server.mjs', 'shared/poker-domain/join.mjs', 'poker/table-v2.html', 'tests/poker-ws-client.test.mjs', 'scripts/test-all.mjs']) {
    assert.equal(classifyCiImpact([path]).ws_poker, true, path);
  }
});
