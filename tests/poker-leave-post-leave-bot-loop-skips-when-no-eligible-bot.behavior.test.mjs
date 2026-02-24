import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "13131313-1313-4131-8131-131313131313";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bot1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bot2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const stored = {
  version: 4,
  state: {
    tableId,
    phase: "TURN",
    handId: "hand-no-eligible-bot",
    handSeed: "seed-no-eligible-bot",
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
    sitOutByUserId: { [humanUserId]: false, [bot1]: true, [bot2]: true },
    pendingAutoSitOutByUserId: {},
    allInByUserId: { [humanUserId]: false, [bot1]: false, [bot2]: false },
    contributionsByUserId: { [humanUserId]: 0, [bot1]: 0, [bot2]: 0 },
    currentBet: 0,
    lastRaiseSize: 0,
    pot: 0,
  },
};

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
  isValidUuid: () => true,
  normalizeRequestId: () => ({ ok: true, value: "leave-no-eligible-bot" }),
  ensurePokerRequest: async () => ({ status: "proceed" }),
  storePokerRequestResult: async () => {},
  deletePokerRequest: async () => {},
  isStateStorageValid: (state) => !state?.deck && !state?.holeCardsByUserId,
  applyLeaveTable: (state) => ({
    state: {
      ...state,
      turnUserId: humanUserId,
      foldedByUserId: { ...(state.foldedByUserId || {}), [humanUserId]: true },
      leftTableByUserId: { ...(state.leftTableByUserId || {}), [humanUserId]: true },
      actedThisRoundByUserId: { ...(state.actedThisRoundByUserId || {}), [humanUserId]: true },
      sitOutByUserId: { ...(state.sitOutByUserId || {}), [bot1]: true, [bot2]: true },
    },
  }),
  updatePokerStateOptimistic: async (_tx, { expectedVersion, nextState }) => {
    // allow initial leave write; block any bot-loop follow-up writes
    if (expectedVersion !== stored.version) {
      throw new Error("autoplay_update_should_not_run");
    }
    stored.version += 1;
    stored.state = JSON.parse(JSON.stringify(nextState));
    return { ok: true, newVersion: stored.version };
  },
  runBotAutoplayLoop: async () => {
    throw new Error("should_not_run");
  },
  beginSql: async (fn) =>
    fn({
      unsafe: async (query) => {
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
        if (text.includes("insert into public.poker_actions")) {
          throw new Error("autoplay_action_insert_should_not_run");
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
  body: JSON.stringify({ tableId, requestId: "leave-no-eligible-bot", includeState: true }),
});

assert.equal(response.statusCode, 200);
const payload = JSON.parse(response.body || "{}");
assert.equal(payload.ok, true);
assert.equal(payload.state?.state?.deck, undefined);
assert.equal(payload.state?.state?.holeCardsByUserId, undefined);

console.log("poker-leave post-leave bot loop skips when no eligible bot behavior test passed");
