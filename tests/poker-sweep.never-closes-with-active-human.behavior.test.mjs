import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "99999999-9999-4999-8999-999999999999";

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const calls = {
    closeTable: 0,
    inactivateSeats: 0,
    closeCashout: 0,
  };

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 1,
    TABLE_SINGLETON_CLOSE_SEC: 1,
    TABLE_BOT_ONLY_CLOSE_SEC: 1,
    isValidUuid: () => true,
    isHoleCardsTableMissing: () => false,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("with singleton_tables as")) return [];
          if (text.includes("with bot_only_tables as")) return [];
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = any")) {
            calls.inactivateSeats += 1;
            return [];
          }
          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
          if (text.includes("update public.poker_tables t") && text.includes("set status = 'closed'")) {
            calls.closeTable += 1;
            return [];
          }
          if (text.includes("select seat_no, status, stack, user_id, is_bot")) {
            calls.closeCashout += 1;
            return [{ seat_no: 1, status: "ACTIVE", stack: 100, user_id: "human", is_bot: false }];
          }
          return [];
        },
      }),
    postTransaction: async () => {
      calls.closeCashout += 1;
      return { transaction: { id: "tx" } };
    },
    postHandSettlementToLedger: async () => {},
    cashoutBotSeatIfNeeded: async () => {
      calls.closeCashout += 1;
      return { ok: true, cashedOut: false, amount: 0 };
    },
    ensureBotSeatInactiveForCashout: async () => ({ ok: true, changed: true }),
    klog: () => {},
  });

  const res = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.inactivateSeats, 0);
  assert.equal(calls.closeCashout, 0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
