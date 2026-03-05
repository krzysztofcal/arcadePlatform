import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { applyCoreEvent, createInitialCoreState } from "./index.mjs";

test("core reducer is deterministic for same input", () => {
  const state0 = createInitialCoreState({ roomId: "table_A", maxSeats: 6 });
  const joinEvent = { type: "core_join", requestId: "r1", userId: "u1" };

  const first = applyCoreEvent(state0, joinEvent);
  const second = applyCoreEvent(state0, joinEvent);

  assert.deepEqual(first, second);
});

test("core reducer is idempotent by requestId", () => {
  const state0 = createInitialCoreState({ roomId: "table_A", maxSeats: 6 });
  const joinEvent = { type: "core_join", requestId: "r1", userId: "u1" };

  const first = applyCoreEvent(state0, joinEvent);
  const second = applyCoreEvent(first.state, joinEvent);

  assert.equal(second.ok, true);
  assert.deepEqual(second.state, first.state);
  assert.deepEqual(second.effects, [{ type: "noop", reason: "already_applied" }]);
});

test("unknown event returns structured error without mutating state", () => {
  const state0 = createInitialCoreState({ roomId: "table_A", maxSeats: 6 });
  const before = structuredClone(state0);

  const result = applyCoreEvent(state0, { type: "nope", requestId: "r2" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unsupported_event");
  assert.deepEqual(state0, before);
  assert.equal(result.state, state0);
});

test("core reducer has no direct time dependency", () => {
  const reducerText = fs.readFileSync("ws-server/poker/core/reducer.mjs", "utf8");
  assert.doesNotMatch(reducerText, /Date\.now\(|new Date\(/);
});
