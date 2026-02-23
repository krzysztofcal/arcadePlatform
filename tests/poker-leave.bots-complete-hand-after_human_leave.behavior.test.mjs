import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "22222222-2222-4222-8222-222222222222";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bot1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bot2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const stored = {
  version: 2,
  state: {
    tableId,
    phase: "TURN",
    handId: "hand-bots-finish",
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
    community: [],
    deck: [{ r: "A", s: "S" }],
    pot: 0,
  },
};

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
  isValidUuid: () => true,
  normalizeRequestId: () => ({ ok: true, value: "leave-bots-done" }),
  ensurePokerRequest: async () => ({ status: "proceed" }),
  updatePokerStateOptimistic,
  isStateStorageValid: () => true,
  advanceIfNeeded: (state) => ({ state, events: [] }),
  TURN_MS: 15000,
  resetTurnTimer: (state) => state,
  storePokerRequestResult: async () => {},
  deletePokerRequest: async () => {},
  runBotAutoplayLoop: async ({ initialState, initialVersion, persistStep }) => {
    const done = { ...initialState, phase: "HAND_DONE", turnUserId: null };
    const persisted = await persistStep({
      botTurnUserId: bot1,
      botAction: { type: "CHECK" },
      botRequestId: "bot:leave-bots-done:1",
      fromState: initialState,
      persistedState: done,
      privateState: done,
      loopVersion: initialVersion,
    });
    return { responseFinalState: done, loopPrivateState: done, loopVersion: persisted.loopVersion, botActionCount: 1, botStopReason: "non_action_phase", responseEvents: [] };
  },
  beginSql: async (fn) =>
    fn({
      unsafe: async (query, params) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
        if (text.includes("from public.poker_seats") && text.includes("for update")) return [{ seat_no: 1, status: "ACTIVE", stack: 100 }];
        if (text.includes("from public.poker_seats") && text.includes("is_bot")) {
          return [
            { user_id: humanUserId, seat_no: 1, is_bot: false },
            { user_id: bot1, seat_no: 2, is_bot: true },
            { user_id: bot2, seat_no: 3, is_bot: true },
          ];
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

const res = await handler({ httpMethod: "POST", headers: { origin: "https://example.test" }, body: JSON.stringify({ tableId, requestId: "leave-bots-done", includeState: true }) });
assert.equal(res.statusCode, 200);
const payload = JSON.parse(res.body || "{}");
assert.equal(payload.state.state.phase, "HAND_DONE");
console.log("poker-leave bots complete hand after human leave behavior test passed");
