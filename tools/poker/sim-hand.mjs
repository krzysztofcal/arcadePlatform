#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  initHandState,
  getLegalActions,
  applyAction,
  advanceIfNeeded,
} from "../../netlify/functions/_shared/poker-reducer.mjs";

import { withoutPrivateState } from "../../netlify/functions/_shared/poker-state-utils.mjs";

// Deterministic RNG (same idea as tests/poker-reducer.test.mjs)
const makeRng = (seed) => {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const isActionPhase = (p) => p === "PREFLOP" || p === "FLOP" || p === "TURN" || p === "RIVER";

const pickAutoAction = (state) => {
  const userId = state.turnUserId;
  const legal = getLegalActions(state, userId);

  const has = (t) => legal.some((a) => a.type === t);

  // Prefer CHECK, else CALL, else FOLD (keeps it simple + always legal)
  if (has("CHECK")) return { userId, type: "CHECK" };
  if (has("CALL")) return { userId, type: "CALL" };
  return { userId, type: "FOLD" };
};

const snapshot = (label, state, extra = {}) => {
  const pub = withoutPrivateState(state);
  console.log(`\n=== ${label} ===`);
  console.log({
    phase: pub.phase,
    handId: pub.handId,
    dealerSeatNo: pub.dealerSeatNo,
    turnUserId: pub.turnUserId,
    communityDealt: pub.communityDealt,
    community: pub.community,
    pot: pub.pot,
    stacks: pub.stacks,
    toCallByUserId: pub.toCallByUserId,
    betThisRoundByUserId: pub.betThisRoundByUserId,
    actedThisRoundByUserId: pub.actedThisRoundByUserId,
    foldedByUserId: pub.foldedByUserId,
    ...extra,
  });
};

function main() {
  const seats = [
    { userId: "u1", seatNo: 1 },
    { userId: "u2", seatNo: 2 },
    { userId: "u3", seatNo: 3 },
  ];
  const stacks = { u1: 100, u2: 100, u3: 100 };

  // IMPORTANT: initHandState returns { state, events }
  let { state, events } = initHandState({
    tableId: "local-table",
    seats,
    stacks,
    rng: makeRng(1),
  });
  if (!state.handId) state.handId = `local-${Date.now()}`;

  snapshot("START", state, { eventsCount: events?.length || 0 });

  let step = 0;

  while (isActionPhase(state.phase)) {
    step += 1;

    // choose an action that is actually legal
    const action = pickAutoAction(state);

    // IMPORTANT: applyAction returns { state, events }
    const applied = applyAction(state, action);
    assert.ok(applied && applied.state, "applyAction returned no state");

    state = applied.state;

    // Advance streets if needed (can emit events and mutate state)
    let loops = 0;
    while (loops < 10) {
      const adv = advanceIfNeeded(state);
      assert.ok(adv && adv.state, "advanceIfNeeded returned no state");

      state = adv.state;

      // If no events, no more automatic transitions right now
      if (!Array.isArray(adv.events) || adv.events.length === 0) break;
      loops += 1;
    }

    snapshot(`STEP ${step}: ${action.userId} ${action.type}`, state);
  }

  console.log(`\nHand ended in phase: ${state.phase}`);
  console.log("\nDONE ✅");
}

main();
