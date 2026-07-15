import assert from "node:assert/strict";
import { buildSidePots } from "../netlify/functions/_shared/poker-side-pots.mjs";

const runEmptyInputTest = () => {
  assert.deepEqual(buildSidePots({ contributionsByUserId: {}, eligibleUserIds: [] }), []);
  assert.deepEqual(buildSidePots({ contributionsByUserId: {}, eligibleUserIds: ["a"] }), []);
};

const runSinglePlayerTest = () => {
  const pots = buildSidePots({
    contributionsByUserId: { a: 50 },
    eligibleUserIds: ["a"],
  });
  assert.deepEqual(pots, [{
    amount: 50,
    eligibleUserIds: ["a"],
    minContribution: 0,
    maxContribution: 50,
  }]);
};

const runEveryoneEqualTest = () => {
  const pots = buildSidePots({
    contributionsByUserId: { a: 10, b: 10, c: 10 },
    eligibleUserIds: ["a", "b", "c"],
  });
  assert.deepEqual(pots, [{
    amount: 30,
    eligibleUserIds: ["a", "b", "c"],
    minContribution: 0,
    maxContribution: 10,
  }]);
};

const runTypicalSidePotsTest = () => {
  const pots = buildSidePots({
    contributionsByUserId: { A: 100, B: 50, C: 20 },
    eligibleUserIds: ["A", "B", "C"],
  });
  assert.deepEqual(pots, [
    {
      amount: 60,
      eligibleUserIds: ["A", "B", "C"],
      minContribution: 0,
      maxContribution: 20,
    },
    {
      amount: 60,
      eligibleUserIds: ["A", "B"],
      minContribution: 20,
      maxContribution: 50,
    },
    {
      amount: 50,
      eligibleUserIds: ["A"],
      minContribution: 50,
      maxContribution: 100,
      returnUserId: "A",
    },
  ]);
};

const runIgnoreNonEligibleTest = () => {
  const pots = buildSidePots({
    contributionsByUserId: { A: 40, B: 10, C: 999 },
    eligibleUserIds: ["A", "B"],
  });
  assert.deepEqual(pots, [
    {
      amount: 20,
      eligibleUserIds: ["A", "B"],
      minContribution: 0,
      maxContribution: 10,
    },
    {
      amount: 30,
      eligibleUserIds: ["A"],
      minContribution: 10,
      maxContribution: 40,
      returnUserId: "A",
    },
  ]);
};

const runStableOrderingTest = () => {
  const pots = buildSidePots({
    contributionsByUserId: { A: 100, B: 50, C: 20 },
    eligibleUserIds: ["B", "A", "C"],
  });
  assert.deepEqual(pots, [
    {
      amount: 60,
      eligibleUserIds: ["B", "A", "C"],
      minContribution: 0,
      maxContribution: 20,
    },
    {
      amount: 60,
      eligibleUserIds: ["B", "A"],
      minContribution: 20,
      maxContribution: 50,
    },
    {
      amount: 50,
      eligibleUserIds: ["A"],
      minContribution: 50,
      maxContribution: 100,
      returnUserId: "A",
    },
  ]);
};

const runInvalidContributionsTest = () => {
  const pots = buildSidePots({
    contributionsByUserId: { A: "10", B: Number.NaN, C: -5, D: 4.9 },
    eligibleUserIds: ["A", "B", "C", "D"],
  });
  assert.deepEqual(pots, [
    {
      amount: 8,
      eligibleUserIds: ["A", "D"],
      minContribution: 0,
      maxContribution: 4,
    },
    {
      amount: 6,
      eligibleUserIds: ["A"],
      minContribution: 4,
      maxContribution: 10,
      returnUserId: "A",
    },
  ]);
};

const runMatchedFoldedContributionsTest = () => {
  const pots = buildSidePots({
    contributionsByUserId: { folded_a: 100, folded_b: 100, active_c: 10 },
    participantUserIds: ["folded_a", "folded_b", "active_c"],
    eligibleUserIds: ["active_c"],
  });
  assert.deepEqual(pots, [{
    amount: 210,
    eligibleUserIds: ["active_c"],
    minContribution: 0,
    maxContribution: 100,
  }]);
};

const runUniqueUncalledExcessTest = () => {
  const pots = buildSidePots({
    contributionsByUserId: { folded_a: 100, folded_b: 80, active_c: 10 },
    participantUserIds: ["folded_a", "folded_b", "active_c"],
    eligibleUserIds: ["active_c"],
  });
  assert.deepEqual(pots, [
    {
      amount: 170,
      eligibleUserIds: ["active_c"],
      minContribution: 0,
      maxContribution: 80,
    },
    {
      amount: 20,
      eligibleUserIds: ["folded_a"],
      minContribution: 80,
      maxContribution: 100,
      returnUserId: "folded_a",
    },
  ]);
};

runEmptyInputTest();
runSinglePlayerTest();
runEveryoneEqualTest();
runTypicalSidePotsTest();
runIgnoreNonEligibleTest();
runStableOrderingTest();
runInvalidContributionsTest();
runMatchedFoldedContributionsTest();
runUniqueUncalledExcessTest();
