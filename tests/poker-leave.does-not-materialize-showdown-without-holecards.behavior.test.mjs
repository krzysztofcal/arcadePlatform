import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "88888888-8888-4888-8888-888888888888";
const leavingUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const stored = {
  version: 2,
  state: {
    tableId,
    phase: "RIVER",
    handId: "hand-no-showdown-materialize",
    handSeed: "seed-8",
    communityDealt: 5,
    community: [{ r: "2", s: "H" }, { r: "3", s: "D" }, { r: "4", s: "C" }, { r: "5", s: "S" }, { r: "6", s: "H" }],
    seats: [{ userId: leavingUserId, seatNo: 1 }, { userId: botUserId, seatNo: 2 }],
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
    pot: 0,
  },
};

let materializeCalled = 0;
const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId: leavingUserId }),
  isValidUuid: () => true,
  normalizeRequestId: () => ({ ok: true, value: "leave-no-showdown-mat" }),
  ensurePokerRequest: async () => ({ status: "proceed" }),
  isStateStorageValid: (state) => !state?.deck && !state?.holeCardsByUserId,
  updatePokerStateOptimistic: async (_tx, { expectedVersion, nextState }) => {
    if (expectedVersion !== stored.version) return { ok: false, reason: "conflict" };
    stored.version += 1;
    stored.state = JSON.parse(JSON.stringify(nextState));
    return { ok: true, newVersion: stored.version };
  },
  advanceIfNeeded: (state) => ({ state, events: [] }),
  materializeShowdownAndPayout: () => {
    materializeCalled += 1;
    throw new Error("materialize_should_not_run");
  },
  storePokerRequestResult: async () => {},
  deletePokerRequest: async () => {},
  beginSql: async (fn) =>
    fn({
      unsafe: async (query) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
        if (text.includes("from public.poker_seats") && text.includes("for update")) return [{ seat_no: 1, status: "ACTIVE", stack: 100 }];
        if (text.includes("from public.poker_seats") && text.includes("is_bot")) return [{ user_id: leavingUserId, seat_no: 1, is_bot: false }, { user_id: botUserId, seat_no: 2, is_bot: true }];
        return [];
      },
    }),
  postTransaction: async () => ({ transaction: { id: "tx-1" } }),
  klog: () => {},
});

const response = await handler({
  httpMethod: "POST",
  headers: { origin: "https://example.test" },
  body: JSON.stringify({ tableId, requestId: "leave-no-showdown-mat", includeState: true }),
});

assert.equal(response.statusCode, 200);
const payload = JSON.parse(response.body || "{}");
assert.equal(payload.ok, true);
assert.equal(payload.status, "leave_queued");
assert.equal(materializeCalled, 0);
assert.equal(payload.state.state.showdown, undefined);
assert.equal(payload.state.state.handSettlement, undefined);

console.log("poker-leave does not materialize showdown without holecards behavior test passed");
