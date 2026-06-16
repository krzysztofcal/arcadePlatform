import assert from "node:assert/strict";
import { awardPotsAtShowdown } from "../netlify/functions/_shared/poker-payout.mjs";

const seatUserIdsInOrder = ["A", "B", "C"];
const community = [
  { r: "2", s: "H" },
  { r: "3", s: "D" },
  { r: "4", s: "S" },
  { r: "5", s: "C" },
  { r: "6", s: "H" },
];

const holeCardsByUserId = {
  A: [{ r: "A", s: "H" }, { r: "A", s: "D" }],
  B: [{ r: "K", s: "H" }, { r: "K", s: "D" }],
  C: [{ r: "Q", s: "H" }, { r: "Q", s: "D" }],
};

const baseState = {
  phase: "SHOWDOWN",
  community,
  holeCardsByUserId,
  foldedByUserId: { A: false, B: false, C: false },
  stacks: { A: 0, B: 0, C: 0 },
  pot: 0,
};

const runSinglePotWinnerTest = () => {
  const state = { ...baseState, pot: 100 };
  const computeShowdown = ({ players }) => ({ winners: players.some((p) => p.userId === "A") ? ["A"] : [] });
  const { nextState } = awardPotsAtShowdown({ state, seatUserIdsInOrder, computeShowdown });
  assert.equal(nextState.pot, 0);
  assert.equal(nextState.stacks.A, 100);
  assert.equal(nextState.stacks.B, 0);
  assert.equal(nextState.stacks.C, 0);
  assert.equal(nextState.showdown.potAwardedTotal, 100);
};

const runSplitPotRemainderTest = () => {
  const state = { ...baseState, pot: 5 };
  const computeShowdown = () => ({ winners: ["A", "B"] });
  const { nextState } = awardPotsAtShowdown({ state, seatUserIdsInOrder, computeShowdown });
  assert.equal(nextState.stacks.A, 3);
  assert.equal(nextState.stacks.B, 2);
  assert.equal(nextState.stacks.C, 0);
};

const runExplicitSidePotsTest = () => {
  const state = {
    ...baseState,
    sidePots: [
      { amount: 60, eligibleUserIds: ["A", "B", "C"] },
      { amount: 40, eligibleUserIds: ["A", "B"] },
    ],
  };
  const computeShowdown = ({ players }) => {
    const ids = players.map((player) => player.userId);
    if (ids.length === 3) return { winners: ["C"] };
    return { winners: ["A"] };
  };
  const { nextState } = awardPotsAtShowdown({ state, seatUserIdsInOrder, computeShowdown });
  assert.equal(nextState.stacks.A, 40);
  assert.equal(nextState.stacks.B, 0);
  assert.equal(nextState.stacks.C, 60);
  assert.equal(nextState.showdown.potsAwarded.length, 2);
};

const runContributionsSidePotsTest = () => {
  const state = {
    ...baseState,
    contributionsByUserId: { A: 100, B: 50, C: 20 },
  };
  const computeShowdown = ({ players }) => {
    const ids = players.map((player) => player.userId);
    if (ids.length === 3) return { winners: ["C"] };
    if (ids.length === 2) return { winners: ["B"] };
    return { winners: ["A"] };
  };
  const { nextState } = awardPotsAtShowdown({ state, seatUserIdsInOrder, computeShowdown });
  assert.equal(nextState.stacks.A, 50);
  assert.equal(nextState.stacks.B, 60);
  assert.equal(nextState.stacks.C, 60);
  assert.equal(nextState.showdown.potsAwarded.length, 3);
};

const runFoldedPlayersExcludedTest = () => {
  const state = {
    ...baseState,
    foldedByUserId: { A: false, B: false, C: true },
    sidePots: [{ amount: 30, eligibleUserIds: ["A", "B", "C"] }],
  };
  const computeShowdown = ({ players }) => ({ winners: players.map((player) => player.userId) });
  const { nextState } = awardPotsAtShowdown({ state, seatUserIdsInOrder, computeShowdown });
  assert.equal(nextState.stacks.C, 0);
  assert.ok(nextState.showdown.winners.includes("A"));
  assert.ok(nextState.showdown.winners.includes("B"));
  assert.equal(nextState.showdown.winners.includes("C"), false);
};

runSinglePotWinnerTest();
runSplitPotRemainderTest();
runExplicitSidePotsTest();
runContributionsSidePotsTest();
runFoldedPlayersExcludedTest();
