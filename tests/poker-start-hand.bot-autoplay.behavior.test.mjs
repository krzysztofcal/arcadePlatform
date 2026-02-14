import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { createDeck, dealHoleCards, shuffle } from "../netlify/functions/_shared/poker-engine.mjs";
import { deriveDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { TURN_MS, advanceIfNeeded, applyAction } from "../netlify/functions/_shared/poker-reducer.mjs";
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
  const logs = [];
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
              { user_id: humanUserId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 200 },
              { user_id: botUserId, seat_no: 2, status: "ACTIVE", is_bot: true, stack: 200 },
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
    body: JSON.stringify({ tableId, requestId: "bot-start-1" }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.ok, true);
  assert.equal(payload.state?.state?.phase, "PREFLOP");
  assert.ok(payload.state?.version >= 9, "expected at least one bot mutation beyond initial start-hand write");
  assert.equal(payload.state?.version, stateHolder.version, "expected payload version to match latest stored state version");
  assert.ok(actionRows.length >= 4, "expected START_HAND + blinds + bot action");
  const botRows = actionRows.filter((row) => {
    const meta = JSON.parse(row?.[9] || "null");
    return meta?.actor === "BOT";
  });
  const botMeta = botRows.map((row) => JSON.parse(row?.[9] || "null")).find((meta) => meta?.actor === "BOT");
  assert.equal(botMeta?.botUserId, botUserId);
  const botVersions = botRows.map((row) => Number(row?.[1])).filter(Number.isFinite);
  assert.ok(botVersions.length >= 1, "expected bot action version rows");
  assert.equal(Math.max(...botVersions), payload.state?.version, "expected latest bot action version to match payload version");
  assert.equal(stateHolder.state.communityDealt, (stateHolder.state.community || []).length);
  const phase = stateHolder.state.phase;
  const isActionPhase = phase === "PREFLOP" || phase === "FLOP" || phase === "TURN" || phase === "RIVER";
  if (isActionPhase) {
    assert.equal(typeof stateHolder.state.turnUserId, "string");
    assert.ok(stateHolder.state.turnUserId.length > 0, "expected non-empty turnUserId");
    assert.notEqual(stateHolder.state.turnDeadlineAt, null, "expected non-null turn deadline in action phase");
  }
  const stopLog = logs.find((entry) => entry.event === "poker_start_hand_bot_autoplay_stop");
  assert.equal(typeof stopLog?.payload?.reason, "string");
};

run().then(() => console.log("poker-start-hand bot autoplay behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
