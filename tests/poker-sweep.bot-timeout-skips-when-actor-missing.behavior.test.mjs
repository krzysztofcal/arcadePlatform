import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "44444444-4444-4444-8444-444444444444";
const botId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const seatNo = 3;

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  delete process.env.POKER_SYSTEM_ACTOR_USER_ID;

  const logs = [];
  const queries = [];
  let botCashoutCalls = 0;
  let postCalls = 0;

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 1,
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
      return { ok: true, amount: 10 };
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ text, params });
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()") && !text.includes("for update")) {
            return [{ table_id: tableId, user_id: botId, seat_no: seatNo, stack: 50, last_seen_at: new Date(0) }];
          }
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_seats") && text.includes("for update") && text.includes("last_seen_at")) {
            return [{ seat_no: seatNo, status: "ACTIVE", stack: 50, last_seen_at: new Date(0), is_bot: true }];
          }
          if (text.includes("from public.poker_state") && text.includes("for update")) {
            return [{ state: JSON.stringify({ tableId, stacks: { [botId]: 50 } }) }];
          }
          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
          if (text.includes("update public.poker_tables t")) return [];
          if (text.includes("delete from public.poker_hole_cards")) return [];
          return [];
        },
      }),
    postTransaction: async () => {
      postCalls += 1;
      return { transaction: { id: "tx" } };
    },
    postHandSettlementToLedger: async () => ({ count: 0, total: 0 }),
    klog: (name, payload) => logs.push({ name, payload }),
  });

  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(botCashoutCalls, 0);
  assert.equal(postCalls, 0);
  assert.equal(
    queries.some((q) => q.text.includes("update public.poker_seats set status = 'inactive' where table_id = $1 and user_id = $2 and is_bot = true")),
    true
  );
  assert.equal(queries.some((q) => q.text.includes("update public.poker_state set state = $2 where table_id = $1")), false);
  assert.ok(logs.some((entry) => entry.name === "poker_timeout_cashout_bot_skip" && entry.payload?.reason === "missing_actor"));
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
