import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const thirdUserId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const stored = {
  version: 4,
  state: {
    tableId,
    phase: "PREFLOP",
    seats: [
      { userId: humanUserId, seatNo: 1 },
      { userId: botUserId, seatNo: 2 },
      { userId: thirdUserId, seatNo: 3 },
    ],
    stacks: { [humanUserId]: 100, [botUserId]: 100, [thirdUserId]: 100 },
    pot: 0,
    turnUserId: botUserId,
    toCallByUserId: { [humanUserId]: 0, [botUserId]: 0, [thirdUserId]: 0 },
    betThisRoundByUserId: { [humanUserId]: 0, [botUserId]: 0, [thirdUserId]: 0 },
    actedThisRoundByUserId: { [humanUserId]: false, [botUserId]: false, [thirdUserId]: false },
    foldedByUserId: { [humanUserId]: false, [botUserId]: false, [thirdUserId]: false },
    leftTableByUserId: { [humanUserId]: false, [botUserId]: false, [thirdUserId]: false },
    sitOutByUserId: { [humanUserId]: false, [botUserId]: false, [thirdUserId]: false },
    pendingAutoSitOutByUserId: {},
    allInByUserId: { [humanUserId]: false, [botUserId]: false, [thirdUserId]: false },
    contributionsByUserId: { [humanUserId]: 0, [botUserId]: 0, [thirdUserId]: 0 },
    community: [],
    deck: [{ r: "A", s: "S" }, { r: "K", s: "H" }],
    currentBet: 0,
    lastRaiseSize: 0,
    dealerSeatNo: 1,
  },
};

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
  isValidUuid: () => true,
  normalizeRequestId: () => ({ ok: true, value: "leave-2" }),
  updatePokerStateOptimistic,
  ensurePokerRequest: async () => ({ status: "proceed" }),
  storePokerRequestResult: async () => {},
  deletePokerRequest: async () => {},
  beginSql: async (fn) =>
    fn({
      unsafe: async (query, params) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
        if (text.includes("from public.poker_seats") && text.includes("for update")) {
          return [{ seat_no: 1, status: "ACTIVE", stack: 100 }];
        }
        if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
          stored.state = JSON.parse(params?.[2] || "{}");
          stored.version += 1;
          return [{ version: stored.version }];
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
  body: JSON.stringify({ tableId, requestId: "leave-2" }),
});

assert.equal(response.statusCode, 200);
const payload = JSON.parse(response.body || "{}");
assert.equal(payload.ok, true);
assert.equal(payload.state.state.leftTableByUserId[humanUserId], true);
assert.equal(payload.state.state.foldedByUserId[humanUserId], true);
assert.equal(payload.state.state.actedThisRoundByUserId[humanUserId], true);
assert.equal(payload.state.state.turnUserId, botUserId);
assert.equal(payload.state.state.deck, undefined);

console.log("poker-leave out-of-turn behavior test passed");
