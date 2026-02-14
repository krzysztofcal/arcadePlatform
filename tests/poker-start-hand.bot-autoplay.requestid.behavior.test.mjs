import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { createDeck, dealHoleCards, shuffle } from "../netlify/functions/_shared/poker-engine.mjs";
import { deriveDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { TURN_MS, advanceIfNeeded, applyAction } from "../netlify/functions/_shared/poker-reducer.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { getRng, isPlainObject, isStateStorageValid, normalizeJsonState, upgradeLegacyInitStateWithSeats, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { normalizeRequestId } from "../netlify/functions/_shared/poker-request-id.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { clearMissedTurns } from "../netlify/functions/_shared/poker-missed-turns.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";
process.env.POKER_BOTS_MAX_ACTIONS_PER_REQUEST = "1";

const run = async () => {
  const actionRows = [];
  const requestStore = new Map();
  const stateHolder = {
    version: 7,
    state: {
      tableId,
      phase: "INIT",
      stacks: {
        [humanUserId]: 200,
        [botUserId]: 200,
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
    computeNextDealerSeatNo: () => 2,
    buildActionConstraints,
    updatePokerStateOptimistic,
    TURN_MS,
    applyAction,
    advanceIfNeeded,
    resetTurnTimer,
    clearMissedTurns,
    klog: () => {},
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          if (text.includes("from public.poker_state") && text.includes("version, state")) return [{ version: stateHolder.version, state: stateHolder.state }];
          if (text.includes("from public.poker_seats")) {
            return [
              { user_id: humanUserId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 200 },
              { user_id: botUserId, seat_no: 2, status: "ACTIVE", is_bot: true, stack: 200 },
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
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("insert into public.poker_hole_cards")) {
            const insertedRows = [];
            for (let i = 0; i < params.length; i += 4) insertedRows.push({ user_id: params[i + 2] });
            return insertedRows;
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            stateHolder.state = JSON.parse(params?.[2] || "{}");
            stateHolder.version += 1;
            return [{ version: stateHolder.version }];
          }
          if (text.includes("insert into public.poker_actions")) {
            actionRows.push(params);
            return [];
          }
          if (text.includes("update public.poker_tables set last_activity_at = now(), updated_at = now()")) return [];
          return [];
        },
      }),
  });

  const first = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "start-req-1" }),
  });
  assert.equal(first.statusCode, 200);
  const firstBody = first.body;
  const versionAfterFirst = stateHolder.version;

  const botRowsAfterFirst = actionRows.filter((row) => {
    const meta = JSON.parse(row?.[9] || "null");
    return meta?.actor === "BOT";
  });
  assert.ok(botRowsAfterFirst.length >= 1, "expected bot row on first start-hand request");
  const botReq = String(botRowsAfterFirst[0]?.[6] || "");
  assert.ok(botReq.includes("start-req-1"), "expected bot request id namespaced by start request id");

  const beforeReplayBotRows = botRowsAfterFirst.length;
  const second = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "start-req-1" }),
  });
  assert.equal(second.statusCode, 200);
  const firstPayload = JSON.parse(firstBody || "{}");
  const secondPayload = JSON.parse(second.body || "{}");
  assert.deepEqual(secondPayload, { ...firstPayload, replayed: true }, "expected replay response to match stored payload semantics");
  assert.equal(stateHolder.version, versionAfterFirst, "expected no state version bump on replay");

  const botRowsAfterReplay = actionRows.filter((row) => {
    const meta = JSON.parse(row?.[9] || "null");
    return meta?.actor === "BOT";
  });
  assert.equal(botRowsAfterReplay.length, beforeReplayBotRows, "expected no additional bot rows for replayed requestId");
};

run().then(() => console.log("poker-start-hand bot autoplay requestId behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
