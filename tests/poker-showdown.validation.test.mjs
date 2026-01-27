import assert from "node:assert/strict";
import { computeShowdown } from "../netlify/functions/_shared/poker-showdown.mjs";

const c = (r, s) => ({ r, s });

const runInvalidSuitTest = () => {
  const basePlayers = [
    { userId: "u1", holeCards: [c("A", "S"), c("K", "S")] },
    { userId: "u2", holeCards: [c("Q", "H"), c("J", "H")] },
  ];
  assert.throws(
    () =>
      computeShowdown({
        community: [c("2", "D"), c("3", "C"), c("4", "H"), c("5", "S"), c("6", "X")],
        players: basePlayers,
      }),
    (err) => err && err.message === "invalid_state",
  );

  assert.throws(
    () =>
      computeShowdown({
        community: [c("2", "D"), c("3", "C"), c("4", "H"), c("5", "S"), c("6", "S")],
        players: [
          { userId: "u1", holeCards: [c("A", "S"), c("K", "S")] },
          { userId: "u2", holeCards: [c("Q", "H"), c("J", "Z")] },
        ],
      }),
    (err) => err && err.message === "invalid_state",
  );
};

const runValidSmokeTest = () => {
  const result = computeShowdown({
    community: [c("2", "D"), c("3", "C"), c("4", "H"), c("5", "S"), c("6", "S")],
    players: [
      { userId: "u1", holeCards: [c("A", "S"), c("K", "S")] },
      { userId: "u2", holeCards: [c("Q", "H"), c("J", "H")] },
    ],
  });
  assert.ok(Array.isArray(result.winners));
  assert.ok(result.winners.length > 0);
};

runInvalidSuitTest();
runValidSmokeTest();
