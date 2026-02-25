import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";

const writeSignatures = [
  "update public.poker_state set version = version + 1",
  "insert into public.poker_actions",
  "update public.poker_tables set last_activity_at = now()",
];

const hasWriteQueries = (queries) =>
  writeSignatures.some((signature) => queries.some((query) => query.includes(signature)));

const run = async () => {
  const queries = [];

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    normalizeRequestId: (value) => ({ ok: true, value: value || "rid-fallback" }),
    normalizeJsonState: (value) => value,
    isStateStorageValid: () => true,
    withoutPrivateState: (state) => state,
    deriveCommunityCards: () => [],
    deriveRemainingDeck: () => [],
    maybeApplyTurnTimeout: () => {
      throw new Error("should_not_apply_timeout_for_left_player");
    },
    ensurePokerRequest: async () => ({ status: "claimed" }),
    storePokerRequestResult: async () => {},
    loadHoleCardsByUserId: async () => ({ holeCardsByUserId: {}, holeCardsStatusByUserId: {} }),
    isHoleCardsTableMissing: async () => false,
    klog: () => {},
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          queries.push(text);
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          }
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'") && text.includes("user_id = $2")) {
            return [{ user_id: userId }];
          }
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'") && !text.includes("user_id = $2")) {
            return [
              { user_id: userId, seat_no: 1, is_bot: false },
              { user_id: otherUserId, seat_no: 2, is_bot: false },
            ];
          }
          if (text.includes("from public.poker_state")) {
            return [
              {
                version: 7,
                state: {
                  phase: "PREFLOP",
                  seats: [
                    { userId, seatNo: 1 },
                    { userId: otherUserId, seatNo: 2 },
                  ],
                  handSeats: [
                    { userId, seatNo: 1 },
                    { userId: otherUserId, seatNo: 2 },
                  ],
                  stacks: { [userId]: 100, [otherUserId]: 100 },
                  pot: 4,
                  community: [],
                  dealerSeatNo: 1,
                  turnUserId: userId,
                  handId: "hand-left-guard",
                  handSeed: "seed-left-guard",
                  communityDealt: 0,
                  toCallByUserId: { [userId]: 0, [otherUserId]: 0 },
                  betThisRoundByUserId: { [userId]: 0, [otherUserId]: 0 },
                  actedThisRoundByUserId: { [userId]: false, [otherUserId]: true },
                  foldedByUserId: { [userId]: false, [otherUserId]: false },
                  leftTableByUserId: { [userId]: true },
                  sitOutByUserId: { [userId]: false, [otherUserId]: false },
                  pendingAutoSitOutByUserId: {},
                  currentBet: 0,
                  lastRaiseSize: 0,
                  lastActionRequestIdByUserId: {},
                },
              },
            ];
          }
          return [];
        },
      }),
  });

  const invoke = async (requestId, action) =>
    handler({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ tableId, requestId, action }),
    });

  const beforeCheckCount = queries.length;
  const checkResponse = await invoke("rid-left-check", { type: "CHECK" });
  const checkQueries = queries.slice(beforeCheckCount);

  assert.equal(checkResponse.statusCode, 409);
  assert.equal(JSON.parse(checkResponse.body || "{}").error, "player_left");
  assert.equal(hasWriteQueries(checkQueries), false);

  const beforeLeaveCount = queries.length;
  const leaveResponse = await invoke("rid-left-leave", { type: "LEAVE_TABLE" });
  const leaveQueries = queries.slice(beforeLeaveCount);

  const leaveBody = JSON.parse(leaveResponse.body || "{}");
  assert.notEqual(leaveResponse.statusCode, 409);
  assert.notEqual(leaveBody.error, "player_left");
  assert.equal(leaveBody.ok, true);
  assert.equal(hasWriteQueries(leaveQueries), false);
};

run()
  .then(() => {
    process.stdout.write("poker-act left-player invalid-player behavior test passed\n");
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  });
