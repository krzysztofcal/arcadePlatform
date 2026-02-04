import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "22222222-2222-4222-8222-222222222222";
const userId = "user-2";
const seatNo = 3;

let lockIdx = -1;
let updIdx = -1;

const makeHandler = (postCalls, queries, klogEvents, options = {}) => {
  const {
    deleteHoleCardsError,
    expiredSeats = [{ table_id: tableId, user_id: userId, seat_no: seatNo, stack: 100, last_seen_at: new Date(0) }],
    closeCashoutTables = [],
    closeCashoutSeats = [],
    closedTables = [tableId],
  } = options;
  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    beginSql: async (fn) => {
      return fn({
        unsafe: async (query, params) => {
          queries.push({ query: String(query), params });
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) {
            return expiredSeats;
          }
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_seats") && text.includes("for update") && text.includes("last_seen_at")) {
            lockIdx = queries.length - 1;
            return [
              {
                seat_no: seatNo,
                status: "ACTIVE",
                stack: 100,
                last_seen_at: new Date(Date.now() - 60 * 60 * 1000),
              },
            ];
          }
          if (text.includes("select t.id") && text.includes("stack > 0")) {
            return closeCashoutTables.map((id) => ({ id }));
          }
          if (text.includes("select seat_no, status, stack, user_id")) {
            return closeCashoutSeats;
          }
          if (text.includes("update public.poker_seats set status = 'inactive', stack = 0")) {
            updIdx = queries.length - 1;
          }
          if (text.includes("update public.poker_tables t")) {
            return closedTables.map((id) => ({ id }));
          }
          if (text.includes("delete from public.poker_hole_cards")) {
            if (deleteHoleCardsError) throw deleteHoleCardsError;
          }
          return [];
        },
      });
    },
    postTransaction: async (payload) => {
      postCalls.push(payload);
      return { transaction: { id: "tx-sweep" } };
    },
    klog: (event, payload) => {
      klogEvents.push({ event, payload });
    },
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    isHoleCardsTableMissing,
  });
  return handler;
};

const run = async () => {
  lockIdx = -1;
  updIdx = -1;
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const queries = [];
  const klogEvents = [];
  const handler = makeHandler(postCalls, queries, klogEvents);
  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(postCalls.length, 1);
  const call = postCalls[0];
  assert.equal(call.txType, "TABLE_CASH_OUT");
  assert.equal(call.idempotencyKey, `poker:timeout_cashout:${tableId}:${userId}:${seatNo}:v1`);
  assert.deepEqual(call.entries, [
    { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -100 },
    { accountType: "USER", amount: 100 },
  ]);
  assert.ok(
    queries.some(
      (q) =>
        q.query.toLowerCase().includes("update public.poker_seats set status = 'inactive', stack = 0") &&
        q.params?.[0] === tableId &&
        q.params?.[1] === userId
    ),
    "sweep should inactivate seat and zero stack for the timed-out user"
  );
  assert.ok(lockIdx >= 0, "sweep should lock seat before updating");
  assert.ok(updIdx > lockIdx, "sweep should update seat after lock");
  assert.ok(
    queries.some(
      (q) =>
        q.query.toLowerCase().includes("delete from public.poker_hole_cards") &&
        q.params?.[0]?.includes?.(tableId)
    ),
    "sweep should delete hole cards for closed tables"
  );
};

const runMissingHoleCardsTable = async () => {
  lockIdx = -1;
  updIdx = -1;
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const queries = [];
  const missingError = new Error("relation \"public.poker_hole_cards\" does not exist");
  missingError.code = "42P01";
  const klogEvents = [];
  const handler = makeHandler(postCalls, queries, klogEvents, { deleteHoleCardsError: missingError });
  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
};

const runCloseCashoutInvalidStack = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const queries = [];
  const klogEvents = [];
  const handler = makeHandler(postCalls, queries, klogEvents, {
    expiredSeats: [],
    closeCashoutTables: [tableId],
    closeCashoutSeats: [{ seat_no: seatNo, status: "INACTIVE", stack: "nope", user_id: userId }],
    closedTables: [],
  });
  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(postCalls.length, 0);
  assert.ok(
    !queries.some((q) => q.query.toLowerCase().includes("update public.poker_seats set status = 'inactive', stack = 0")),
    "sweep should not clear stacks when stack is invalid"
  );
  assert.ok(
    klogEvents.some((entry) => entry.event === "poker_close_cashout_stack_invalid"),
    "sweep should log invalid close cashout stacks"
  );
};

const runCloseCashoutSkipsActiveSeat = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const queries = [];
  const klogEvents = [];
  const handler = makeHandler(postCalls, queries, klogEvents, {
    expiredSeats: [],
    closeCashoutTables: [tableId],
    closeCashoutSeats: [{ seat_no: seatNo, status: "ACTIVE", stack: 55, user_id: userId }],
    closedTables: [],
  });
  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(postCalls.length, 0);
  assert.ok(
    !queries.some((q) => q.query.toLowerCase().includes("update public.poker_seats set status = 'inactive', stack = 0")),
    "sweep should not clear stacks for active close-cashout seats"
  );
  assert.ok(
    klogEvents.some((entry) => entry.event === "poker_close_cashout_skip_active_seat"),
    "sweep should log active seat skips"
  );
};

const runCloseCashoutUsesSeatNo = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const queries = [];
  const klogEvents = [];
  const handler = makeHandler(postCalls, queries, klogEvents, {
    expiredSeats: [],
    closeCashoutTables: [tableId],
    closeCashoutSeats: [{ seat_no: seatNo, status: "INACTIVE", stack: 55, user_id: userId }],
    closedTables: [],
  });
  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].idempotencyKey, `poker:close_cashout:${tableId}:${userId}:${seatNo}:v1`);
  assert.ok(
    queries.some(
      (q) =>
        q.query.toLowerCase().includes("update public.poker_seats set status = 'inactive', stack = 0") &&
        q.query.toLowerCase().includes("seat_no") &&
        q.params?.[0] === tableId &&
        q.params?.[1] === seatNo
    ),
    "sweep should update close cashout seats by table_id + seat_no"
  );
};

Promise.resolve()
  .then(run)
  .then(runMissingHoleCardsTable)
  .then(runCloseCashoutInvalidStack)
  .then(runCloseCashoutSkipsActiveSeat)
  .then(runCloseCashoutUsesSeatNo)
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
