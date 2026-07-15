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
}
