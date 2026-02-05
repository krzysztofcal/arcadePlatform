import assert from "node:assert/strict";
import { deriveCommunityCards } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { awardPotsAtShowdown } from "../netlify/functions/_shared/poker-payout.mjs";
import { materializeShowdownAndPayout } from "../netlify/functions/_shared/poker-materialize-showdown.mjs";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-secret";

const handSeed = "seed-settlement";
const tableId = "33333333-3333-4333-8333-333333333333";
const seatUserIdsInOrder = ["u1", "u2"];
const holeCardsByUserId = {
  u1: [
    { r: "A", s: "S" },
    { r: "K", s: "H" },
  ],
  u2: [
    { r: "Q", s: "D" },
    { r: "J", s: "C" },
  ],
};

{
  const state = {
    tableId,
    handId: "h-fold",
    phase: "RIVER",
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 },
    ],
    stacks: { u1: 50, u2: 70 },
    pot: 30,
    foldedByUserId: { u1: false, u2: true },
    community: deriveCommunityCards({ handSeed, seatUserIdsInOrder, communityDealt: 5 }),
    communityDealt: 5,
  };
  const next = materializeShowdownAndPayout({ state, seatUserIdsInOrder, holeCardsByUserId, awardPotsAtShowdown }).nextState;
  assert.equal(next.phase, "SETTLED");
  assert.equal(next.handSettlement.handId, "h-fold");
  assert.equal(next.handSettlement.payouts.u1, 30);
}

{
  const state = {
    tableId,
    handId: "h-showdown",
    phase: "RIVER",
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 },
    ],
    stacks: { u1: 80, u2: 70 },
    pot: 20,
    foldedByUserId: { u1: false, u2: false },
    community: deriveCommunityCards({ handSeed, seatUserIdsInOrder, communityDealt: 5 }),
    communityDealt: 5,
  };
  const next = materializeShowdownAndPayout({
    state,
    seatUserIdsInOrder,
    holeCardsByUserId,
    awardPotsAtShowdown,
    computeShowdown: () => ({ winners: ["u2"] }),
  }).nextState;
  assert.equal(next.phase, "SETTLED");
  assert.equal(next.handSettlement.payouts.u2, 20);
  assert.equal(next.handSettlement.payouts.u1 || 0, 0);
  assert.equal(next.stacks.u2 - state.stacks.u2, next.handSettlement.payouts.u2);
}

{
  const state = {
    tableId,
    handId: "h-idem",
    phase: "SETTLED",
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 },
    ],
    stacks: { u1: 110, u2: 90 },
    pot: 0,
    foldedByUserId: { u1: false, u2: false },
    community: deriveCommunityCards({ handSeed, seatUserIdsInOrder, communityDealt: 5 }),
    showdown: {
      handId: "h-idem",
      winners: ["u1"],
      potsAwarded: [{ amount: 20, winners: ["u1"], eligibleUserIds: ["u1", "u2"] }],
      reason: "computed",
    },
    handSettlement: {
      handId: "h-idem",
      settledAt: "2026-01-01T00:00:00.000Z",
      payouts: { u1: 20 },
    },
  };
  const first = materializeShowdownAndPayout({ state, seatUserIdsInOrder, holeCardsByUserId, awardPotsAtShowdown }).nextState;
  const second = materializeShowdownAndPayout({ state: first, seatUserIdsInOrder, holeCardsByUserId, awardPotsAtShowdown }).nextState;
  assert.deepEqual(second, first);
}


{
  const state = {
    tableId,
    handId: "h-negative-delta",
    phase: "RIVER",
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 },
    ],
    stacks: { u1: 100, u2: 100 },
    pot: 10,
    foldedByUserId: { u1: false, u2: false },
    community: deriveCommunityCards({ handSeed, seatUserIdsInOrder, communityDealt: 5 }),
    communityDealt: 5,
  };
  assert.throws(
    () =>
      materializeShowdownAndPayout({
        state,
        seatUserIdsInOrder,
        holeCardsByUserId,
        awardPotsAtShowdown: () => ({
          nextState: {
            ...state,
            pot: 0,
            stacks: { u1: 90, u2: 120 },
            showdown: { handId: "h-negative-delta", winners: ["u2"], potsAwarded: [], reason: "computed" },
          },
        }),
      }),
    /showdown_invalid_stack_delta/
  );
}


{
  const showdownOnly = {
    tableId,
    handId: "h-backfill",
    phase: "SHOWDOWN",
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 },
    ],
    stacks: { u1: 90, u2: 110 },
    pot: 0,
    turnUserId: "u2",
    turnStartedAt: 123,
    turnDeadlineAt: 456,
    foldedByUserId: { u1: false, u2: false },
    showdown: {
      handId: "h-backfill",
      winners: ["u2"],
      potsAwarded: [{ amount: 20, winners: ["u2"], eligibleUserIds: ["u1", "u2"] }],
      reason: "computed",
    },
  };
  const next = materializeShowdownAndPayout({
    state: showdownOnly,
    seatUserIdsInOrder,
    holeCardsByUserId,
    awardPotsAtShowdown,
  }).nextState;
  assert.equal(next.phase, "SETTLED");
  assert.equal(next.handSettlement.handId, "h-backfill");
  assert.equal(next.handSettlement.payouts.u2, 20);
  assert.equal(next.turnUserId, null);
  assert.equal(next.turnStartedAt, null);
  assert.equal(next.turnDeadlineAt, null);
}

{
  const mismatch = {
    tableId,
    handId: "h-mismatch",
    phase: "SETTLED",
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 },
    ],
    stacks: { u1: 90, u2: 110 },
    pot: 0,
    foldedByUserId: { u1: false, u2: false },
    showdown: { handId: "h-mismatch", winners: ["u2"], potsAwarded: [], reason: "computed" },
    handSettlement: { handId: "other-hand", settledAt: "2026-01-01T00:00:00.000Z", payouts: {} },
  };
  assert.throws(
    () => materializeShowdownAndPayout({ state: mismatch, seatUserIdsInOrder, holeCardsByUserId, awardPotsAtShowdown }),
    /showdown_settlement_hand_mismatch/
  );
}
