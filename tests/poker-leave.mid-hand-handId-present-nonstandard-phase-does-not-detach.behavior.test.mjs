import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let seatDeleteCount = 0;

const stored = {
  version: 11,
  state: {
    tableId,
    phase: "BETTING",
    handId: "hand-1",
    seats: [
      { userId: humanUserId, seatNo: 1 },
      { userId: botUserId, seatNo: 2 },
    ],
    stacks: { [humanUserId]: 100, [botUserId]: 100 },
    pot: 0,
    turnUserId: humanUserId,
    toCallByUserId: { [humanUserId]: 0, [botUserId]: 0 },
    betThisRoundByUserId: { [humanUserId]: 0, [botUserId]: 0 },
    actedThisRoundByUserId: { [humanUserId]: false, [botUserId]: false },
    foldedByUserId: { [humanUserId]: false, [botUserId]: false },
    leftTableByUserId: { [humanUserId]: false, [botUserId]: false },
    sitOutByUserId: { [humanUserId]: false, [botUserId]: false },
    pendingAutoSitOutByUserId: {},
    allInByUserId: { [humanUserId]: false, [botUserId]: false },
    contributionsByUserId: { [humanUserId]: 0, [botUserId]: 0 },
    community: [],
    deck: [{ r: "A", s: "S" }],
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
  normalizeRequestId: () => ({ ok: true, value: "leave-nonstandard-phase" }),
  updatePokerStateOptimistic,
  ensurePokerRequest: async () => ({ status: "proceed" }),
  storePokerRequestResult: async () => {},
  deletePokerRequest: async () => {},
  applyLeaveTable: (state) => ({
    state: {
      ...state,
      phase: "BETTING",
      handId: "hand-1",
      leftTableByUserId: { ...(state.leftTableByUserId || {}), [humanUserId]: true },
      seats: state.seats,
      stacks: state.stacks,
      deck: state.deck,
    },
    events: [],
  }),
  beginSql: async (fn) =>
    fn({
      unsafe: async (query, params) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
        if (text.includes("from public.poker_seats") && text.includes("for update")) return [{ seat_no: 1, status: "ACTIVE", stack: 100 }];
        if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
          stored.state = JSON.parse(params?.[2] || "{}");
          stored.version += 1;
          return [{ version: stored.version }];
        }
        if (text.includes("delete from public.poker_seats")) {
          seatDeleteCount += 1;
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
  headers: { origin: "https://example.test", authorization: "Bearer token" },
  body: JSON.stringify({ tableId, requestId: "leave-nonstandard-phase", includeState: true }),
});

assert.equal(response.statusCode, 200);
const payload = JSON.parse(response.body || "{}");
assert.equal(payload.ok, true);
assert.equal(seatDeleteCount, 0);
assert.equal(payload.state.state.seats.some((seat) => seat?.userId === humanUserId), true);
assert.equal(payload.state.state.stacks?.[humanUserId], 100);
assert.equal(payload.state.state.deck, undefined);

console.log("poker-leave handId with nonstandard phase does not detach behavior test passed");
