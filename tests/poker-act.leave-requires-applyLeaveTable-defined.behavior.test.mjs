import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { TURN_MS, advanceIfNeeded, applyAction } from "../netlify/functions/_shared/poker-reducer.mjs";
import { buildActionConstraints } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { isStateStorageValid, normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const stored = {
  version: 2,
  requests: new Map(),
  state: {
    phase: "PREFLOP",
    seats: [
      { userId: humanUserId, seatNo: 1 },
      { userId: botUserId, seatNo: 2 },
    ],
    stacks: { [humanUserId]: 100, [botUserId]: 100 },
    pot: 0,
    community: [],
    dealerSeatNo: 1,
    turnUserId: botUserId,
    handId: "hand-leave-defined",
    handSeed: "seed-leave-defined",
    communityDealt: 0,
    toCallByUserId: { [humanUserId]: 0, [botUserId]: 0 },
    betThisRoundByUserId: { [humanUserId]: 0, [botUserId]: 0 },
    actedThisRoundByUserId: { [humanUserId]: false, [botUserId]: false },
    foldedByUserId: { [humanUserId]: false, [botUserId]: false },
    leftTableByUserId: { [humanUserId]: false, [botUserId]: false },
    sitOutByUserId: { [humanUserId]: false, [botUserId]: false },
    pendingAutoSitOutByUserId: {},
    currentBet: 0,
    lastRaiseSize: 0,
    lastActionRequestIdByUserId: {},
  },
};

const keyFor = (params) => `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;

const run = async () => {
  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: String(value || "") }),
    TURN_MS,
    advanceIfNeeded,
    applyAction,
    computeLegalActions: () => ({ actions: ["CHECK"] }),
    buildActionConstraints,
    isStateStorageValid,
    normalizeJsonState,
    withoutPrivateState,
    resetTurnTimer,
    updatePokerStateOptimistic,
    deriveCommunityCards: () => [],
    deriveRemainingDeck: () => [],
    maybeApplyTurnTimeout: ({ state }) => ({ applied: false, state, action: null, events: [] }),
    loadHoleCardsByUserId: async () => ({ holeCardsByUserId: {}, holeCardsStatusByUserId: {} }),
    isHoleCardsTableMissing: async () => false,
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
            const row = stored.requests.get(keyFor(params));
            return row ? [{ result_json: row.resultJson, created_at: row.createdAt }] : [];
          }
          if (text.includes("insert into public.poker_requests")) {
            const key = keyFor(params);
            if (!stored.requests.has(key)) stored.requests.set(key, { resultJson: null, createdAt: new Date().toISOString() });
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("update public.poker_requests")) {
            const key = keyFor(params);
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
          return [];
        },
      }),
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "leave-defined", action: { type: "LEAVE_TABLE" } }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.ok, true);
  assert.equal(payload.state?.state?.leftTableByUserId?.[humanUserId], true);
};

run().then(() => console.log("poker-act leave applyLeaveTable defined behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
