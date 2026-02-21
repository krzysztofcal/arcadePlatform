import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { TURN_MS, advanceIfNeeded } from "../netlify/functions/_shared/poker-reducer.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { isStateStorageValid, normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bot1UserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bot2UserId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";
process.env.POKER_BOT_MAX_ACTIONS_PER_REQUEST = "1";

const run = async () => {
  const stored = {
    version: 11,
    state: {
      tableId,
      phase: "RIVER",
      handId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      handSeed: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      seats: [
        { userId: humanUserId, seatNo: 1 },
        { userId: bot1UserId, seatNo: 2 },
        { userId: bot2UserId, seatNo: 3 },
      ],
      stacks: { [humanUserId]: 100, [bot1UserId]: 100, [bot2UserId]: 100 },
      pot: 30,
      community: [],
      communityDealt: 0,
      dealerSeatNo: 1,
      turnUserId: humanUserId,
      toCallByUserId: { [humanUserId]: 0, [bot1UserId]: 0, [bot2UserId]: 0 },
      betThisRoundByUserId: { [humanUserId]: 0, [bot1UserId]: 0, [bot2UserId]: 0 },
      actedThisRoundByUserId: { [humanUserId]: false, [bot1UserId]: false, [bot2UserId]: false },
      foldedByUserId: { [humanUserId]: false, [bot1UserId]: false, [bot2UserId]: false },
      lastActionRequestIdByUserId: {},
      currentBet: 0,
      lastRaiseSize: 0,
    },
    requests: new Map(),
  };

  const stepErrorLogs = [];

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
    maybeApplyTurnTimeout: async (state) => ({ state, timedOut: false }),
    chooseBotActionTrivial: () => ({ type: "CHECK" }),
    applyAction: (state, action) => {
      if (action?.userId === bot1UserId) throw new Error("bot fail");
      return { state: { ...state, phase: "HAND_DONE", turnUserId: null, pot: 0 }, events: [] };
    },
    startHandCore: async ({ tx, tableId: startTableId, expectedVersion, currentState }) => {
      const autoState = {
        ...currentState,
        phase: "PREFLOP",
        handId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        handSeed: "99999999-9999-4999-8999-999999999999",
        turnUserId: bot1UserId,
        community: [],
        communityDealt: 0,
        toCallByUserId: { [humanUserId]: 0, [bot1UserId]: 0, [bot2UserId]: 0 },
        betThisRoundByUserId: { [humanUserId]: 0, [bot1UserId]: 0, [bot2UserId]: 0 },
        actedThisRoundByUserId: { [humanUserId]: false, [bot1UserId]: false, [bot2UserId]: false },
        foldedByUserId: { [humanUserId]: false, [bot1UserId]: false, [bot2UserId]: false },
      };
      const autoWrite = await updatePokerStateOptimistic(tx, { tableId: startTableId, expectedVersion, nextState: autoState });
      assert.equal(autoWrite.ok, true);
      await tx.unsafe("insert into public.poker_hole_cards (table_id, hand_id, user_id, cards) values ($1, $2, $3, $4::jsonb);", [startTableId, autoState.handId, "seed-user", "[]"]);
      await tx.unsafe("insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);", [startTableId, expectedVersion + 1, null, "START_HAND", null, autoState.handId, "auto", "SETTLED", "PREFLOP", null]);
      return { updatedState: autoState, privateState: autoState, dealtHoleCards: {}, newVersion: expectedVersion + 1 };
    },
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
              { user_id: bot1UserId, seat_no: 2, is_bot: true },
              { user_id: bot2UserId, seat_no: 3, is_bot: true },
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
          return [{ ok: true }];
        },
      }),
    klog: (eventName, payload) => {
      if (eventName === "poker_act_bot_autoplay_step_error") stepErrorLogs.push(payload);
    },
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "act-step-error-handid", action: { type: "CHECK" } }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.ok, true);
  assert.equal(stepErrorLogs.length >= 1, true);
  assert.equal(stepErrorLogs[0]?.handId, payload.state?.state?.handId);
  assert.equal(stepErrorLogs[0]?.turnUserId, bot1UserId);
  assert.equal(stepErrorLogs[0]?.actionType, "CHECK");
};

run().then(() => console.log("poker-act bot autoplay step error log handId behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
