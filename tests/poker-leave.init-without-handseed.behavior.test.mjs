import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "55555555-5555-4555-8555-555555555555";
const leavingUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const stored = {
  version: 4,
  state: {
    tableId,
    phase: "INIT",
    seats: [
      { userId: leavingUserId, seatNo: 1 },
      { userId: botUserId, seatNo: 2 },
    ],
    stacks: { [leavingUserId]: 100, [botUserId]: 100 },
    turnUserId: leavingUserId,
    toCallByUserId: { [leavingUserId]: 0, [botUserId]: 0 },
    betThisRoundByUserId: { [leavingUserId]: 0, [botUserId]: 0 },
    actedThisRoundByUserId: { [leavingUserId]: false, [botUserId]: false },
    foldedByUserId: { [leavingUserId]: false, [botUserId]: false },
    leftTableByUserId: { [leavingUserId]: false, [botUserId]: false },
    sitOutByUserId: { [leavingUserId]: false, [botUserId]: false },
    pendingAutoSitOutByUserId: {},
    allInByUserId: { [leavingUserId]: false, [botUserId]: false },
    contributionsByUserId: { [leavingUserId]: 0, [botUserId]: 0 },
    currentBet: 0,
    lastRaiseSize: 0,
    community: [],
    pot: 0,
  },
};

const persistedStates = [];
const updatePokerStateOptimistic = async (_tx, { expectedVersion, nextState }) => {
  if (expectedVersion !== stored.version) return { ok: false, reason: "conflict" };
  persistedStates.push(JSON.parse(JSON.stringify(nextState)));
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
  normalizeRequestId: () => ({ ok: true, value: "leave-init-no-seed" }),
  ensurePokerRequest: async () => ({ status: "proceed" }),
  updatePokerStateOptimistic,
  isStateStorageValid: (state, opts = {}) => {
    if (state?.deck) return false;
    if (state?.holeCardsByUserId) return false;
    if (opts.requireHandSeed && !(typeof state?.handSeed === "string" && state.handSeed.trim())) return false;
    if (opts.requireCommunityDealt && !Number.isInteger(state?.communityDealt)) return false;
    return true;
  },
  advanceIfNeeded: (state) => ({ state, events: [] }),
  TURN_MS: 15000,
  resetTurnTimer: (state) => state,
  runBotAutoplayLoop: async ({ initialState, initialVersion }) => ({
    responseFinalState: initialState,
    loopPrivateState: initialState,
    loopVersion: initialVersion,
    botActionCount: 0,
    botStopReason: "non_action_phase",
    responseEvents: [],
  }),
  storePokerRequestResult: async () => {},
  deletePokerRequest: async () => {},
  beginSql: async (fn) =>
    fn({
      unsafe: async (query) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
        if (text.includes("from public.poker_seats") && text.includes("for update")) return [{ seat_no: 1, status: "ACTIVE", stack: 100 }];
        return [];
      },
    }),
  postTransaction: async () => ({ transaction: { id: "tx-1" } }),
  klog: () => {},
});

const response = await handler({
  httpMethod: "POST",
  headers: { origin: "https://example.test", authorization: "Bearer token" },
  body: JSON.stringify({ tableId, requestId: "leave-init-no-seed", includeState: true }),
});

assert.equal(response.statusCode, 200);
const payload = JSON.parse(response.body || "{}");
assert.equal(payload.ok, true);
assert.ok(persistedStates.length >= 1);
assert.ok(persistedStates.every((state) => state.deck === undefined));
assert.ok(persistedStates.every((state) => state.holeCardsByUserId === undefined));
assert.equal(payload.state.state.leftTableByUserId[leavingUserId], true);

console.log("poker-leave init without handseed behavior test passed");
