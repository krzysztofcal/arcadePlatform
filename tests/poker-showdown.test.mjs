import assert from "node:assert/strict";
import { computeShowdown } from "../netlify/functions/_shared/poker-showdown.mjs";

const c = (r, s) => ({ r, s });

const runSingleWinnerTest = () => {
  const community = [c("A", "S"), c("A", "D"), c("K", "C"), c("7", "H"), c("2", "D")];
  const result = computeShowdown({
    community,
    players: [
      { userId: "user-1", holeCards: [c("A", "H"), c("3", "C")] },
      { userId: "user-2", holeCards: [c("K", "S"), c("K", "D")] },
    ],
  });
  assert.equal(result.winners.length, 1);
  assert.equal(result.winners[0], "user-2");
};

const runTieTest = () => {
  const community = [c("9", "S"), c("8", "D"), c("7", "C"), c("6", "H"), c("5", "S")];
  const result = computeShowdown({
    community,
    players: [
      { userId: "user-1", holeCards: [c("A", "S"), c("K", "D")] },
      { userId: "user-2", holeCards: [c("Q", "H"), c("J", "H")] },
    ],
  });
  assert.equal(result.winners.length, 2);
  assert.ok(result.winners.includes("user-1"));
  assert.ok(result.winners.includes("user-2"));
};

const runBest5Test = () => {
  const community = [c("A", "S"), c("K", "S"), c("Q", "D"), c("9", "C"), c("2", "H")];
  const result = computeShowdown({
    community,
    players: [{ userId: "user-1", holeCards: [c("J", "S"), c("T", "S")] }],
  });
  assert.equal(result.handsByUserId["user-1"].best5.length, 5);
};

const runInvalidInputTest = () => {
  assert.throws(
    () => computeShowdown({ community: null, players: [] }),
    (err) => err && err.message === "invalid_state",
  );
  assert.throws(
    () =>
      computeShowdown({
        community: [c("A", "S"), c("K", "S"), c("Q", "D"), c("J", "C"), c("9", "H")],
        players: [{ userId: "user-1", holeCards: [] }],
      }),
    (err) => err && err.message === "invalid_state",
  );
};

runSingleWinnerTest();
runTieTest();
runBest5Test();
runInvalidInputTest();
