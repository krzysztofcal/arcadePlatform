import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const botUserId = "33333333-3333-4333-8333-333333333333";

const makeHandler = ({ requestStore, postCalls, stateRef, helperCalls }) =>
  loadPokerHandler("netlify/functions/poker-leave.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: botUserId }),
    isValidUuid: (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")),
    normalizeRequestId: (value) => ({ ok: true, value: value ?? null }),
    updatePokerStateOptimistic,
    getBotConfig: () => ({ bankrollSystemKey: "TREASURY" }),
    cashoutBotSeatIfNeeded: async (tx, args) => {
      const amount = stateRef.seatStack;
      if (amount > 0) {
        postCalls.push({
          txType: "TABLE_CASH_OUT",
          idempotencyKey: `bot-cashout:${args.tableId}:${args.seatNo}:LEAVE:${args.idempotencyKeySuffix}`,
          createdBy: args.actorUserId,
          userId: args.actorUserId,
          entries: [
            { accountType: "ESCROW", systemKey: `POKER_TABLE:${args.tableId}`, amount: -amount },
            { accountType: "SYSTEM", systemKey: args.bankrollSystemKey, amount },
          ],
        });
      }
      helperCalls.push(args);
      await tx.unsafe("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2;", [args.tableId, args.botUserId]);
      return { ok: true, amount };
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests where")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const row = requestStore.get(key);
            return row ? [{ result_json: row.resultJson, created_at: row.createdAt }] : [];
          }
          if (text.includes("insert into public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            if (!requestStore.has(key)) {
              requestStore.set(key, { resultJson: null, createdAt: new Date().toISOString() });
            }
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("update public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            requestStore.set(key, { resultJson: params?.[4], createdAt: new Date().toISOString() });
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
          if (text.includes("from public.poker_state")) {
            return [{ version: stateRef.version, state: JSON.stringify(stateRef.state) }];
          }
          if (text.includes("from public.poker_seats") && text.includes("for update")) {
            return [{ seat_no: 2, status: "ACTIVE", stack: stateRef.seatStack, is_bot: true, user_id: botUserId }];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            stateRef.version += 1;
            stateRef.state = JSON.parse(params?.[2] || "{}");
            return [{ version: stateRef.version }];
          }
          if (text.includes("update public.poker_seats set stack = 0")) {
            stateRef.seatStack = 0;
            return [];
          }
          if (text.includes("delete from public.poker_seats")) {
            stateRef.deleted = true;
            return [];
          }
          return [];
        },
      }),
    postTransaction: async () => ({ transaction: { id: "tx-1" } }),
    klog: () => {},
  });

const run = async () => {
  const requestStore = new Map();
  const postCalls = [];
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const stateRef = {
    version: 1,
    seatStack: 200,
    deleted: false,
    state: {
      tableId,
      seats: [{ userId: botUserId, seatNo: 2 }],
      stacks: { [botUserId]: 200 },
      pot: 0,
      phase: "INIT",
    },
  };

  const helperCalls = [];
  const handler = makeHandler({ requestStore, postCalls, stateRef, helperCalls });
  const requestId = "leave-bot-1";
  const first = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId }),
  });
  assert.equal(first.statusCode, 200);
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].txType, "TABLE_CASH_OUT");
  assert.equal(postCalls[0].idempotencyKey, `bot-cashout:${tableId}:2:LEAVE:${requestId}`);
  assert.equal(postCalls[0].createdBy, process.env.POKER_SYSTEM_ACTOR_USER_ID);
  assert.equal(postCalls[0].userId, process.env.POKER_SYSTEM_ACTOR_USER_ID);
  assert.deepEqual(postCalls[0].entries, [
    { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -200 },
    { accountType: "SYSTEM", systemKey: "TREASURY", amount: 200 },
  ]);

  const firstBody = JSON.parse(first.body);
  assert.equal(firstBody.cashedOut, 200);
  assert.equal(stateRef.seatStack, 0);
  assert.equal(stateRef.state.stacks[botUserId], undefined);

  const replay = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId }),
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(postCalls.length, 1, "replay should not perform extra bot cashout");


  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";
  const missingRequestStateRef = {
    version: 1,
    seatStack: 120,
    deleted: false,
    state: {
      tableId,
      seats: [{ userId: botUserId, seatNo: 2 }],
      stacks: { [botUserId]: 120 },
      pot: 0,
      phase: "INIT",
    },
  };
  const missingRequestStore = new Map();
  const missingRequestPostCalls = [];
  const missingRequestHelperCalls = [];
  const missingRequestHandler = makeHandler({
    requestStore: missingRequestStore,
    postCalls: missingRequestPostCalls,
    stateRef: missingRequestStateRef,
    helperCalls: missingRequestHelperCalls,
  });
  const missingRequestResponse = await missingRequestHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId }),
  });
  assert.equal(missingRequestResponse.statusCode, 400);
  assert.equal(JSON.parse(missingRequestResponse.body).error, "request_id_required");
  assert.equal(missingRequestPostCalls.length, 0);
  assert.equal(missingRequestHelperCalls.length, 0);

  process.env.POKER_SYSTEM_ACTOR_USER_ID = "";
  const missingActorStateRef = {
    version: 1,
    seatStack: 150,
    deleted: false,
    state: {
      tableId,
      seats: [{ userId: botUserId, seatNo: 2 }],
      stacks: { [botUserId]: 150 },
      pot: 0,
      phase: "INIT",
    },
  };
  const missingActorRequestStore = new Map();
  const missingActorPostCalls = [];
  const missingActorHelperCalls = [];
  const missingActorHandler = makeHandler({
    requestStore: missingActorRequestStore,
    postCalls: missingActorPostCalls,
    stateRef: missingActorStateRef,
    helperCalls: missingActorHelperCalls,
  });
  const missingActor = await missingActorHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "leave-bot-2" }),
  });
  assert.equal(missingActor.statusCode, 500);
  assert.equal(JSON.parse(missingActor.body).error, "invalid_system_actor_user_id");
  assert.equal(missingActorPostCalls.length, 0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
