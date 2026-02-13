import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "abababab-1111-4111-8111-111111111111";
const botUserId = "cdcdcdcd-2222-4222-8222-222222222222";
const seatNo = 3;

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const queries = [];
  let seatStatus = "ACTIVE";
  let stack = 0;
  let cashoutCalls = 0;

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 21600,
    isHoleCardsTableMissing,
    isValidUuid: () => true,
    ensureBotSeatInactiveForCashout: async () => ({ ok: true, changed: false, seatNo }),
    cashoutBotSeatIfNeeded: async () => {
      cashoutCalls += 1;
      assert.equal(seatStatus, "INACTIVE", "seat should be forced inactive before bot cashout");
      return { ok: true, skipped: true, reason: "non_positive_stack", amount: 0, seatNo };
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ text, params });
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()") && !text.includes("for update")) {
            if (seatStatus !== "ACTIVE") return [];
            return [{ table_id: tableId, user_id: botUserId, seat_no: seatNo, stack, last_seen_at: new Date(0) }];
          }
          if (text.includes("from public.poker_seats") && text.includes("for update") && text.includes("last_seen_at")) {
            if (seatStatus !== "ACTIVE") return [];
            return [{ seat_no: seatNo, status: seatStatus, stack, last_seen_at: new Date(0), is_bot: true }];
          }
          if (text.includes("from public.poker_state") && text.includes("for update")) return [{ state: JSON.stringify({ stacks: { [botUserId]: 0 } }) }];
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = $1 and user_id = $2 and is_bot = true")) {
            seatStatus = "INACTIVE";
            return [];
          }
          if (text.includes("select status, seat_no from public.poker_seats where table_id = $1 and user_id = $2 and is_bot = true limit 1 for update")) {
            return [{ status: seatStatus, seat_no: seatNo }];
          }
          if (text.includes("update public.poker_state set state = $2 where table_id = $1")) return [];
          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
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
  assert.equal(cashoutCalls, 1, "cashout should run only after forced inactive update");
  const forceInactiveIdx = queries.findIndex((q) => q.text.includes("update public.poker_seats set status = 'inactive' where table_id = $1 and user_id = $2 and is_bot = true"));
  assert.ok(forceInactiveIdx >= 0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
