import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const leavingUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const human2UserId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const stored = {
  version: 7,
  state: {
    tableId,
    phase: "PREFLOP",
    handId: "hand-1",
    handSeed: "seed-1",
    communityDealt: 0,
    seats: [
      { userId: leavingUserId, seatNo: 1 },
      { userId: botUserId, seatNo: 2 },
      { userId: human2UserId, seatNo: 3 },
    ],
    stacks: { [leavingUserId]: 100, [botUserId]: 100, [human2UserId]: 100 },
    turnUserId: leavingUserId,
    toCallByUserId: { [leavingUserId]: 0, [botUserId]: 0, [human2UserId]: 0 },
    betThisRoundByUserId: { [leavingUserId]: 0, [botUserId]: 0, [human2UserId]: 0 },
    actedThisRoundByUserId: { [leavingUserId]: false, [botUserId]: false, [human2UserId]: false },
    foldedByUserId: { [leavingUserId]: false, [botUserId]: false, [human2UserId]: false },
    leftTableByUserId: { [leavingUserId]: false, [botUserId]: false, [human2UserId]: false },
    sitOutByUserId: { [leavingUserId]: false, [botUserId]: false, [human2UserId]: false },
    pendingAutoSitOutByUserId: {},
    allInByUserId: { [leavingUserId]: false, [botUserId]: false, [human2UserId]: false },
    contributionsByUserId: { [leavingUserId]: 0, [botUserId]: 0, [human2UserId]: 0 },
    currentBet: 0,
    lastRaiseSize: 0,
    community: [],
    pot: 0,
  },
};

const persistedStates = [];
const updatePokerStateOptimistic = async (_tx, { expectedVersion, nextState }) => {
  assert.equal(typeof nextState.deck, "undefined");
  persistedStates.push(JSON.parse(JSON.stringify(nextState)));
  if (expectedVersion !== stored.version) return { ok: false, reason: "conflict" };
  stored.version += 1;
  stored.state = JSON.parse(JSON.stringify(nextState));
  return { ok: true, newVersion: stored.version };
};

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId: leavingUserId }),
  isValidUuid: () => true,
  normalizeRequestId: () => ({ ok: true, value: "leave-adv-1" }),
  ensurePokerRequest: async () => ({ status: "proceed" }),
  updatePokerStateOptimistic,
  isStateStorageValid: (state) => !state?.deck,
  advanceIfNeeded: (state) => ({ state, events: [] }),
  TURN_MS: 15000,
  resetTurnTimer: (state) => state,
  storePokerRequestResult: async () => {},
  deletePokerRequest: async () => {},
  runBotAutoplayLoop: async ({ initialState, initialVersion, persistStep }) => {
    const botState = {
      ...initialState,
      turnUserId: human2UserId,
      actedThisRoundByUserId: { ...initialState.actedThisRoundByUserId, [botUserId]: true },
    };
    const persistResult = await persistStep({
      botTurnUserId: botUserId,
      botAction: { type: "CHECK" },
      botRequestId: "bot:leave-adv-1:1",
      fromState: initialState,
      persistedState: botState,
      privateState: botState,
      loopVersion: initialVersion,
    });
    return {
      responseFinalState: botState,
      loopPrivateState: botState,
      loopVersion: persistResult.loopVersion,
      botActionCount: 1,
      botStopReason: "turn_not_bot",
      responseEvents: [],
    };
  },
  beginSql: async (fn) =>
    fn({
      unsafe: async (query) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
        if (text.includes("from public.poker_seats") && text.includes("for update")) return [{ seat_no: 1, status: "ACTIVE", stack: 100 }];
        if (text.includes("from public.poker_seats") && text.includes("is_bot")) {
          return [
            { user_id: leavingUserId, seat_no: 1, is_bot: false },
            { user_id: botUserId, seat_no: 2, is_bot: true },
            { user_id: human2UserId, seat_no: 3, is_bot: false },
          ];
        }
        return [];
      },
    }),
  postTransaction: async () => ({ transaction: { id: "tx-1" } }),
  klog: () => {},
});

const res = await handler({ httpMethod: "POST", headers: { origin: "https://example.test" }, body: JSON.stringify({ tableId, requestId: "leave-adv-1", includeState: true }) });
assert.equal(res.statusCode, 200);
const payload = JSON.parse(res.body || "{}");
assert.equal(payload.ok, true);
assert.notEqual(payload.state.state.turnUserId, leavingUserId);
assert.equal(payload.state.state.leftTableByUserId[leavingUserId], true);
assert.ok(persistedStates.length >= 1);
assert.ok(persistedStates.every((state) => state.deck === undefined));
console.log("poker-leave advances turn when leaver was turn behavior test passed");
