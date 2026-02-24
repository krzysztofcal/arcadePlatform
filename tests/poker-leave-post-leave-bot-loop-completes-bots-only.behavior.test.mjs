import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "88888888-8888-4888-8888-888888888888";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bot1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bot2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const leaveRequestId = "leave-post-loop";

const stored = {
  version: 5,
  state: {
    tableId,
    phase: "TURN",
    handId: "hand-post-leave",
    handSeed: "seed-post-leave",
    communityDealt: 4,
    community: [{ r: "2", s: "H" }, { r: "3", s: "D" }, { r: "4", s: "C" }, { r: "5", s: "S" }],
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

const actionRequestIds = [];
let seenLoopRequestId = null;

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
  isValidUuid: () => true,
  normalizeRequestId: () => ({ ok: true, value: leaveRequestId }),
  ensurePokerRequest: async () => ({ status: "proceed" }),
  storePokerRequestResult: async () => {},
  deletePokerRequest: async () => {},
  isStateStorageValid: (state) => !state?.deck && !state?.holeCardsByUserId,
  deriveCommunityCards: ({ communityDealt }) => Array.from({ length: communityDealt }, (_v, i) => ({ r: "2", s: ["H", "D", "C", "S", "H"][i] || "H" })),
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
  runBotAutoplayLoop: async ({ requestId, initialState, initialVersion, persistStep }) => {
    seenLoopRequestId = requestId;
    const nextState = {
      ...initialState,
      phase: "HAND_DONE",
      turnUserId: null,
      actedThisRoundByUserId: { ...(initialState.actedThisRoundByUserId || {}), [bot1]: true },
    };
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
            { user_id: humanUserId, seat_no: 1, is_bot: false },
            { user_id: bot1, seat_no: 2, is_bot: true },
            { user_id: bot2, seat_no: 3, is_bot: true },
          ];
        }
        if (text.includes("from public.poker_hole_cards")) {
          return [
            { user_id: humanUserId, cards: [{ r: "Q", s: "S" }, { r: "Q", s: "H" }] },
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
  body: JSON.stringify({ tableId, requestId: leaveRequestId, includeState: true }),
});

assert.equal(response.statusCode, 200);
const payload = JSON.parse(response.body || "{}");
assert.equal(payload.ok, true);
assert.equal(seenLoopRequestId, `bot-auto:post-leave:${leaveRequestId}`);
assert.equal(payload.state?.state?.phase, "HAND_DONE");
assert.ok(payload.state?.version > 5);
assert.ok(actionRequestIds.some((id) => String(id).startsWith("bot:bot-auto:post-leave:")));

console.log("poker-leave post-leave bot loop completes bots-only behavior test passed");
