import test from "node:test";
import assert from "node:assert/strict";
import { buildStatePatch } from "./state-patch.mjs";

test("buildStatePatch returns changed top-level branches only", () => {
  const beforePayload = {
    stateVersion: 1,
    table: { tableId: "t1", members: [] },
    you: { userId: "u1", seat: 1 },
    public: { pot: { total: 0 }, turn: { seat: 1 } },
    private: { userId: "u1", seat: 1, holeCards: ["As", "Kd"] }
  };
  const nextPayload = {
    stateVersion: 2,
    table: { tableId: "t1", members: [] },
    you: { userId: "u1", seat: 1 },
    public: { pot: { total: 2 }, turn: { seat: 2 } },
    private: { userId: "u1", seat: 1, holeCards: ["As", "Kd"] }
  };

  const patch = buildStatePatch({ beforePayload, nextPayload });
  assert.equal(patch.ok, true);
  assert.deepEqual(Object.keys(patch.patch).sort(), ["public", "stateVersion"]);
  assert.equal(patch.patch.stateVersion, 2);
  assert.equal(JSON.stringify(patch.patch).length < JSON.stringify(nextPayload).length, true);
});

test("buildStatePatch falls back when patch would be unsafe or non-deterministic", () => {
  const fallback = buildStatePatch({ beforePayload: null, nextPayload: { stateVersion: 2 } });
  assert.equal(fallback.ok, false);

  const incompatible = buildStatePatch({
    beforePayload: { stateVersion: 2, table: {}, you: {}, public: {} },
    nextPayload: { stateVersion: 1, table: {}, you: {}, public: {} }
  });
  assert.equal(incompatible.ok, false);
});

test("buildStatePatch preserves seated private scope", () => {
  const beforeObserver = {
    stateVersion: 5,
    table: { tableId: "t1", members: [] },
    you: { userId: "obs", seat: null },
    public: { pot: { total: 10 } }
  };
  const nextObserver = {
    stateVersion: 6,
    table: { tableId: "t1", members: [] },
    you: { userId: "obs", seat: null },
    public: { pot: { total: 20 } }
  };
  const observerPatch = buildStatePatch({ beforePayload: beforeObserver, nextPayload: nextObserver });
  assert.equal(observerPatch.ok, true);
  assert.equal("private" in observerPatch.patch, false);

  const beforeSeated = { ...beforeObserver, you: { userId: "u1", seat: 1 }, private: { userId: "u1", seat: 1, holeCards: ["As", "Kd"] } };
  const nextSeated = { ...nextObserver, you: { userId: "u1", seat: 1 }, private: { userId: "u1", seat: 1, holeCards: ["Ah", "Kh"] } };
  const seatedPatch = buildStatePatch({ beforePayload: beforeSeated, nextPayload: nextSeated });
  assert.equal(seatedPatch.ok, true);
  assert.deepEqual(seatedPatch.patch.private, { userId: "u1", seat: 1, holeCards: ["Ah", "Kh"] });
});
