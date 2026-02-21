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
    version: 5,
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
      pot: 20,
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

  let holeInsertCount = 0;
  let actionInsertCount = 0;
  let stateWriteCount = 0;

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
      if (action?.userId === humanUserId) {
        return { state: { ...state, phase: "HAND_DONE", turnUserId: null, pot: 0 }, events: [] };
      }
      return {
        state: { ...state, phase: "PREFLOP", turnUserId: humanUserId, actedThisRoundByUserId: { ...(state.actedThisRoundByUserId || {}), [action.userId]: true } },
        events: [{ type: "BOT_ACTED" }],
      };
    },
    startHandCore: async ({ tx, tableId: startTableId, expectedVersion, currentState }) => {
      await tx.unsafe("insert into public.poker_hole_cards (table_id, hand_id, user_id, cards) values ($1, $2, $3, $4::jsonb);", [startTableId, "ffffffff-ffff-4fff-8fff-ffffffffffff", "seed-user", "[]"]);
      await tx.unsafe("insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);", [startTableId, expectedVersion + 1, null, "START_HAND", null, "ffffffff-ffff-4fff-8fff-ffffffffffff", "auto", "SETTLED", "PREFLOP", null]);
      return {
      updatedState: {
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
      },
      privateState: {
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
      },
      dealtHoleCards: {
        [humanUserId]: [{ r: "2", s: "S" }, { r: "3", s: "S" }],
        [bot1UserId]: [{ r: "4", s: "S" }, { r: "5", s: "S" }],
        [bot2UserId]: [{ r: "6", s: "S" }, { r: "7", s: "S" }],
      },
      newVersion: expectedVersion + 1,
    };
    },
    loadHoleCardsByUserId: async () => ({
      holeCardsByUserId: {
        [humanUserId]: [{ r: "A", s: "S" }, { r: "K", s: "S" }],
        [bot1UserId]: [{ r: "Q", s: "S" }, { r: "J", s: "S" }],
        [bot2UserId]: [{ r: "T", s: "S" }, { r: "9", s: "S" }],
      },
    }),
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
            stateWriteCount += 1;
            stored.state = JSON.parse(params?.[2] || "{}");
            stored.version += 1;
            return [{ version: stored.version }];
          }
          if (text.includes("insert into public.poker_hole_cards")) {
            holeInsertCount += 1;
            return [{ user_id: humanUserId }, { user_id: bot1UserId }, { user_id: bot2UserId }];
          }
          if (text.includes("insert into public.poker_actions")) {
            actionInsertCount += 1;
            return [{ ok: true }];
          }
          return [];
        },
      }),
    klog: () => {},
  });

  const event = {
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "act-auto-start-idempotent", action: { type: "CHECK" } }),
  };

  const first = await handler(event);
  const firstPayload = JSON.parse(first.body || "{}");
  assert.equal(first.statusCode, 200);
  assert.equal(firstPayload.ok, true);
  assert.equal(stateWriteCount >= 2, true, "first run should settle and advance via bot autoplay");
  assert.equal(holeInsertCount, 1, "first run should deal hole cards once");
  assert.equal(actionInsertCount >= 3, true, "first run should insert player + start hand + bot action rows");

  const writeCountAfterFirst = stateWriteCount;
  const holeCountAfterFirst = holeInsertCount;
  const actionCountAfterFirst = actionInsertCount;

  const second = await handler(event);
  const secondPayload = JSON.parse(second.body || "{}");
  assert.equal(second.statusCode, 200);
  assert.equal(secondPayload.replayed, true);
  assert.deepEqual(secondPayload.state, firstPayload.state);
  assert.equal(stateWriteCount, writeCountAfterFirst);
  assert.equal(holeInsertCount, holeCountAfterFirst);
  assert.equal(actionInsertCount, actionCountAfterFirst);
};

run().then(() => console.log("poker-act auto-next-hand idempotency behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
