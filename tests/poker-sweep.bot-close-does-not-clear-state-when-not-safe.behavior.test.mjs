import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "33333333-3333-4333-8333-333333333333";
const botId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const seatNo = 2;

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const stateUpdateCalls = [];

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 21600,
    isHoleCardsTableMissing,
    isValidUuid: () => true,
    cashoutBotSeatIfNeeded: async () => ({
      ok: true,
      skipped: true,
      reason: "active_seat",
      amount: 0,
      seatNo,
    }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("with singleton_tables as")) return [{ id: tableId }];
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = any")) return [];
          if (text.includes("select t.id") && text.includes("stack > 0")) return [{ id: tableId }];
          if (text.includes("select seat_no, status, stack, user_id, is_bot")) {
            return [{ seat_no: seatNo, status: "INACTIVE", stack: 0, user_id: botId, is_bot: true }];
          }
          if (text.includes("select state from public.poker_state")) {
            return [{ state: JSON.stringify({ tableId, stacks: { [botId]: 0 } }) }];
          }
          if (text.includes("update public.poker_state set state = $2 where table_id = $1")) {
            stateUpdateCalls.push(params?.[1]);
            return [];
          }
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = $1 and seat_no = $2")) return [];
          if (text.includes("update public.poker_seats set status = 'inactive', stack = 0 where table_id = $1 and seat_no = $2")) return [];
          if (text.includes("update public.poker_tables t")) return [{ id: tableId }];
          if (text.includes("delete from public.poker_hole_cards")) return [];
          if (text.includes("from public.chips_accounts a")) return [];
          return [];
        },
      }),
    postTransaction: async () => {
      throw new Error("should_not_post_human_cashout");
    },
    postHandSettlementToLedger: async () => ({ count: 0, total: 0 }),
    klog: () => {},
  });

  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(stateUpdateCalls.length, 0, "bot unsafe close-cashout must not clear poker_state stack via normalizedStack===0 path");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
