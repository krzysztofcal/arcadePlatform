import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { TURN_MS, advanceIfNeeded } from "../netlify/functions/_shared/poker-reducer.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { isStateStorageValid, normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";
process.env.POKER_BOT_MAX_ACTIONS_PER_REQUEST = "1";

const run = async () => {
  const stored = {
    version: 9,
    state: {
      tableId,
      phase: "RIVER",
      handId: "old-hand-0000-4000-8000-000000000001",
      handSeed: "old-seed-0000-4000-8000-000000000001",
      seats: [
        { userId: humanUserId, seatNo: 1 },
        { userId: botUserId, seatNo: 2 },
      ],
      stacks: { [humanUserId]: 100, [botUserId]: 100 },
      pot: 5,
      community: [],
      communityDealt: 0,
      dealerSeatNo: 1,
      turnUserId: humanUserId,
      toCallByUserId: { [humanUserId]: 0, [botUserId]: 0 },
      betThisRoundByUserId: { [humanUserId]: 0, [botUserId]: 0 },
      actedThisRoundByUserId: { [humanUserId]: false, [botUserId]: false },
      foldedByUserId: { [humanUserId]: false, [botUserId]: false },
      lastActionRequestIdByUserId: {},
      currentBet: 0,
      lastRaiseSize: 0,
    },
    requests: new Map(),
  };

  const botLoopCalls = [];

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: String(value || "") }),
    TURN_MS,
    advanceIfNeeded,
    computeLegalActions,
    buildActionConstraints,
    isStateStorageValid,
    normalizeJsonState,
    withoutPrivateState,
    resetTurnTimer,
    updatePokerStateOptimistic,
    deriveCommunityCards: () => [],
    deriveRemainingDeck: () => [],
    maybeApplyTurnTimeout: () => ({ applied: false }),
    applyAction: (state, action) => {
      if (action?.userId === humanUserId) {
        return { state: { ...state, phase: "HAND_DONE", turnUserId: null, pot: 0 }, events: [{ type: "HAND_SETTLED" }] };
      }
      return { state, events: [] };
    },
    runBotAutoplayLoop: async (args) => {
      botLoopCalls.push(args);
      if (args.requestId === "act-post-seed") {
        return {
          responseFinalState: args.initialState,
          responseEvents: [],
          loopPrivateState: args.initialPrivateState,
          loopVersion: args.initialVersion,
          botActionCount: 0,
          botStopReason: "not_bot_turn",
          lastBotActionSummary: null,
        };
      }
      assert.equal(args.requestId, "bot-auto:post-autostart:act-post-seed");
      assert.equal(args.initialState?.handId, "new-hand-0000-4000-8000-000000000001");
      assert.equal(args.initialVersion, 100);
      return {
        responseFinalState: {
          ...args.initialState,
          actedThisRoundByUserId: { ...(args.initialState?.actedThisRoundByUserId || {}), [botUserId]: true },
          turnUserId: humanUserId,
        },
        responseEvents: [{ type: "BOT_ACTED" }],
        loopPrivateState: args.initialPrivateState,
        loopVersion: args.initialVersion + 1,
        botActionCount: 1,
        botStopReason: "human_turn",
        lastBotActionSummary: { type: "CHECK", amount: null },
      };
    },
    startHandCore: async ({ currentState }) => ({
      updatedState: {
        ...currentState,
        phase: "PREFLOP",
        handId: "new-hand-0000-4000-8000-000000000001",
        handSeed: "new-seed-0000-4000-8000-000000000001",
        turnUserId: botUserId,
        community: [],
        communityDealt: 0,
      },
      privateState: {
        ...currentState,
        phase: "PREFLOP",
        handId: "new-hand-0000-4000-8000-000000000001",
        handSeed: "new-seed-0000-4000-8000-000000000001",
        turnUserId: botUserId,
        community: [],
        communityDealt: 0,
      },
      dealtHoleCards: {},
      newVersion: 100,
    }),
    loadHoleCardsByUserId: async () => ({ holeCardsByUserId: {} }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2")) return [{ user_id: humanUserId }];
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) {
            return [
              { user_id: humanUserId, seat_no: 1, is_bot: false },
              { user_id: botUserId, seat_no: 2, is_bot: true },
            ];
          }
          if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
          if (text.includes("from public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const row = stored.requests.get(key);
            return row ? [{ result_json: row.resultJson, created_at: row.createdAt }] : [];
          }
          if (text.includes("insert into public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            if (stored.requests.has(key)) return [];
            stored.requests.set(key, { resultJson: null, createdAt: new Date().toISOString() });
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("update public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const row = stored.requests.get(key) || { createdAt: new Date().toISOString() };
            row.resultJson = params?.[4] ?? null;
            stored.requests.set(key, row);
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            stored.state = JSON.parse(params?.[2] || "{}");
            stored.version += 1;
            return [{ version: stored.version }];
          }
          if (text.includes("insert into public.poker_actions")) return [{ ok: true }];
          if (text.includes("update public.poker_tables set last_activity_at")) return [];
          return [];
        },
      }),
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "act-post-seed", action: { type: "CHECK" } }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(botLoopCalls.length >= 2, true);
};

run().then(() => console.log("poker-act post-autostart bot loop seeds new hand behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
