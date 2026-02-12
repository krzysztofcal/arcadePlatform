import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";

const makeHandler = () =>
  loadPokerHandler("netlify/functions/poker-get-table.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: "user-1" }),
    isValidUuid: () => true,
    parseStakes: () => ({ ok: true, value: { sb: 1, bb: 2 } }),
    normalizeJsonState: (value) => value,
    withoutPrivateState: (state) => state,
    computeLegalActions: () => ({ actions: [] }),
    buildActionConstraints: () => ({}),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          const compact = text.replace(/\s+/g, "");
          if (compact.includes("frompublic.poker_tables")) {
            return [{ id: tableId, stakes: "1/2", max_players: 6, status: "OPEN" }];
          }
          if (
            compact.includes("frompublic.poker_seats") &&
            compact.includes("status='active'") &&
            compact.includes("is_bot=false")
          ) {
            return [{ user_id: "user-1", seat_no: 1 }];
          }
          if (compact.includes("frompublic.poker_seats")) {
            return [
              {
                user_id: "user-1",
                seat_no: 1,
                status: "ACTIVE",
                is_bot: true,
                bot_profile: "TRIVIAL",
                leave_after_hand: true,
              },
            ];
          }
          if (compact.includes("frompublic.poker_state")) {
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

  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.seats[0].isBot, true);
  assert.equal(payload.seats[0].botProfile, "TRIVIAL");
  assert.equal(payload.seats[0].leaveAfterHand, true);
};

await run();
