import assert from "node:assert/strict";
import { patchSitOutByUserId } from "../netlify/functions/_shared/poker-sitout-flag.mjs";

const run = () => {
  {
    const state = { tableId: "t1" };
    const result = patchSitOutByUserId(state, "user-1", false);
    assert.equal(result.changed, false);
    assert.equal(result.nextState, state);
  }

  {
    const state = { sitOutByUserId: { "user-1": true } };
    const result = patchSitOutByUserId(state, "user-1", false);
    assert.equal(result.changed, true);
    assert.equal(result.nextState.sitOutByUserId["user-1"], false);
  }

  {
    const state = { sitOutByUserId: { "user-1": false } };
    const result = patchSitOutByUserId(state, "user-1", false);
    assert.equal(result.changed, false);
    assert.equal(result.nextState, state);
  }

  {
    const state = { sitOutByUserId: { "user-1": true } };
    const result = patchSitOutByUserId(state, "", false);
    assert.equal(result.changed, false);
    assert.equal(result.nextState, state);
  }
};

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
