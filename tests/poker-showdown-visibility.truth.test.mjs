import assert from "node:assert/strict";
import { redactShowdownForViewer } from "../netlify/functions/_shared/poker-showdown-visibility.mjs";

const c = (r, s) => ({ r, s });

const buildState = () => ({
  phase: "SHOWDOWN",
  showdown: {
    winners: ["u1"],
    handsByUserId: {
      u1: { category: 1, name: "X", ranks: [], best5: [], key: "k" },
    },
    revealedHoleCardsByUserId: {
      u1: [c("A", "S"), c("K", "S")],
      u2: [c("Q", "H"), c("J", "H")],
    },
  },
});

const assertUnchanged = (state, snapshot) => {
  assert.deepEqual(state, snapshot);
};

const runNonSeatedViewerTest = () => {
  const state = buildState();
  const snapshot = JSON.parse(JSON.stringify(state));
  const out = redactShowdownForViewer(state, { viewerUserId: "u999", activeUserIds: ["u1", "u2"] });
  assert.deepEqual(out.showdown.revealedHoleCardsByUserId, {});
  assertUnchanged(state, snapshot);
};

const runBlankViewerTest = () => {
  const cases = [null, "", "   "];
  for (const viewerUserId of cases) {
    const state = buildState();
    const snapshot = JSON.parse(JSON.stringify(state));
    const out = redactShowdownForViewer(state, { viewerUserId, activeUserIds: ["u1", "u2"] });
    assert.deepEqual(out.showdown.revealedHoleCardsByUserId, {});
    assertUnchanged(state, snapshot);
  }
};

const runSeatedViewerTest = () => {
  const state = buildState();
  const snapshot = JSON.parse(JSON.stringify(state));
  const out = redactShowdownForViewer(state, { viewerUserId: "u1", activeUserIds: ["u1", "u2"] });
  assert.ok(out.showdown.revealedHoleCardsByUserId.u1);
  assert.ok(out.showdown.revealedHoleCardsByUserId.u2);
  assertUnchanged(state, snapshot);
};

const runInvalidActiveListTest = () => {
  const state = buildState();
  const snapshot = JSON.parse(JSON.stringify(state));
  const out = redactShowdownForViewer(state, { viewerUserId: "u1", activeUserIds: "u1" });
  assert.deepEqual(out.showdown.revealedHoleCardsByUserId, {});
  assertUnchanged(state, snapshot);
};

runNonSeatedViewerTest();
runBlankViewerTest();
runSeatedViewerTest();
runInvalidActiveListTest();
