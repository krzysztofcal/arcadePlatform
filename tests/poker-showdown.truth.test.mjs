import assert from "node:assert/strict";
import { computeShowdown } from "../netlify/functions/_shared/poker-showdown.mjs";
import { c, showdownOracles } from "./helpers/poker-oracles.mjs";

const sortIds = (values) => (Array.isArray(values) ? values.slice().sort() : []);

const assertPlayerDetails = (result, userId) => {
  assert.ok(result.handsByUserId?.[userId]);
  assert.equal(Number.isInteger(result.handsByUserId[userId].category), true);
  assert.equal(typeof result.handsByUserId[userId].key, "string");
  assert.ok(result.handsByUserId[userId].key.trim());
  assert.equal(Array.isArray(result.handsByUserId[userId].best5), true);
  assert.equal(result.handsByUserId[userId].best5.length, 5);
  assert.equal(Array.isArray(result.revealedHoleCardsByUserId?.[userId]), true);
  assert.equal(result.revealedHoleCardsByUserId[userId].length, 2);
};

const runOracle = ({ name, community, players, winners }) => {
  const result = computeShowdown({ community, players });
  assert.deepEqual(sortIds(result.winners), sortIds(winners), `oracle:${name}`);
  winners.forEach((userId) => assertPlayerDetails(result, userId));
};

const runInvalidInputTests = () => {
  const base = {
    community: [c("A", "S"), c("K", "S"), c("Q", "D"), c("J", "C"), c("9", "H")],
    players: [{ userId: "u1", holeCards: [c("2", "H"), c("3", "D")] }],
  };

  assert.throws(
    () => computeShowdown({ ...base, community: null }),
    (err) => err && err.message === "invalid_state",
  );

  assert.throws(
    () => computeShowdown({ ...base, community: [c("A", "S")] }),
    (err) => err && err.message === "invalid_state",
  );

  assert.throws(
    () => computeShowdown({ ...base, players: [{ userId: "", holeCards: base.players[0].holeCards }] }),
    (err) => err && err.message === "invalid_state",
  );

  assert.throws(
    () => computeShowdown({ ...base, players: [{ userId: 123, holeCards: base.players[0].holeCards }] }),
    (err) => err && err.message === "invalid_state",
  );

  assert.throws(
    () => computeShowdown({ ...base, players: [{ userId: "u1", holeCards: [c("2", "H")] }] }),
    (err) => err && err.message === "invalid_state",
  );
};

showdownOracles.forEach(runOracle);
runInvalidInputTests();
