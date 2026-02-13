import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "55555555-5555-4555-8555-555555555555";
const botId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const seatNo = 4;

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "not-a-uuid";

  const queries = [];
  let botCashoutCalls = 0;

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 21600,
    isHoleCardsTableMissing,
    isValidUuid: () => false,
    ensureBotSeatInactiveForCashout: async (tx, args) => {
      await tx.unsafe("update public.poker_seats set status = 'INACTIVE' where table_id = $1 and user_id = $2 and is_bot = true;", [args.tableId, args.botUserId]);
      return { ok: true, changed: true, seatNo };
    },
    cashoutBotSeatIfNeeded: async () => {
      botCashoutCalls += 1;
      return { ok: true, amount: 20 };
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ text, params });
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
          if (text.includes("update public.poker_state set state = $2 where table_id = $1")) return [];
          if (text.includes("update public.poker_tables t")) return [{ id: tableId }];
          if (text.includes("delete from public.poker_hole_cards")) return [];
          if (text.includes("from public.chips_accounts a")) return [];
          return [];
        },
      }),
    postTransaction: async () => ({ transaction: { id: "tx" } }),
    postHandSettlementToLedger: async () => ({ count: 0, total: 0 }),
    klog: () => {},
  });

  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(botCashoutCalls, 0);
  assert.equal(
    queries.some((q) => q.text.includes("update public.poker_seats set status = 'inactive' where table_id = $1 and user_id = $2 and is_bot = true")),
    true
  );
  assert.equal(queries.some((q) => q.text.includes("update public.poker_state set state = $2 where table_id = $1")), false);
  assert.equal(
    queries.some((q) => q.text.includes("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2")),
    false
  );
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
