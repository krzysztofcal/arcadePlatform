import assert from "node:assert/strict";
import { runBotAutoplayLoop } from "../netlify/functions/_shared/poker-autoplay.mjs";

const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let materializeCalls = 0;
let persistCalls = 0;

const initialState = {
  phase: "PREFLOP",
  handId: "hand-showdown",
  turnUserId: botUserId,
  seats: [{ userId: botUserId, seatNo: 2 }],
  foldedByUserId: { [botUserId]: false },
  leftTableByUserId: { [botUserId]: false },
  sitOutByUserId: { [botUserId]: false },
  pendingAutoSitOutByUserId: {},
  stacks: { [botUserId]: 100 },
  toCallByUserId: { [botUserId]: 0 },
  betThisRoundByUserId: { [botUserId]: 0 },
  actedThisRoundByUserId: { [botUserId]: false },
  allInByUserId: { [botUserId]: false },
  contributionsByUserId: { [botUserId]: 0 },
  currentBet: 0,
  lastRaiseSize: 0,
  community: [],
};

const result = await runBotAutoplayLoop({
  tableId: "t1",
  requestId: "req1",
  initialState,
  initialPrivateState: initialState,
  initialVersion: 1,
  seatBotMap: new Map([[botUserId, true]]),
  seatUserIdsInOrder: [botUserId],
  maxActions: 1,
  botsOnlyHandCompletionHardCap: 1,
  policyVersion: "test",
  klog: () => {},
  isActionPhase: (phase) => phase === "PREFLOP",
  advanceIfNeeded: (state) => ({ state, events: [] }),
  buildPersistedFromPrivateState: (state) => state,
  materializeShowdownState: (state) => {
    materializeCalls += 1;
    return { ...state, showdown: { handId: state.handId }, phase: "HAND_DONE", turnUserId: null };
  },
  persistStep: async ({ persistedState, privateState, loopVersion }) => {
    persistCalls += 1;
    return { ok: true, loopVersion: loopVersion + 1, responseFinalState: persistedState, loopPrivateState: privateState };
  },
});

assert.ok(materializeCalls >= 1);
assert.equal(persistCalls, 1);
assert.equal(result.responseFinalState.phase, "HAND_DONE");
console.log("poker-leave autoplay materializes showdown behavior test passed");
