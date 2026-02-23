import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "13131313-1313-4131-8131-131313131313";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const stored = {
  version: 4,
  state: {
    tableId,
    phase: "TURN",
    handId: "hand-no-is-bot-query",
    handSeed: "seed-13",
    communityDealt: 4,
    community: [{ r: "2", s: "H" }, { r: "3", s: "D" }, { r: "4", s: "C" }, { r: "5", s: "S" }],
    seats: [{ userId, seatNo: 1 }, { userId: otherUserId, seatNo: 2 }],
    stacks: { [userId]: 100, [otherUserId]: 100 },
    turnUserId: userId,
    toCallByUserId: { [userId]: 0, [otherUserId]: 0 },
    betThisRoundByUserId: { [userId]: 0, [otherUserId]: 0 },
    actedThisRoundByUserId: { [userId]: false, [otherUserId]: false },
    foldedByUserId: { [userId]: false, [otherUserId]: false },
    leftTableByUserId: { [userId]: false, [otherUserId]: false },
    sitOutByUserId: { [userId]: false, [otherUserId]: false },
    pendingAutoSitOutByUserId: {},
    allInByUserId: { [userId]: false, [otherUserId]: false },
    contributionsByUserId: { [userId]: 0, [otherUserId]: 0 },
    currentBet: 0,
    lastRaiseSize: 0,
    pot: 0,
  },
};

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId }),
  isValidUuid: () => true,
  normalizeRequestId: () => ({ ok: true, value: "leave-no-is-bot-query" }),
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
  beginSql: async (fn) =>
    fn({
      unsafe: async (query) => {
        const text = String(query).toLowerCase();
        if (text.includes("coalesce(is_bot") || (text.includes("from public.poker_seats") && !text.includes("for update"))) {
          throw new Error("unexpected_is_bot_query");
        }
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
  body: JSON.stringify({ tableId, requestId: "leave-no-is-bot-query", includeState: true }),
});

assert.equal(response.statusCode, 200);
console.log("poker-leave leave-queued does not query is_bot behavior test passed");
