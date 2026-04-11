import test from "node:test";
import assert from "node:assert/strict";
import { resolveSettledRevealDueAt } from "./settled-reveal-timing.mjs";

test("resolveSettledRevealDueAt keeps original settled timestamp instead of restarting reveal window", () => {
  const nowMs = Date.parse("2026-04-11T12:00:00.000Z");
  const settledAt = "2026-04-11T11:59:55.000Z";
  const revealMs = 2_000;

  const dueAt = resolveSettledRevealDueAt({ settledAt, nowMs, revealMs });

  assert.equal(dueAt, Date.parse(settledAt) + revealMs);
  assert.equal(dueAt <= nowMs, true);
});

test("resolveSettledRevealDueAt falls back to now when settledAt is missing", () => {
  const nowMs = Date.parse("2026-04-11T12:00:00.000Z");
  const revealMs = 2_000;

  const dueAt = resolveSettledRevealDueAt({ settledAt: null, nowMs, revealMs });

  assert.equal(dueAt, nowMs + revealMs);
});
