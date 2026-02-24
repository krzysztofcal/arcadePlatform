import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "12121212-1212-4212-8212-121212121212";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bot1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bot2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const stored = {
  version: 3,
  state: {
    tableId,
    phase: "TURN",
    handId: "hand-seat-order",
    handSeed: "seed-seat-order",
    communityDealt: 3,
    community: [{ r: "2", s: "H" }, { r: "3", s: "D" }, { r: "4", s: "C" }],
    seats: [{ userId: humanUserId, seatNo: 1 }, { userId: bot1, seatNo: 2 }, { userId: bot2, seatNo: 3 }],
    stacks: { [humanUserId]: 100, [bot1]: 100, [bot2]: 100 },
    turnUserId: humanUserId,
    toCallByUserId: { [humanUserId]: 0, [bot1]: 0, [bot2]: 0 },
    betThisRoundByUserId: { [humanUserId]: 0, [bot1]: 0, [bot2]: 0 },
    actedThisRoundByUserId: { [humanUserId]: false, [bot1]: false, [bot2]: false },
    foldedByUserId: { [humanUserId]: false, [bot1]: false, [bot2]: false },
    leftTableByUserId: { [humanUserId]: false, [bot1]: false, [bot2]: false },
    sitOutByUserId: { [humanUserId]: false, [bot1]: false, [bot2]: false },
    pendingAutoSitOutByUserId: {},
    allInByUserId: { [humanUserId]: false, [bot1]: false, [bot2]: false },
    contributionsByUserId: { [humanUserId]: 0, [bot1]: 0, [bot2]: 0 },
    currentBet: 0,
    lastRaiseSize: 0,
    pot: 0,
  },
};

let botLoopRuns = 0;
const actionRequestIds = [];

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
  isValidUuid: () => true,
  normalizeRequestId: () => ({ ok: true, value: "leave-seat-order" }),
  ensurePokerRequest: async () => ({ status: "proceed" }),
  storePokerRequestResult: async () => {},
  deletePokerRequest: async () => {},
  isStateStorageValid: (state) => !state?.deck && !state?.holeCardsByUserId,
  deriveCommunityCards: ({ communityDealt }) => Array.from({ length: communityDealt }, (_v, i) => ({ r: "2", s: ["H", "D", "C", "S"][i] || "H" })),
  deriveRemainingDeck: () => [],
  applyLeaveTable: (state) => ({
    state: {
      ...state,
      turnUserId: humanUserId,
      foldedByUserId: { ...(state.foldedByUserId || {}), [humanUserId]: true },
      leftTableByUserId: { ...(state.leftTableByUserId || {}), [humanUserId]: true },
      actedThisRoundByUserId: { ...(state.actedThisRoundByUserId || {}), [humanUserId]: true },
    },
  }),
  updatePokerStateOptimistic: async (_tx, { expectedVersion, nextState }) => {
    if (expectedVersion !== stored.version) return { ok: false, reason: "conflict" };
    stored.version += 1;
    stored.state = JSON.parse(JSON.stringify(nextState));
    return { ok: true, newVersion: stored.version };
  },
  runBotAutoplayLoop: async ({ requestId, initialVersion, persistStep, initialState }) => {
    botLoopRuns += 1;
    const nextState = { ...initialState, phase: "HAND_DONE", turnUserId: null };
    const persisted = await persistStep({
      botTurnUserId: bot1,
      botAction: { type: "CHECK" },
      botRequestId: `bot:${requestId}:1`,
      fromState: initialState,
      persistedState: nextState,
      privateState: nextState,
      loopVersion: initialVersion,
    });
    return { responseFinalState: nextState, loopPrivateState: nextState, loopVersion: persisted.loopVersion, botActionCount: 1, botStopReason: "non_action_phase", responseEvents: [] };
  },
  beginSql: async (fn) =>
    fn({
      unsafe: async (query, params) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
        if (text.includes("from public.poker_seats") && text.includes("and user_id") && text.includes("for update")) return [{ seat_no: 1, status: "ACTIVE", stack: 100 }];
        if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) {
          return [
            { user_id: bot1, seat_no: 2, is_bot: true },
            { user_id: bot2, seat_no: 3, is_bot: true },
          ];
        }
        if (text.includes("from public.poker_hole_cards")) {
          return [
            { user_id: bot1, cards: [{ r: "A", s: "S" }, { r: "A", s: "H" }] },
            { user_id: bot2, cards: [{ r: "K", s: "S" }, { r: "K", s: "H" }] },
          ];
        }
        if (text.includes("insert into public.poker_actions")) {
          actionRequestIds.push(params?.[6]);
          return [];
        }
        return [];
      },
    }),
  postTransaction: async () => ({ transaction: { id: "tx-1" } }),
  klog: () => {},
});

const response = await handler({
  httpMethod: "POST",
  headers: { origin: "https://example.test" },
  body: JSON.stringify({ tableId, requestId: "leave-seat-order", includeState: true }),
});

assert.equal(response.statusCode, 200);
const payload = JSON.parse(response.body || "{}");
assert.equal(payload.ok, true);
assert.equal(botLoopRuns, 1);
assert.ok(payload.state?.version > 3);
assert.equal(payload.state?.state?.deck, undefined);
assert.equal(payload.state?.state?.holeCardsByUserId, undefined);
assert.equal(actionRequestIds.length, 1);

console.log("poker-leave post-leave bot loop seat order from active seats behavior test passed");
