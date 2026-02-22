import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";
process.env.POKER_BOTS_MAX_ACTIONS_PER_REQUEST = "1";

const run = async () => {
  const stored = {
    version: 10,
    state: {
      tableId,
      phase: "PREFLOP",
      seats: [
        { userId: humanUserId, seatNo: 1 },
        { userId: botUserId, seatNo: 2 },
      ],
      stacks: { [humanUserId]: 100, [botUserId]: 100 },
      pot: 2,
      community: [],
      dealerSeatNo: 1,
      turnUserId: humanUserId,
      handId: "hand-version-source",
      handSeed: "seed-version-source",
      communityDealt: 0,
      toCallByUserId: { [humanUserId]: 0, [botUserId]: 0 },
      betThisRoundByUserId: { [humanUserId]: 1, [botUserId]: 1 },
      actedThisRoundByUserId: { [humanUserId]: false, [botUserId]: false },
      foldedByUserId: { [humanUserId]: false, [botUserId]: false },
      currentBet: 1,
      lastRaiseSize: 1,
      lastActionRequestIdByUserId: {},
    },
  };

  let optimisticBumps = 0;
  let sqlBumps = 0;
  let sawOptimisticConflictStop = false;
  const logs = [];

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: String(value || "") }),
    advanceIfNeeded: (state) => ({ state, events: [] }),
    applyAction: (state, action) => {
      const next = {
        ...state,
        actedThisRoundByUserId: { ...(state.actedThisRoundByUserId || {}) },
      };
      next.actedThisRoundByUserId[action.userId] = true;
      next.turnUserId = action.userId === humanUserId ? botUserId : humanUserId;
      return { state: next, events: [{ type: "ACTION_APPLIED" }] };
    },
    computeLegalActions: () => ({ actions: [{ type: "CHECK" }], minRaiseTo: null, maxRaiseTo: null }),
    buildActionConstraints: () => ({}),
    isStateStorageValid: () => true,
    normalizeJsonState: (state) => state,
    withoutPrivateState: (state) => state,
    resetTurnTimer: (state) => state,
    updatePokerStateOptimistic: async (_tx, args) => {
      optimisticBumps += 1;
      stored.state = args.nextState;
      stored.version = Number(args.expectedVersion) + 1;
      return { ok: true, newVersion: stored.version };
    },
    deriveCommunityCards: () => [],
    deriveRemainingDeck: () => [],
    maybeApplyTurnTimeout: ({ state }) => ({ applied: false, state, action: null, events: [] }),
    loadHoleCardsByUserId: async () => ({
      holeCardsByUserId: {
        [humanUserId]: [{ r: "A", s: "S" }, { r: "K", s: "S" }],
        [botUserId]: [{ r: "Q", s: "S" }, { r: "J", s: "S" }],
      },
      holeCardsStatusByUserId: {},
    }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2")) return [{ user_id: humanUserId }];
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) return [{ user_id: humanUserId, is_bot: false }, { user_id: botUserId, is_bot: true }];
          if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
          if (text.includes("from public.poker_requests")) return [];
          if (text.includes("insert into public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("update public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            sqlBumps += 1;
            stored.state = JSON.parse(params?.[2] || "{}");
            return [{ version: stored.version }];
          }
          if (text.includes("insert into public.poker_actions")) return [{ ok: true }];
          if (text.includes("update public.poker_tables set last_activity_at = now(), updated_at = now()")) return [];
          return [];
        },
      }),
    klog: (event, payload) => {
      logs.push({ event, payload });
      if (event === "poker_act_bot_autoplay_stop" && payload?.reason === "optimistic_conflict") sawOptimisticConflictStop = true;
    },
  });

  const beforeVersion = stored.version;
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "single-version-source", action: { type: "CHECK" } }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.ok, true);
  assert.equal(sqlBumps, 0);
  assert.ok(optimisticBumps > 0);
  assert.equal(stored.version, beforeVersion + optimisticBumps);
  assert.equal(sawOptimisticConflictStop, false);
};

run().then(() => console.log("poker-act version single-source-of-truth behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
