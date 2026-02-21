import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const systemActorUserId = "00000000-0000-4000-8000-000000000001";

const runCase = async ({ actorEnv }) => {
  if (actorEnv) {
    process.env.POKER_SYSTEM_ACTOR_USER_ID = actorEnv;
  } else {
    delete process.env.POKER_SYSTEM_ACTOR_USER_ID;
  }

  const queries = [];
  const helperCalls = [];
  const db = {
    version: 9,
    state: {
      tableId,
      phase: "RIVER",
      turnUserId: humanUserId,
      seats: [{ userId: humanUserId, seatNo: 1 }, { userId: botUserId, seatNo: 2 }],
      stacks: { [humanUserId]: 120, [botUserId]: 80 },
      toCallByUserId: { [humanUserId]: 0, [botUserId]: 0 },
      betThisRoundByUserId: { [humanUserId]: 0, [botUserId]: 0 },
      actedThisRoundByUserId: { [humanUserId]: false, [botUserId]: false },
      foldedByUserId: { [humanUserId]: false, [botUserId]: false },
      lastActionRequestIdByUserId: {},
      handId: "hand-1",
      handSeed: "seed-1",
      communityDealt: 0,
      pot: 0,
      community: [],
    },
    seatStatus: "ACTIVE",
  };

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
    isValidUuid: (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")),
    normalizeRequestId: (value) => ({ ok: true, value: value ?? null }),
    isStateStorageValid: () => true,
    normalizeJsonState: (value) => (typeof value === "string" ? JSON.parse(value) : value),
    withoutPrivateState: (state) => state,
    maybeApplyTurnTimeout: async ({ state }) => ({ state, changed: false }),
    advanceIfNeeded: (state) => ({ state, events: [] }),
    deriveCommunityCards: () => [],
    deriveRemainingDeck: () => [],
    applyAction: () => ({
      state: {
        ...db.state,
        phase: "SETTLED",
        turnUserId: humanUserId,
      },
      events: [{ type: "SETTLED" }],
    }),
    computeLegalActions: () => ({ actions: ["CALL"] }),
    buildActionConstraints: () => ({}),
    isHoleCardsTableMissing: () => false,
    loadHoleCardsByUserId: async () => ({ holeCardsByUserId: {} }),
    resetTurnTimer: (state) => ({ ...state, turnStartedAt: null, turnDeadlineAt: null }),
    updatePokerStateOptimistic: async (_tx, args) => {
      db.state = JSON.parse(args.nextState ? JSON.stringify(args.nextState) : "{}");
      db.version = Number(args.expectedVersion) + 1;
      return { ok: true, newVersion: db.version };
    },
    ensurePokerRequest: async () => ({ status: "created" }),
    storePokerRequestResult: async () => ({ ok: true }),
    deletePokerRequest: async () => ({ ok: true }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase().replace(/\s+/g, " ").trim();
          queries.push(text);
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: "1/2" }];
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'") && text.includes("user_id = $2")) {
            return [{ user_id: humanUserId }];
          }
          if (text.includes("select user_id, seat_no from public.poker_seats") && text.includes("leave_after_hand")) {
            if (db.seatStatus !== "ACTIVE") return [];
            return [{ user_id: botUserId, seat_no: 2 }];
          }
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'") && !text.includes("user_id = $2")) {
            return [{ user_id: humanUserId, is_bot: false }, { user_id: botUserId, is_bot: true }];
          }
          if (text.includes("from public.poker_state")) return [{ version: db.version, state: JSON.stringify(db.state) }];
          if (text.includes("insert into public.poker_actions")) return [{ ok: true }];
          if (text.includes("update public.poker_seats set stack = 0, leave_after_hand = false")) return [];
          return [];
        },
      }),
    ensureBotSeatInactiveForCashout: async () => {
      helperCalls.push({ phase: "ensure", tableId, botUserId });
      db.seatStatus = "INACTIVE";
      return { ok: true, changed: true, seatNo: 2 };
    },
    cashoutBotSeatIfNeeded: async (_tx, args) => {
      helperCalls.push({ phase: "cashout", ...args });
      return { ok: true, cashedOut: true, amount: 80, seatNo: 2 };
    },
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "settle-1", action: { type: "CALL" } }),
  });

  return { response, helperCalls, db, queries };
};

const run = async () => {
  const missingActor = await runCase({ actorEnv: "" });
  assert.equal(missingActor.response.statusCode, 200);
  assert.equal(missingActor.helperCalls.filter((x) => x.phase === "ensure").length, 1);
  assert.equal(missingActor.helperCalls.filter((x) => x.phase === "cashout").length, 1);
  const missingCashout = missingActor.helperCalls.find((x) => x.phase === "cashout");
  assert.equal(missingCashout?.actorUserId, humanUserId);
  assert.equal(missingCashout?.botUserId, botUserId);
  assert.equal(missingCashout?.seatNo, 2);
  assert.equal(missingCashout?.expectedAmount, 80);
  assert.equal(missingCashout?.idempotencyKeySuffix, "leave_after_hand:v1");
  assert.equal(Object.prototype.hasOwnProperty.call(missingActor.db.state.stacks, botUserId), false);
  assert.equal(
    missingActor.queries.some((q) => q.includes("update public.poker_seats set stack = 0, leave_after_hand = false where table_id = $1 and user_id = $2")),
    true
  );

  const validActor = await runCase({ actorEnv: systemActorUserId });
  assert.equal(validActor.response.statusCode, 200);
  assert.equal(validActor.helperCalls.filter((x) => x.phase === "ensure").length, 1);
  assert.equal(validActor.helperCalls.filter((x) => x.phase === "cashout").length, 1);
  const cashout = validActor.helperCalls.find((x) => x.phase === "cashout");
  assert.equal(cashout?.idempotencyKeySuffix, "leave_after_hand:v1");
  assert.equal(cashout?.actorUserId, systemActorUserId);
  assert.equal(cashout?.botUserId, botUserId);
  assert.equal(cashout?.seatNo, 2);
  assert.equal(cashout?.expectedAmount, 80);
  assert.equal(Object.prototype.hasOwnProperty.call(validActor.db.state.stacks, botUserId), false);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
