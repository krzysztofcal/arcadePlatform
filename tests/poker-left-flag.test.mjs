import assert from "node:assert/strict";
import { patchLeftTableByUserId } from "../netlify/functions/_shared/poker-left-flag.mjs";

const run = async () => {
  {
    const state = { seats: [{ userId: "user-1" }] };
    const patched = patchLeftTableByUserId(state, "user-1", false);
    assert.equal(patched.changed, false);
    assert.equal(patched.nextState, state);
  }

  {
    const state = { leftTableByUserId: { "user-1": true } };
    const patched = patchLeftTableByUserId(state, "user-1", false);
    assert.equal(patched.changed, true);
    assert.equal(patched.nextState.leftTableByUserId["user-1"], false);
  }

  {
    const state = { leftTableByUserId: { "user-1": false } };
    const patched = patchLeftTableByUserId(state, "user-1", false);
    assert.equal(patched.changed, false);
    assert.equal(patched.nextState, state);
  }
};

await run();
