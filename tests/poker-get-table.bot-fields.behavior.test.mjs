import assert from "node:assert/strict";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { parseStakes } from "../netlify/functions/_shared/poker-stakes.mjs";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";

const makeHandler = () =>
  loadPokerHandler("netlify/functions/poker-get-table.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: "user-1" }),
    isValidUuid: () => true,
    parseStakes,
    normalizeJsonState,
    withoutPrivateState,
    computeLegalActions,
    buildActionConstraints,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, stakes: "1/2", max_players: 6, status: "OPEN" }];
          }
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) {
            return [{ user_id: "user-1", seat_no: 1 }];
          }
          if (text.includes("from public.poker_seats")) {
            return [
              {
                user_id: "user-1",
                seat_no: 1,
                status: "ACTIVE",
                stack: 100,
                is_bot: true,
                bot_profile: "TRIVIAL",
                leave_after_hand: true,
              },
            ];
          }
          if (text.includes("from public.poker_state")) {
            return [{ version: 1, state: { phase: "INIT", seats: [] } }];
          }
          return [];
        },
      }),
    klog: () => {},
  });

const run = async () => {
  const response = await makeHandler()({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.ok(Array.isArray(payload.seats));
  assert.equal(payload.seats.length, 1);
  assert.equal(payload.seats[0].isBot, true);
  assert.equal(payload.seats[0].botProfile, "TRIVIAL");
  assert.equal(payload.seats[0].leaveAfterHand, true);
};

await run();
