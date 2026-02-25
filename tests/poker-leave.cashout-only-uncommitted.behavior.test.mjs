import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "77777777-7777-4777-8777-777777777777";
const userId = "99999999-9999-4999-8999-999999999999";

const storedRequests = new Map();
let postTransactionCalls = 0;
let cashoutAmount = 0;

const stored = {
  version: 1,
  state: {
    tableId,
    phase: "FLOP",
    handId: "hand-cashout",
    handSeed: "seed-cashout",
    communityDealt: 3,
    seats: [
      { userId, seatNo: 1 },
      { userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", seatNo: 2 },
    ],
    handSeats: [
      { userId, seatNo: 1 },
      { userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", seatNo: 2 },
    ],
    stacks: { [userId]: 100, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee": 100 },
    contributionsByUserId: { [userId]: 30, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee": 30 },
    pot: 60,
    turnUserId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    dealerSeatNo: 1,
    toCallByUserId: { [userId]: 0, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee": 0 },
    betThisRoundByUserId: { [userId]: 0, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee": 0 },
    actedThisRoundByUserId: { [userId]: false, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee": false },
    foldedByUserId: { [userId]: false, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee": false },
    leftTableByUserId: { [userId]: false, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee": false },
    sitOutByUserId: { [userId]: false, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee": false },
    pendingAutoSitOutByUserId: {},
    allInByUserId: { [userId]: false, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee": false },
    community: [{ r: "A", s: "S" }, { r: "K", s: "S" }, { r: "Q", s: "S" }],
    deck: [{ r: "2", s: "D" }],
  },
};

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId }),
  isValidUuid: () => true,
  normalizeRequestId: () => ({ ok: true, value: "leave-cashout-1" }),
  ensurePokerRequest: async (_tx, { requestId }) => {
    if (storedRequests.has(requestId)) return { status: "stored", result: storedRequests.get(requestId) };
    return { status: "proceed" };
  },
  storePokerRequestResult: async (_tx, { requestId, result }) => {
    storedRequests.set(requestId, result);
  },
  deletePokerRequest: async () => {},
  updatePokerStateOptimistic,
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
        if (text.includes("select user_id, seat_no, is_bot from public.poker_seats") && text.includes("status = 'active'")) {
          return [{ user_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", seat_no: 2, is_bot: false }];
        }
        return [];
      },
    }),
  postTransaction: async ({ entries }) => {
    postTransactionCalls += 1;
    cashoutAmount += Number(entries?.[1]?.amount || 0);
    return { transaction: { id: `tx-${postTransactionCalls}` } };
  },
  klog: () => {},
});

const body = JSON.stringify({ tableId, requestId: "leave-cashout-1" });
const first = await handler({ httpMethod: "POST", headers: { origin: "https://example.test", authorization: "Bearer token" }, body });
const second = await handler({ httpMethod: "POST", headers: { origin: "https://example.test", authorization: "Bearer token" }, body });

assert.equal(first.statusCode, 200);
assert.equal(second.statusCode, 200);
const firstPayload = JSON.parse(first.body || "{}");
const secondPayload = JSON.parse(second.body || "{}");
assert.equal(firstPayload.cashedOut, 100);
assert.equal(secondPayload.cashedOut, 100);
assert.equal(postTransactionCalls, 1);
assert.equal(cashoutAmount, 100);
assert.equal(stored.state.pot, 60);
assert.equal(stored.state.contributionsByUserId?.[userId], 30);

console.log("poker-leave cashout only uncommitted behavior test passed");
