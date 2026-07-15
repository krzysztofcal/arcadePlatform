import test from "node:test";
import assert from "node:assert/strict";
import { awardPotsAtShowdown as awardNetlifyPots } from "../netlify/functions/_shared/poker-payout.mjs";
import { awardPotsAtShowdown as awardSharedPots } from "../ws-server/poker/shared/settlement/poker-payout.mjs";
import { awardPotsAtShowdown as awardSnapshotPots } from "../ws-server/poker/snapshot-runtime/poker-payout.mjs";

const implementations = [
  ["netlify", awardNetlifyPots],
  ["shared WS", awardSharedPots],
  ["snapshot WS", awardSnapshotPots]
];

for (const [label, awardPotsAtShowdown] of implementations) {
  test(`${label} settlement keeps folded and left contributions as dead money`, () => {
    const state = {
      phase: "RIVER",
      community: ["2H", "3D", "4S", "9C", "KD"],
      holeCardsByUserId: {
        folded: ["AS", "AD"],
        player_b: ["KS", "KH"],
        player_c: ["QS", "QH"]
      },
      foldedByUserId: { folded: true, player_b: false, player_c: false },
      leftTableByUserId: { folded: true },
      stacks: { folded: 382, player_b: 10, player_c: 20 },
      contributionsByUserId: { folded: 1, player_b: 16, player_c: 17 },
      pot: 34
    };
    const computeShowdown = ({ players }) => ({
      winners: [players.length === 1 ? players[0].userId : "player_b"]
    });

    const { nextState } = awardPotsAtShowdown({
      state,
      seatUserIdsInOrder: ["folded", "player_b", "player_c"],
      computeShowdown,
      nowIso: "2026-07-15T00:00:00.000Z"
    });

    assert.equal(nextState.showdown.potAwardedTotal, 34);
    assert.equal(nextState.showdown.potsAwarded.reduce((total, pot) => total + pot.amount, 0), 34);
    assert.equal(nextState.stacks.folded, 382);
    assert.equal(nextState.stacks.player_b, 43);
    assert.equal(nextState.stacks.player_c, 21);
    assert.equal(nextState.showdown.potsAwarded.some((pot) => pot.eligibleUserIds.includes("folded")), false);
  });

  test(`${label} settlement returns a folded player's uncalled excess`, () => {
    const state = {
      phase: "RIVER",
      community: ["2H", "3D", "4S", "9C", "KD"],
      holeCardsByUserId: {
        folded: ["AS", "AD"],
        player_a: ["KS", "KH"],
        player_b: ["QS", "QH"]
      },
      foldedByUserId: { folded: true, player_a: false, player_b: false },
      leftTableByUserId: { folded: true },
      stacks: { folded: 0, player_a: 90, player_b: 90 },
      contributionsByUserId: { folded: 100, player_a: 10, player_b: 10 },
      pot: 120
    };
    const computeShowdown = () => ({ winners: ["player_a"] });

    const { nextState } = awardPotsAtShowdown({
      state,
      seatUserIdsInOrder: ["folded", "player_a", "player_b"],
      computeShowdown,
      nowIso: "2026-07-15T00:00:00.000Z"
    });

    assert.equal(nextState.showdown.potAwardedTotal, 120);
    assert.deepEqual(nextState.showdown.winners, ["player_a"]);
    assert.deepEqual(nextState.showdown.potsAwarded, [
      { amount: 30, winners: ["player_a"], eligibleUserIds: ["player_a", "player_b"] },
      { amount: 90, winners: ["folded"], eligibleUserIds: ["folded"] }
    ]);
    assert.deepEqual(nextState.stacks, { folded: 90, player_a: 120, player_b: 90 });
    assert.equal(Object.values(nextState.stacks).reduce((total, stack) => total + stack, 0), 300);
  });

  test(`${label} settlement does not return matched folded contributions`, () => {
    const state = {
      phase: "RIVER",
      community: ["2H", "3D", "4S", "9C", "KD"],
      holeCardsByUserId: {
        folded_a: ["AS", "AD"],
        folded_b: ["KS", "KH"],
        active_c: ["QS", "QH"]
      },
      foldedByUserId: { folded_a: true, folded_b: true, active_c: false },
      leftTableByUserId: { folded_a: true, folded_b: true },
      stacks: { folded_a: 0, folded_b: 0, active_c: 90 },
      contributionsByUserId: { folded_a: 100, folded_b: 100, active_c: 10 },
      pot: 210
    };

    const { nextState } = awardPotsAtShowdown({
      state,
      seatUserIdsInOrder: ["folded_a", "folded_b", "active_c"],
      computeShowdown: () => ({ winners: ["active_c"] }),
      nowIso: "2026-07-15T00:00:00.000Z"
    });

    assert.equal(nextState.showdown.potAwardedTotal, 210);
    assert.deepEqual(nextState.showdown.potsAwarded, [
      { amount: 210, winners: ["active_c"], eligibleUserIds: ["active_c"] }
    ]);
    assert.deepEqual(nextState.stacks, { folded_a: 0, folded_b: 0, active_c: 300 });
    assert.equal(Object.values(nextState.stacks).reduce((total, stack) => total + stack, 0), 300);
  });

  test(`${label} settlement returns only a unique unmatched top contribution`, () => {
    const state = {
      phase: "RIVER",
      community: ["2H", "3D", "4S", "9C", "KD"],
      holeCardsByUserId: {
        folded_a: ["AS", "AD"],
        folded_b: ["KS", "KH"],
        active_c: ["QS", "QH"]
      },
      foldedByUserId: { folded_a: true, folded_b: true, active_c: false },
      leftTableByUserId: { folded_a: true, folded_b: true },
      stacks: { folded_a: 0, folded_b: 20, active_c: 90 },
      contributionsByUserId: { folded_a: 100, folded_b: 80, active_c: 10 },
      pot: 190
    };

    const { nextState } = awardPotsAtShowdown({
      state,
      seatUserIdsInOrder: ["folded_a", "folded_b", "active_c"],
      computeShowdown: () => ({ winners: ["active_c"] }),
      nowIso: "2026-07-15T00:00:00.000Z"
    });

    assert.equal(nextState.showdown.potAwardedTotal, 190);
    assert.deepEqual(nextState.showdown.winners, ["active_c"]);
    assert.deepEqual(nextState.showdown.potsAwarded, [
      { amount: 170, winners: ["active_c"], eligibleUserIds: ["active_c"] },
      { amount: 20, winners: ["folded_a"], eligibleUserIds: ["folded_a"] }
    ]);
    assert.deepEqual(nextState.stacks, { folded_a: 20, folded_b: 20, active_c: 260 });
    assert.equal(Object.values(nextState.stacks).reduce((total, stack) => total + stack, 0), 300);
  });

  test(`${label} settlement fails closed for a persisted pot without a legal recipient`, () => {
    const state = {
      phase: "RIVER",
      community: ["2H", "3D", "4S", "9C", "KD"],
      holeCardsByUserId: {
        player_a: ["AS", "AD"],
        player_b: ["KS", "KH"],
        folded_c: ["QS", "QH"]
      },
      foldedByUserId: { player_a: false, player_b: false, folded_c: true },
      stacks: { player_a: 90, player_b: 90, folded_c: 90 },
      sidePots: [{ amount: 30, eligibleUserIds: ["folded_c"] }],
      pot: 30
    };

    assert.throws(() => awardPotsAtShowdown({
      state,
      seatUserIdsInOrder: ["player_a", "player_b", "folded_c"],
      computeShowdown: () => ({ winners: ["player_a"] }),
      nowIso: "2026-07-15T00:00:00.000Z"
    }), /showdown_pot_without_eligible_player/);
  });
}
