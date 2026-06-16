import assert from "node:assert/strict";
import { clearMissedTurns, patchMissedTurnsByUserId } from "../netlify/functions/_shared/poker-missed-turns.mjs";

const run = async () => {
  {
    const state = { seats: [{ userId: "user-1" }] };
    const cleared = clearMissedTurns(state, "user-1");
    assert.equal(cleared.changed, false);
    assert.equal(cleared.nextState, state);
  }

  {
    const state = { missedTurnsByUserId: { "user-1": 2 } };
    const cleared = clearMissedTurns(state, "user-1");
    assert.equal(cleared.changed, true);
    assert.equal(cleared.nextState.missedTurnsByUserId["user-1"], undefined);
  }

  {
    const state = { missedTurnsByUserId: { "user-2": 1 } };
    const cleared = clearMissedTurns(state, "user-1");
    assert.equal(cleared.changed, false);
    assert.equal(cleared.nextState, state);
  }

  {
    const state = { missedTurnsByUserId: 3 };
    const cleared = clearMissedTurns(state, "user-1");
    assert.equal(cleared.changed, false);
    assert.equal(cleared.nextState, state);
  }

  {
    const state = { missedTurnsByUserId: { "user-1": 1 } };
    const cleared = clearMissedTurns(state, "");
    assert.equal(cleared.changed, false);
    assert.equal(cleared.nextState, state);
  }

  {
    const state = { missedTurnsByUserId: { "user-1": 1 } };
    const patched = patchMissedTurnsByUserId(state, "user-1", 2);
    assert.equal(patched.changed, true);
    assert.equal(patched.nextState.missedTurnsByUserId["user-1"], 2);
  }
};

await run();
