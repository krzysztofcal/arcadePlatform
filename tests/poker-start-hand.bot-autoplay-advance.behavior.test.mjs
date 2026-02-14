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
const botA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const botB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";
process.env.POKER_BOTS_MAX_ACTIONS_PER_REQUEST = "3";

const run = async () => {
  const actionRows = [];
  const logs = [];
  const stateHolder = {
    version: 10,
    state: {
      tableId,
      phase: "INIT",
      stacks: { [humanUserId]: 200, [botA]: 200, [botB]: 200 },
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
    computeNextDealerSeatNo: () => 3,
    buildActionConstraints,
    updatePokerStateOptimistic,
    TURN_MS,
    applyAction,
    advanceIfNeeded,
    resetTurnTimer,
    clearMissedTurns,
    advanceIfNeeded,
    resetTurnTimer,
    clearMissedTurns,
    klog: (event, payload) => logs.push({ event, payload }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          if (text.includes("from public.poker_state") && text.includes("version, state")) return [{ version: stateHolder.version, state: stateHolder.state }];
          if (text.includes("from public.poker_seats")) {
            return [
              { user_id: humanUserId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 200 },
              { user_id: botA, seat_no: 2, status: "ACTIVE", is_bot: true, stack: 200 },
              { user_id: botB, seat_no: 3, status: "ACTIVE", is_bot: true, stack: 200 },
            ];
          }
          if (text.includes("from public.poker_requests")) return [];
          if (text.includes("insert into public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("update public.poker_requests")) return [{ request_id: params?.[2] }];
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

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "bot-advance-1" }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.ok, true);

  const botActions = actionRows.filter((row) => {
    const meta = JSON.parse(row?.[9] || "null");
    return meta?.actor === "BOT";
  });
  assert.ok(botActions.length >= 1, "expected at least one bot action");

  const finalTurn = stateHolder.state.turnUserId || null;
  const advancedPhase = stateHolder.state.phase !== "PREFLOP";
  const progressedTurn = finalTurn !== botA;
  assert.ok(advancedPhase || progressedTurn, "expected phase or turn progression after bot autoplay");

  const errorLog = logs.find((entry) => entry.event === "poker_start_hand_error");
  assert.equal(errorLog, undefined, "did not expect state_invalid/server error");
};

run().then(() => console.log("poker-start-hand bot autoplay advance behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
