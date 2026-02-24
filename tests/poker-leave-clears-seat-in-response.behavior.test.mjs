import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "44444444-4444-4444-8444-444444444444";
const userId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const botUserId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let nextStatePersisted = null;

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId }),
  isValidUuid: () => true,
  normalizeRequestId: (value) => ({ ok: true, value }),
  updatePokerStateOptimistic: async (tx, { tableId: updateTableId, expectedVersion, nextState }) => {
    await tx.unsafe(
      "update public.poker_state set state = $3::jsonb, version = version + 1 where table_id = $1 and version = $2 returning version;",
      [updateTableId, expectedVersion, JSON.stringify(nextState || {})]
    );
    return { ok: true, newVersion: expectedVersion + 1 };
  },
  runBotAutoplayLoop: async ({ requestId, initialState, initialVersion, persistStep }) => {
    const postBotState = {
      ...initialState,
      turnUserId: null,
      phase: "HAND_DONE",
      actedThisRoundByUserId: { ...(initialState.actedThisRoundByUserId || {}), [botUserId]: true },
    };
    const persisted = await persistStep({
      botTurnUserId: botUserId,
      botAction: { type: "CHECK" },
      botRequestId: `bot:${requestId}:1`,
      fromState: initialState,
      persistedState: postBotState,
      privateState: postBotState,
      loopVersion: initialVersion,
    });
    return { responseFinalState: postBotState, loopPrivateState: postBotState, loopVersion: persisted.loopVersion, botActionCount: 1, botStopReason: "non_action_phase", responseEvents: [] };
  },
  beginSql: async (fn) =>
    fn({
      unsafe: async (query, params) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) {
          return [{
            version: 10,
            state: {
              tableId,
              phase: "TURN",
              handId: "hand-clear-seat",
              handSeed: "seed-clear-seat",
              communityDealt: 3,
              community: [{ r: "2", s: "H" }, { r: "3", s: "D" }, { r: "4", s: "C" }],
              turnUserId: userId,
              seats: [{ userId, seatNo: 2 }, { userId: botUserId, seatNo: 4 }],
              stacks: { [userId]: 125, [botUserId]: 140 },
              actedThisRoundByUserId: { [userId]: false, [botUserId]: false },
              foldedByUserId: { [userId]: false, [botUserId]: false },
              leftTableByUserId: { [userId]: false, [botUserId]: false },
              sitOutByUserId: { [userId]: false, [botUserId]: false },
              pendingAutoSitOutByUserId: {},
              holeCardsByUserId: { [userId]: [{ r: "A", s: "S" }, { r: "A", s: "H" }] },
              deck: [{ r: "K", s: "S" }],
              pot: 0,
            },
          }];
        }
        if (text.includes("from public.poker_seats") && text.includes("and user_id") && text.includes("for update")) return [{ seat_no: 2, status: "ACTIVE", stack: 125 }];
        if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) {
          return [
            { user_id: userId, seat_no: 2, is_bot: false },
            { user_id: botUserId, seat_no: 4, is_bot: true },
          ];
        }
        if (text.includes("from public.poker_hole_cards")) {
          return [
            { user_id: userId, cards: [{ r: "A", s: "S" }, { r: "A", s: "H" }] },
            { user_id: botUserId, cards: [{ r: "K", s: "C" }, { r: "Q", s: "C" }] },
          ];
        }
        if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
          nextStatePersisted = JSON.parse(params?.[2] || "{}");
          return [{ version: Number(params?.[1]) + 1 }];
        }
        return [];
      },
    }),
  postTransaction: async () => ({ transaction: { id: "tx-2" } }),
  klog: () => {},
});

const response = await handler({
  httpMethod: "POST",
  headers: { origin: "https://example.test", authorization: "Bearer token" },
  body: JSON.stringify({ tableId, requestId: "leave-seat-clear", includeState: true }),
});

assert.equal(response.statusCode, 200);
const body = JSON.parse(response.body || "{}");
assert.equal(body.ok, true);
const returnedState = body.state?.state || {};
const returnedSeats = Array.isArray(returnedState.seats) ? returnedState.seats : [];
const returnedStacks = returnedState.stacks && typeof returnedState.stacks === "object" ? returnedState.stacks : {};

assert.equal(returnedSeats.some((seat) => seat?.userId === userId), false);
assert.equal(Object.prototype.hasOwnProperty.call(returnedStacks, userId), false);
assert.ok(returnedState.actedThisRoundByUserId?.[botUserId] === true || returnedState.turnUserId !== userId);
assert.ok(["TURN", "HAND_DONE"].includes(returnedState.phase));
assert.equal(returnedState.deck, undefined);
assert.equal(returnedState.holeCardsByUserId, undefined);
assert.ok(nextStatePersisted);

console.log("poker-leave clears seat in response behavior test passed");
