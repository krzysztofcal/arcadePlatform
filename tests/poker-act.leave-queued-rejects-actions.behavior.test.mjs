import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "77777777-7777-4777-8777-777777777777";
const userId = "abababab-abab-4bab-8bab-abababababab";
const otherUserId = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";

const run = async () => {
  let stateUpdateCount = 0;

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: () => ({ ok: true, value: "rid-queued-reject" }),
    normalizeJsonState: (value) => value,
    isStateStorageValid: () => true,
    withoutPrivateState: (state) => state,
    computeLegalActions: () => {
      throw new Error("should_not_reach_legal_actions");
    },
    buildActionConstraints: () => {
      throw new Error("should_not_reach_action_constraints");
    },
    resetTurnTimer: () => {
      throw new Error("should_not_reach_reset_turn_timer");
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2")) return [{ user_id: userId }];
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) {
            return [
              { user_id: userId, seat_no: 1, is_bot: false },
              { user_id: otherUserId, seat_no: 2, is_bot: false },
            ];
          }
          if (text.includes("from public.poker_state")) {
            return [{
              version: 4,
              state: {
                phase: "PREFLOP",
                seats: [{ userId, seatNo: 1 }, { userId: otherUserId, seatNo: 2 }],
                stacks: { [userId]: 80, [otherUserId]: 120 },
                pot: 20,
                community: [],
                dealerSeatNo: 1,
                turnUserId: userId,
                handId: "hand-queued-leave",
                handSeed: "seed-queued-leave",
                communityDealt: 0,
                toCallByUserId: { [userId]: 0, [otherUserId]: 0 },
                betThisRoundByUserId: { [userId]: 0, [otherUserId]: 0 },
                actedThisRoundByUserId: { [userId]: false, [otherUserId]: false },
                foldedByUserId: { [userId]: false, [otherUserId]: false },
                leftTableByUserId: { [userId]: true, [otherUserId]: false },
                sitOutByUserId: { [userId]: false, [otherUserId]: false },
                pendingAutoSitOutByUserId: {},
                currentBet: 0,
                lastRaiseSize: 0,
                lastActionRequestIdByUserId: {},
              },
            }];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            stateUpdateCount += 1;
            return [{ version: 5 }];
          }
          return [];
        },
      }),
    maybeApplyTurnTimeout: ({ state }) => ({ applied: false, state, action: null, events: [] }),
    loadHoleCardsByUserId: async () => ({ holeCardsByUserId: {}, holeCardsStatusByUserId: {} }),
    isHoleCardsTableMissing: async () => false,
    deriveCommunityCards: () => [],
    deriveRemainingDeck: () => [],
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "rid-queued-reject", action: { type: "CHECK" } }),
  });

  assert.equal(response.statusCode, 409);
  const body = JSON.parse(response.body || "{}");
  assert.equal(body.error, "player_left");
  assert.equal(stateUpdateCount, 0);
};

run().then(() => console.log("poker-act leave queued rejects actions behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
