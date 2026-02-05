import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "33333333-3333-4333-8333-333333333333";
const userId = "user-authoritative";
const seatNo = 4;

const makeStatefulHandler = ({ postCalls, klogEvents }) => {
  const db = {
    seatActive: true,
    seatStatus: "ACTIVE",
    seatStack: 100,
    stateStacks: { [userId]: 124 },
  };

  return loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();

          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("delete from public.poker_requests")) return [];

          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()") && !text.includes("for update")) {
            if (!db.seatActive) return [];
            return [
              {
                table_id: tableId,
                user_id: userId,
                seat_no: seatNo,
                stack: db.seatStack,
                last_seen_at: new Date(0),
              },
            ];
          }

          if (text.includes("from public.poker_seats") && text.includes("for update") && text.includes("last_seen_at")) {
            if (!db.seatActive) return [];
            return [
              {
                seat_no: seatNo,
                status: db.seatStatus,
                stack: db.seatStack,
                last_seen_at: new Date(0),
              },
            ];
          }

          if (text.includes("select state from public.poker_state where table_id") && text.includes("for update")) {
            return [{ state: { stacks: { ...db.stateStacks } } }];
          }

          if (text.includes("update public.poker_state set state")) {
            const nextState = params?.[1] || {};
            const nextStacks = nextState?.stacks && typeof nextState.stacks === "object" ? nextState.stacks : {};
            db.stateStacks = { ...nextStacks };
            return [];
          }

          if (text.includes("update public.poker_seats set status = 'inactive', stack = 0") && text.includes("user_id = $2")) {
            db.seatStatus = "INACTIVE";
            db.seatStack = 0;
            db.seatActive = false;
            return [];
          }

          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
          if (text.includes("update public.poker_tables t")) return [];
          if (text.includes("from public.chips_accounts")) return [];
          if (text.includes("delete from public.poker_hole_cards")) return [];

          return [];
        },
      }),
    postTransaction: async (payload) => {
      postCalls.push(payload);
      return { transaction: { id: "tx-authoritative" } };
    },
    klog: (event, payload) => {
      klogEvents.push({ event, payload });
    },
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    isHoleCardsTableMissing,
  });
};

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  const postCalls = [];
  const klogEvents = [];
  const handler = makeStatefulHandler({ postCalls, klogEvents });

  const firstResponse = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(firstResponse.statusCode, 200);
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].txType, "TABLE_CASH_OUT");
  assert.equal(postCalls[0].idempotencyKey, `poker:timeout_cashout:${tableId}:${userId}:${seatNo}:v1`);
  assert.deepEqual(postCalls[0].entries, [
    { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -124 },
    { accountType: "USER", amount: 124 },
  ]);
  assert.equal(postCalls[0].metadata?.reason, "timeout_inactive");
  assert.equal(postCalls[0].metadata?.stackSource, "state");

  assert.ok(
    klogEvents.some((e) => e.event === "poker_timeout_cashout_ok" && e.payload?.amount === 124 && e.payload?.stackSource === "state"),
    "sweep should log timeout cashout using authoritative state stack"
  );

  const secondResponse = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(secondResponse.statusCode, 200);
  assert.equal(postCalls.length, 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
