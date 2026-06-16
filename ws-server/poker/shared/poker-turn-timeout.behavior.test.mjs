import test from "node:test";
import assert from "node:assert/strict";
import { decideTurnTimeout, stampTurnDeadline } from "./poker-turn-timeout.mjs";

test("decideTurnTimeout returns no timeout when deadline is unexpired", () => {
  const nowMs = 1_000;
  const state = {
    phase: "PREFLOP",
    turnUserId: "user_a",
    turnDeadlineAt: nowMs + 500,
    stacks: { user_a: 100, user_b: 100 },
    currentBet: 0,
    betThisRoundByUserId: { user_a: 0, user_b: 0 },
    foldedByUserId: { user_a: false, user_b: false }
  };

  const decision = decideTurnTimeout({ pokerState: state, nowMs });
  assert.equal(decision.due, false);
  assert.equal(decision.reason, "deadline_unexpired");
});

test("decideTurnTimeout selects deterministic default action for expired turn", () => {
  const state = {
    phase: "PREFLOP",
    turnUserId: "user_a",
    turnDeadlineAt: 100,
    stacks: { user_a: 100, user_b: 100 },
    currentBet: 2,
    betThisRoundByUserId: { user_a: 1, user_b: 2 },
    foldedByUserId: { user_a: false, user_b: false }
  };

  const decision = decideTurnTimeout({ pokerState: state, nowMs: 200 });
  assert.equal(decision.due, true);
  assert.equal(decision.actorUserId, "user_a");
  assert.deepEqual(decision.action, { type: "FOLD", userId: "user_a" });
});

test("stampTurnDeadline sets started/deadline for live turn and clears terminal states", () => {
  const started = stampTurnDeadline({ phase: "TURN", turnUserId: "user_a" }, 5_000, 250);
  assert.equal(started.turnStartedAt, 5_000);
  assert.equal(started.turnDeadlineAt, 5_250);

  const settled = stampTurnDeadline({ phase: "SETTLED", turnUserId: null, turnStartedAt: 1, turnDeadlineAt: 2 }, 5_000, 250);
  assert.equal(settled.turnStartedAt, null);
  assert.equal(settled.turnDeadlineAt, null);
});
