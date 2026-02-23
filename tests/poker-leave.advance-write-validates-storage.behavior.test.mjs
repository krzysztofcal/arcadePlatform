import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "44444444-4444-4444-8444-444444444444";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const human2UserId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const stored = {
  version: 1,
  state: {
    tableId,
    phase: "FLOP",
    handId: "hand-validate",
    handSeed: "seed-4",
    communityDealt: 3,
    community: [{ r: "2", s: "H" }, { r: "3", s: "D" }, { r: "4", s: "C" }],
    seats: [{ userId, seatNo: 1 }, { userId: botUserId, seatNo: 2 }, { userId: human2UserId, seatNo: 3 }],
    stacks: { [userId]: 100, [botUserId]: 100, [human2UserId]: 100 },
    turnUserId: userId,
    toCallByUserId: { [userId]: 0, [botUserId]: 0, [human2UserId]: 0 },
    betThisRoundByUserId: { [userId]: 0, [botUserId]: 0, [human2UserId]: 0 },
    actedThisRoundByUserId: { [userId]: false, [botUserId]: false, [human2UserId]: false },
    foldedByUserId: { [userId]: false, [botUserId]: false, [human2UserId]: false },
    leftTableByUserId: { [userId]: false, [botUserId]: false, [human2UserId]: false },
    sitOutByUserId: { [userId]: false, [botUserId]: false, [human2UserId]: false },
    pendingAutoSitOutByUserId: {},
    allInByUserId: { [userId]: false, [botUserId]: false, [human2UserId]: false },
    contributionsByUserId: { [userId]: 0, [botUserId]: 0, [human2UserId]: 0 },
    currentBet: 0,
    lastRaiseSize: 0,
    pot: 0,
  },
};

let updateCount = 0;
const updatePokerStateOptimistic = async (_tx, { expectedVersion, nextState }) => {
  updateCount += 1;
  if (expectedVersion !== stored.version) return { ok: false, reason: "conflict" };
  stored.version += 1;
  stored.state = JSON.parse(JSON.stringify(nextState));
  return { ok: true, newVersion: stored.version };
};

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId }),
  isValidUuid: () => true,
  normalizeRequestId: () => ({ ok: true, value: "leave-validate" }),
  ensurePokerRequest: async () => ({ status: "proceed" }),
  updatePokerStateOptimistic,
  isStateStorageValid: (state) => !state?.deck && Number(state?.communityDealt) === (Array.isArray(state?.community) ? state.community.length : -1),
  advanceIfNeeded: (state) => ({ state: { ...state, communityDealt: 5 }, events: [{ type: "ADVANCED" }] }),
  TURN_MS: 15000,
  resetTurnTimer: (state) => state,
  runBotAutoplayLoop: async () => ({ responseFinalState: stored.state, loopPrivateState: stored.state, loopVersion: stored.version, botActionCount: 0, botStopReason: "non_action_phase", responseEvents: [] }),
  storePokerRequestResult: async () => {},
  deletePokerRequest: async () => {},
  beginSql: async (fn) =>
    fn({
      unsafe: async (query) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
        if (text.includes("from public.poker_seats") && text.includes("for update")) return [{ seat_no: 1, status: "ACTIVE", stack: 100 }];
        if (text.includes("from public.poker_seats") && text.includes("is_bot")) return [{ user_id: userId, seat_no: 1, is_bot: false }, { user_id: botUserId, seat_no: 2, is_bot: true }, { user_id: human2UserId, seat_no: 3, is_bot: false }];
        return [];
      },
    }),
  postTransaction: async () => ({ transaction: { id: "tx-1" } }),
  klog: () => {},
});

const response = await handler({ httpMethod: "POST", headers: { origin: "https://example.test" }, body: JSON.stringify({ tableId, requestId: "leave-validate", includeState: true }) });
assert.equal(response.statusCode, 409);
const payload = JSON.parse(response.body || "{}");
assert.equal(payload.error, "state_invalid");
assert.equal(updateCount, 1);
console.log("poker-leave advance write validates storage behavior test passed");
