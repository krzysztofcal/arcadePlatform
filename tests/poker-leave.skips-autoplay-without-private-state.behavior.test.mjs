import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "77777777-7777-4777-8777-777777777777";
const leavingUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const stored = {
  version: 1,
  state: {
    tableId,
    phase: "TURN",
    handId: "hand-skip-autoplay",
    handSeed: "seed-7",
    communityDealt: 4,
    community: [{ r: "2", s: "H" }, { r: "3", s: "D" }, { r: "4", s: "C" }, { r: "5", s: "S" }],
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

let writes = 0;
const updatePokerStateOptimistic = async (_tx, { expectedVersion, nextState }) => {
  if (expectedVersion !== stored.version) return { ok: false, reason: "conflict" };
  writes += 1;
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
  normalizeRequestId: () => ({ ok: true, value: "leave-skip-autoplay" }),
  ensurePokerRequest: async () => ({ status: "proceed" }),
  updatePokerStateOptimistic,
  isStateStorageValid: (state) => !state?.deck && !state?.holeCardsByUserId,
  advanceIfNeeded: (state) => ({ state, events: [] }),
  runBotAutoplayLoop: async () => {
    throw new Error("autoplay_should_not_run");
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
  body: JSON.stringify({ tableId, requestId: "leave-skip-autoplay", includeState: true }),
});

assert.equal(response.statusCode, 200);
const payload = JSON.parse(response.body || "{}");
assert.equal(payload.ok, true);
assert.equal(payload.status, "leave_queued");
assert.ok(writes >= 1);
assert.doesNotMatch(response.body || "", /autoplay_should_not_run/);

console.log("poker-leave skips autoplay without private state behavior test passed");
