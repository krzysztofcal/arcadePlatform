import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "66666666-6666-4666-8666-666666666666";
const leavingUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const stored = {
  version: 9,
  state: {
    tableId,
    phase: "PREFLOP",
    handId: "hand-tdz",
    handSeed: "seed-tdz",
    communityDealt: 0,
    seats: [
      { userId: leavingUserId, seatNo: 1 },
      { userId: otherUserId, seatNo: 2 },
    ],
    stacks: { [leavingUserId]: 100, [otherUserId]: 100 },
    turnUserId: leavingUserId,
    toCallByUserId: { [leavingUserId]: 0, [otherUserId]: 0 },
    betThisRoundByUserId: { [leavingUserId]: 0, [otherUserId]: 0 },
    actedThisRoundByUserId: { [leavingUserId]: false, [otherUserId]: false },
    foldedByUserId: { [leavingUserId]: false, [otherUserId]: false },
    leftTableByUserId: { [leavingUserId]: false, [otherUserId]: false },
    sitOutByUserId: { [leavingUserId]: false, [otherUserId]: false },
    pendingAutoSitOutByUserId: {},
    allInByUserId: { [leavingUserId]: false, [otherUserId]: false },
    contributionsByUserId: { [leavingUserId]: 0, [otherUserId]: 0 },
    currentBet: 0,
    lastRaiseSize: 0,
    community: [],
    pot: 0,
  },
};

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId: leavingUserId }),
  isValidUuid: () => true,
  normalizeRequestId: () => ({ ok: true, value: "leave-tdz" }),
  ensurePokerRequest: async () => ({ status: "proceed" }),
  storePokerRequestResult: async () => {},
  deletePokerRequest: async () => {},
  isStateStorageValid: () => true,
  advanceIfNeeded: (state) => ({ state, events: [] }),
  updatePokerStateOptimistic: async (_tx, { expectedVersion, nextState }) => {
    if (expectedVersion !== stored.version) return { ok: false, reason: "conflict" };
    stored.version += 1;
    stored.state = JSON.parse(JSON.stringify(nextState));
    return { ok: true, newVersion: stored.version };
  },
  runBotAutoplayLoop: async ({ initialState, initialVersion }) => ({
    responseFinalState: initialState,
    loopPrivateState: initialState,
    loopVersion: initialVersion,
    botActionCount: 0,
    botStopReason: "turn_not_bot",
    responseEvents: [],
  }),
  beginSql: async (fn) =>
    fn({
      unsafe: async (query) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
        if (text.includes("from public.poker_seats") && text.includes("for update")) {
          return [{ seat_no: 1, status: "ACTIVE", stack: 100 }];
        }
        if (text.includes("from public.poker_seats") && text.includes("is_bot")) {
          return [
            { user_id: leavingUserId, seat_no: 1, is_bot: false },
            { user_id: otherUserId, seat_no: 2, is_bot: false },
          ];
        }
        return [];
      },
    }),
  postTransaction: async () => ({ transaction: { id: "tx-1" } }),
  klog: () => {},
});

const response = await handler({
  httpMethod: "POST",
  headers: { origin: "https://example.test", authorization: "Bearer token" },
  body: JSON.stringify({ tableId, requestId: "leave-tdz", includeState: true }),
});

assert.equal(response.statusCode, 200);
const payload = JSON.parse(response.body || "{}");
assert.equal(payload.ok, true);
assert.doesNotMatch(response.body || "", /Cannot access 'isActionPhase' before initialization/);

console.log("poker-leave validatePersistedState no TDZ behavior test passed");
