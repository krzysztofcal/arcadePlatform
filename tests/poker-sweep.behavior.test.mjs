import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "22222222-2222-4222-8222-222222222222";
const userId = "user-2";
const seatNo = 3;

const makeHandler = (postCalls, queries) => {
  let beginCall = 0;
  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    beginSql: async (fn) => {
      beginCall += 1;
      if (beginCall === 1) {
        return fn({
          unsafe: async (query) => {
            const text = String(query).toLowerCase();
            if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
            if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) {
              return [{ table_id: tableId, user_id: userId, seat_no: seatNo, stack: 100, last_seen_at: new Date(0) }];
            }
            if (text.includes("delete from public.poker_requests")) return [];
            return [];
          },
        });
      }
      if (beginCall === 2) {
        return fn({
          unsafe: async (query, params) => {
            queries.push({ query: String(query), params });
            const text = String(query).toLowerCase();
            if (text.includes("select seat_no, status, stack, last_seen_at")) {
              return [
                {
                  seat_no: seatNo,
                  status: "ACTIVE",
                  stack: 100,
                  last_seen_at: new Date(Date.now() - 60 * 60 * 1000),
                },
              ];
            }
            return [];
          },
        });
      }
      if (beginCall === 3) {
        return fn({
          unsafe: async () => [],
        });
      }
      return fn({
        unsafe: async () => [],
      });
    },
    postTransaction: async (payload) => {
      postCalls.push(payload);
      return { transaction: { id: "tx-sweep" } };
    },
    klog: () => {},
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
  });
  return handler;
};

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const queries = [];
  const handler = makeHandler(postCalls, queries);
  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(postCalls.length, 1);
  const call = postCalls[0];
  assert.equal(call.txType, "TABLE_CASH_OUT");
  assert.equal(call.idempotencyKey, `poker:timeout_cashout:${tableId}:${userId}:v1`);
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
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
