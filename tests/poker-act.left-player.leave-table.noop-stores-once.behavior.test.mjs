import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
const userId = "abababab-1111-4111-8111-abababababab";
const otherUserId = "bcbcbcbc-2222-4222-8222-bcbcbcbcbcbc";

const writeSignatures = [
  "update public.poker_state set version = version + 1",
  "insert into public.poker_actions",
  "update public.poker_tables set last_activity_at = now()",
];

const run = async () => {
  const queries = [];
  const storedByRequestId = new Map();
  let storePokerRequestResultCount = 0;
  let storedPayload = null;

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    normalizeRequestId: (value) => ({ ok: true, value: value || "rid-left-noop-store" }),
    normalizeJsonState: (value) => value,
    isStateStorageValid: () => true,
    withoutPrivateState: (state) => state,
    deriveCommunityCards: () => [],
    deriveRemainingDeck: () => [],
    ensurePokerRequest: async (_tx, { requestId }) => {
      if (storedByRequestId.has(requestId)) {
        return { status: "stored", result: storedByRequestId.get(requestId) };
      }
      return { status: "claimed" };
    },
    storePokerRequestResult: async (_tx, { requestId, result }) => {
      storePokerRequestResultCount += 1;
      storedPayload = result;
      storedByRequestId.set(requestId, result);
    },
    maybeApplyTurnTimeout: () => {
      throw new Error("should_not_apply_timeout_for_left_leave_noop_stores_once");
    },
    loadHoleCardsByUserId: async () => ({ holeCardsByUserId: {}, holeCardsStatusByUserId: {} }),
    isHoleCardsTableMissing: async () => false,
    klog: () => {},
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          queries.push(text);
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'") && text.includes("user_id = $2")) return [{ user_id: userId }];
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'") && !text.includes("user_id = $2")) {
            return [
              { user_id: userId, seat_no: 1, is_bot: false },
              { user_id: otherUserId, seat_no: 2, is_bot: false },
            ];
          }
          if (text.includes("from public.poker_state")) {
            return [{
              version: 5,
              state: {
                phase: "PREFLOP",
                seats: [{ userId, seatNo: 1 }, { userId: otherUserId, seatNo: 2 }],
                handSeats: [{ userId, seatNo: 1 }, { userId: otherUserId, seatNo: 2 }],
                stacks: { [userId]: 100, [otherUserId]: 100 },
                pot: 0,
                community: [],
                dealerSeatNo: 1,
                turnUserId: userId,
                handId: "hand-left-store-once",
                handSeed: "seed-left-store-once",
                communityDealt: 0,
                toCallByUserId: { [userId]: 0, [otherUserId]: 0 },
                betThisRoundByUserId: { [userId]: 0, [otherUserId]: 0 },
                actedThisRoundByUserId: { [userId]: false, [otherUserId]: false },
                foldedByUserId: { [userId]: false, [otherUserId]: false },
                leftTableByUserId: { [userId]: true },
                sitOutByUserId: { [userId]: false, [otherUserId]: false },
                pendingAutoSitOutByUserId: {},
                currentBet: 0,
                lastRaiseSize: 0,
                lastActionRequestIdByUserId: {},
              },
            }];
          }
          return [];
        },
      }),
  });

  const payload = { tableId, requestId: "rid-left-noop-store", action: { type: "LEAVE_TABLE" } };

  const first = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify(payload),
  });
  const second = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify(payload),
  });

  const firstBody = JSON.parse(first.body || "{}");
  const secondBody = JSON.parse(second.body || "{}");

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(storePokerRequestResultCount, 1);
  assert.deepEqual(storedPayload, firstBody);
  assert.deepEqual(secondBody, { ...storedPayload, replayed: true });

  for (const signature of writeSignatures) {
    assert.equal(queries.some((query) => query.includes(signature)), false, `unexpected gameplay write query: ${signature}`);
  }
};

run()
  .then(() => {
    process.stdout.write("poker-act left-player leave-table noop stores-once behavior test passed\n");
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  });
