import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "efefefef-3333-4333-8333-333333333333";
const botUserId = "abababab-4444-4444-8444-444444444444";

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  let seatStatus = "ACTIVE";
  let cashoutCalls = 0;
  const queries = [];

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 21600,
    isHoleCardsTableMissing,
    isValidUuid: () => true,
    ensureBotSeatInactiveForCashout: async () => {
      seatStatus = "INACTIVE";
      return { ok: true, changed: true, seatNo: 6 };
    },
    cashoutBotSeatIfNeeded: async () => {
      cashoutCalls += 1;
      return { ok: true, cashedOut: true, amount: 40, seatNo: 6 };
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          queries.push(text);
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("with singleton_tables as")) return [{ id: tableId }];
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = any")) return [];
          if (text.includes("select t.id") && text.includes("stack > 0")) return [{ id: tableId }];
          if (text.includes("select seat_no, status, stack, user_id, is_bot")) {
            return [{ seat_no: 6, status: "ACTIVE", stack: 40, user_id: botUserId, is_bot: true }];
          }
          if (text.includes("from public.poker_state") && text.includes("for update")) return [{ state: JSON.stringify({ stacks: { [botUserId]: 40 } }) }];
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = $1 and user_id = $2 and is_bot = true")) return [];
          if (text.includes("select status, stack, seat_no from public.poker_seats where table_id = $1 and user_id = $2 and is_bot = true limit 1 for update")) {
            return [{ status: seatStatus, stack: 40, seat_no: 6 }];
          }
          if (text.includes("update public.poker_state set state = $2 where table_id = $1")) return [];
          if (text.includes("update public.poker_tables t")) return [];
          if (text.includes("delete from public.poker_hole_cards")) return [];
          if (text.includes("from public.chips_accounts a")) return [];
          return [];
        },
      }),
    postTransaction: async () => ({ transaction: { id: "tx" } }),
    postHandSettlementToLedger: async () => ({ count: 0, total: 0 }),
    klog: () => {},
  });

  const res = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(res.statusCode, 200);
  assert.equal(cashoutCalls, 1, "cashout should proceed after status re-check shows inactive");
  assert.ok(queries.some((q) => q.includes("update public.poker_seats set status = 'inactive' where table_id = $1 and user_id = $2 and is_bot = true")));
  assert.ok(queries.some((q) => q.includes("select status, stack, seat_no from public.poker_seats where table_id = $1 and user_id = $2 and is_bot = true limit 1 for update")));
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
