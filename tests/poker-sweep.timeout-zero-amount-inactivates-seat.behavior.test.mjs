import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "12121212-1212-4212-8212-121212121212";
const userId = "34343434-3434-4434-8434-343434343434";
const seatNo = 5;

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const queries = [];
  const postCalls = [];

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 21600,
    isHoleCardsTableMissing,
    isValidUuid: () => true,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ text, params });
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()") && !text.includes("for update")) {
            return [{ table_id: tableId, user_id: userId, seat_no: seatNo, stack: 0, last_seen_at: new Date(0) }];
          }
          if (text.includes("from public.poker_seats") && text.includes("for update") && text.includes("last_seen_at")) {
            return [{ seat_no: seatNo, status: "ACTIVE", stack: 0, last_seen_at: new Date(0), is_bot: false }];
          }
          if (text.includes("from public.poker_state") && text.includes("for update")) {
            return [{ state: JSON.stringify({ stacks: { [userId]: 0 } }) }];
          }
          if (text.includes("update public.poker_seats set status = 'inactive', stack = 0 where table_id = $1 and user_id = $2")) {
            return [];
          }
          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
          if (text.includes("update public.poker_tables t")) return [];
          if (text.includes("delete from public.poker_hole_cards")) return [];
          if (text.includes("from public.chips_accounts a")) return [];
          return [];
        },
      }),
    postTransaction: async (payload) => {
      postCalls.push(payload);
      return { transaction: { id: "tx" } };
    },
    postHandSettlementToLedger: async () => ({ count: 0, total: 0 }),
    klog: () => {},
  });

  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(postCalls.length, 0, "amount=0 should not post TABLE_CASH_OUT");
  assert.ok(
    queries.some((q) => q.text.includes("update public.poker_seats set status = 'inactive', stack = 0 where table_id = $1 and user_id = $2")),
    "expired human seat should be inactivated even when amount is zero"
  );
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
