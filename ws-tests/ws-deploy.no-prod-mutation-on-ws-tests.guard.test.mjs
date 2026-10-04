import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCiImpact } from '../scripts/ci-impact.mjs';
test('WS contract tests do not authorize Production mutation', () => {
  for (const path of ['ws-tests/ws-join-runtime.behavior.test.mjs', 'tests/poker-ws-client.test.mjs', 'docs/ws-poker-protocol.md']) {
    const impact = classifyCiImpact([path]);
    assert.equal(impact.ws_poker, true);
    assert.equal(impact.deploy_ws, false);
  }
});
