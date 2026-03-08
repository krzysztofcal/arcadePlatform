import test from "node:test";
import assert from "node:assert/strict";
import { applyCoreStateTurnTimeout, bootstrapCoreStateHand } from "./poker-engine.mjs";

function initialCore() {
  return {
    roomId: "table_engine_timeout",
    version: 0,
    seats: { user_a: 1, user_b: 2 },
    members: [
      { userId: "user_a", seat: 1 },
      { userId: "user_b", seat: 2 }
    ],
    pokerState: null
  };
}

test("engine timeout apply is idempotent when invoked twice at same clock", () => {
  const boot = bootstrapCoreStateHand({ tableId: "table_engine_timeout", coreState: initialCore(), nowMs: 1000 });
  const deadline = boot.coreState.pokerState.turnDeadlineAt;

  const first = applyCoreStateTurnTimeout({
    tableId: "table_engine_timeout",
    coreState: boot.coreState,
    nowMs: deadline + 1
  });
  assert.equal(first.changed, true);

  const second = applyCoreStateTurnTimeout({
    tableId: "table_engine_timeout",
    coreState: first.coreState,
    nowMs: deadline + 1
  });
  assert.equal(second.changed, false);
  assert.notEqual(first.stateVersion, boot.coreState.version);
  assert.equal(second.stateVersion, first.stateVersion);
});
