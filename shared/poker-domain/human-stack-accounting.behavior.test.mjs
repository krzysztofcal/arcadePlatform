import assert from "node:assert/strict";
import test from "node:test";
import { requireAuthoritativeHumanStack, resolveAuthoritativeHumanStack } from "./human-stack-accounting.mjs";

test("authoritative human stack preserves zero and ignores a stale seat projection", () => {
  const result = resolveAuthoritativeHumanStack({ state: { stacks: { human: 0 } }, userId: "human", seatStack: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.amount, 0);
  assert.equal(result.source, "authoritative_state");
});

test("missing or invalid authoritative stack is ambiguous regardless of seat projection", () => {
  const missing = resolveAuthoritativeHumanStack({ state: { stacks: {} }, userId: "human", seatStack: 100 });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "stack_ambiguous");
  assert.equal(missing.source, "ambiguous");
  assert.equal(resolveAuthoritativeHumanStack({ state: { stacks: { human: -1 } }, userId: "human" }).ok, false);
  assert.equal(resolveAuthoritativeHumanStack({ state: { stacks: { human: Number.NaN } }, userId: "human" }).ok, false);
});

test("required authoritative stack fails closed with the controlled reason", () => {
  assert.throws(() => requireAuthoritativeHumanStack({ state: {}, userId: "human" }), (error) => error?.code === "stack_ambiguous" && error?.status === 409);
});
