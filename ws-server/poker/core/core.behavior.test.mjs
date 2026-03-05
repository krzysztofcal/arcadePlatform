import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { applyCoreEvent, createInitialCoreState, validateCoreState } from "./index.mjs";

test("core reducer is deterministic for same input", () => {
  const state0 = createInitialCoreState({ roomId: "table_A", maxSeats: 6 });
  const joinEvent = { type: "core_join", requestId: "r1", userId: "u1" };

  const first = applyCoreEvent(state0, joinEvent);
  const second = applyCoreEvent(state0, joinEvent);

  assert.deepEqual(first, second);
});

test("core reducer assigns deterministic lowest seats and reuses freed seat", () => {
  const state0 = createInitialCoreState({ roomId: "table_A", maxSeats: 2 });

  const joinedU1 = applyCoreEvent(state0, { type: "core_join", requestId: "r1", userId: "u1" });
  const joinedU2 = applyCoreEvent(joinedU1.state, { type: "core_join", requestId: "r2", userId: "u2" });
  const leftU1 = applyCoreEvent(joinedU2.state, { type: "core_leave", requestId: "r3", userId: "u1" });
  const joinedU3 = applyCoreEvent(leftU1.state, { type: "core_join", requestId: "r4", userId: "u3" });

  assert.equal(joinedU1.state.members.find((entry) => entry.userId === "u1")?.seat, 1);
  assert.equal(joinedU2.state.members.find((entry) => entry.userId === "u2")?.seat, 2);
  assert.equal(joinedU3.state.members.find((entry) => entry.userId === "u3")?.seat, 1);
  assert.deepEqual(
    joinedU3.state.members,
    [
      { userId: "u2", seat: 2 },
      { userId: "u3", seat: 1 }
    ]
  );
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

test("state validation rejects out-of-bounds and duplicate seat assignments", () => {
  const validState = createInitialCoreState({ roomId: "table_A", maxSeats: 2 });
  const seeded = {
    ...validState,
    members: [
      { userId: "u1", seat: 1 },
      { userId: "u2", seat: 2 }
    ],
    seats: { u1: 1, u2: 2 }
  };

  assert.equal(validateCoreState(seeded).ok, true);

  const duplicateSeatState = {
    ...seeded,
    members: [
      { userId: "u1", seat: 1 },
      { userId: "u2", seat: 1 }
    ],
    seats: { u1: 1, u2: 1 }
  };
  assert.equal(validateCoreState(duplicateSeatState).ok, false);

  const outOfBoundsState = {
    ...seeded,
    members: [{ userId: "u1", seat: 3 }],
    seats: { u1: 3 }
  };
  assert.equal(validateCoreState(outOfBoundsState).ok, false);
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
