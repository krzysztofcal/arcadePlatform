import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const stored = {
  version: 2,
  state: {
    tableId,
    phase: "PREFLOP",
    handId: "hand-mid",
    seats: [
      { userId: humanUserId, seatNo: 1 },
      { userId: botUserId, seatNo: 2 },
    ],
    stacks: { [humanUserId]: 100, [botUserId]: 100 },
    pot: 0,
    turnUserId: humanUserId,
    actedThisRoundByUserId: { [humanUserId]: false, [botUserId]: false },
    foldedByUserId: { [humanUserId]: false, [botUserId]: false },
    leftTableByUserId: { [humanUserId]: false, [botUserId]: false },
    sitOutByUserId: { [humanUserId]: false, [botUserId]: false },
    pendingAutoSitOutByUserId: {},
    toCallByUserId: { [humanUserId]: 0, [botUserId]: 0 },
    betThisRoundByUserId: { [humanUserId]: 0, [botUserId]: 0 },
    allInByUserId: { [humanUserId]: false, [botUserId]: false },
    contributionsByUserId: { [humanUserId]: 0, [botUserId]: 0 },
    deck: [{ r: "A", s: "S" }],
  },
};

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
  isValidUuid: () => true,
  normalizeRequestId: () => ({ ok: true, value: "leave-restore-stack" }),
  updatePokerStateOptimistic,
  ensurePokerRequest: async () => ({ status: "proceed" }),
  storePokerRequestResult: async () => {},
  deletePokerRequest: async () => {},
  applyLeaveTable: (state) => ({
    state: {
      ...state,
      leftTableByUserId: { ...(state.leftTableByUserId || {}), [humanUserId]: true },
      foldedByUserId: { ...(state.foldedByUserId || {}), [humanUserId]: true },
      actedThisRoundByUserId: { ...(state.actedThisRoundByUserId || {}), [humanUserId]: true },
      seats: state.seats,
      stacks: { [botUserId]: 100 },
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
        return [];
      },
    }),
  postTransaction: async () => ({ transaction: { id: "tx-1" } }),
  klog: () => {},
});

const response = await handler({
  httpMethod: "POST",
  headers: { origin: "https://example.test", authorization: "Bearer token" },
  body: JSON.stringify({ tableId, requestId: "leave-restore-stack", includeState: true }),
});

assert.equal(response.statusCode, 200);
const payload = JSON.parse(response.body || "{}");
assert.equal(payload.ok, true);
assert.equal(payload.state.state.seats.some((seat) => seat?.userId === humanUserId), true);
assert.equal(payload.state.state.stacks[humanUserId], 100);
assert.equal(payload.state.state.deck, undefined);

console.log("poker-leave mid-hand restores stack behavior test passed");
