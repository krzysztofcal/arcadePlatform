import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { createDeck, dealHoleCards, shuffle } from "../netlify/functions/_shared/poker-engine.mjs";
import { deriveDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { TURN_MS, computeNextDealerSeatNo } from "../netlify/functions/_shared/poker-reducer.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import {
  getRng,
  isPlainObject,
  isStateStorageValid,
  normalizeJsonState,
  upgradeLegacyInitStateWithSeats,
  withoutPrivateState,
} from "../netlify/functions/_shared/poker-state-utils.mjs";
import { normalizeRequestId } from "../netlify/functions/_shared/poker-request-id.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bot1UserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bot2UserId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";

const run = async () => {
  const logs = [];
  const stateWrites = [];
  const requestStore = new Map();
  const stateHolder = {
    version: 7,
    state: {
      tableId,
      phase: "INIT",
      stacks: {
        [bot1UserId]: 200,
      },
    },
  };

  const handler = loadPokerHandler("netlify/functions/poker-start-hand.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
    isValidUuid: () => true,
    createDeck,
    dealHoleCards,
    deriveDeck,
    getRng,
    isPlainObject,
    isStateStorageValid,
    shuffle,
    normalizeJsonState,
    normalizeRequestId,
    upgradeLegacyInitStateWithSeats,
    withoutPrivateState,
    computeLegalActions,
    computeNextDealerSeatNo,
    buildActionConstraints,
    updatePokerStateOptimistic,
    TURN_MS,
    klog: (event, payload) => logs.push({ event, payload }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          }
          if (text.includes("from public.poker_state") && text.includes("version, state")) {
            return [{ version: stateHolder.version, state: stateHolder.state }];
          }
          if (text.includes("from public.poker_seats")) {
            return [
              { user_id: humanUserId, seat_no: 1, status: "ACTIVE", stack: 100 },
              { user_id: bot1UserId, seat_no: 2, status: "ACTIVE", stack: 200 },
              { user_id: bot2UserId, seat_no: 3, status: "ACTIVE", stack: 200 },
            ];
          }
          if (text.includes("from public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const entry = requestStore.get(key);
            if (!entry) return [];
            return [{ result_json: entry.resultJson, created_at: entry.createdAt }];
          }
          if (text.includes("insert into public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            if (requestStore.has(key)) return [];
            requestStore.set(key, { resultJson: null, createdAt: new Date().toISOString() });
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("update public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const entry = requestStore.get(key) || { createdAt: new Date().toISOString() };
            entry.resultJson = params?.[4] ?? null;
            requestStore.set(key, entry);
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("insert into public.poker_hole_cards")) {
            const insertedRows = [];
            for (let i = 0; i < params.length; i += 4) insertedRows.push({ user_id: params[i + 2] });
            return insertedRows;
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            const statePayload = JSON.parse(params?.[2] || "{}");
            stateWrites.push(statePayload);
            stateHolder.state = statePayload;
            stateHolder.version += 1;
            return [{ version: stateHolder.version }];
          }
          if (text.includes("insert into public.poker_actions")) return [];
          if (text.includes("update public.poker_tables set last_activity_at = now(), updated_at = now()")) return [];
          return [];
        },
      }),
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "seat-stack-req-1" }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.ok, true);
  assert.equal(payload.state?.state?.phase, "PREFLOP");
  assert.ok(payload.state?.state?.stacks?.[humanUserId] > 0, "human stack should remain non-zero in PREFLOP");

  const stateWrite = stateWrites[stateWrites.length - 1];
  assert.ok(stateWrite, "expected preflop state write");
  assert.equal(stateWrite.stacks[humanUserId], 100, "human should be UTG and not post blind");
  assert.equal(stateWrite.stacks[bot1UserId], 199, "small blind should be deducted from seat-derived stack");
  assert.equal(stateWrite.stacks[bot2UserId], 198, "big blind should be deducted from seat-derived stack");

  const errorLog = logs.find((entry) => entry.event === "poker_start_hand_error");
  assert.equal(errorLog, undefined, "did not expect poker_start_hand_error in seat stack happy path");
};

run()
  .then(() => {
    console.log("poker-start-hand seat stack behavior test passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
