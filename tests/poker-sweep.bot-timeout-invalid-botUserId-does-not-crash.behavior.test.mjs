import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "11111111-2222-4333-8444-555555555555";
const badBotUserId = "not-a-uuid";
const seatNo = 5;

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const postCalls = [];
  const queries = [];
  const logs = [];
  let seatStatus = "ACTIVE";

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 21600,
    isHoleCardsTableMissing,
    isValidUuid: (value) => value !== "not-a-uuid",
    ensureBotSeatInactiveForCashout: async (tx, args) => {
      await tx.unsafe("update public.poker_seats set status = 'INACTIVE' where table_id = $1 and user_id = $2 and is_bot = true;", [args.tableId, args.botUserId]);
      seatStatus = "INACTIVE";
      return { ok: true, changed: true, seatNo };
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ text, params });
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()") && !text.includes("for update")) {
            return [{ table_id: tableId, user_id: badBotUserId, seat_no: seatNo, stack: 50, last_seen_at: new Date(0) }];
          }
          if (text.includes("from public.poker_seats") && text.includes("for update") && text.includes("last_seen_at")) {
            return [{ seat_no: seatNo, status: "ACTIVE", stack: 50, last_seen_at: new Date(0), is_bot: true }];
          }
          if (text.includes("from public.poker_state") && text.includes("for update")) {
            return [{ state: JSON.stringify({ stacks: { [badBotUserId]: 50 } }) }];
          }
          if (text.includes("select status, seat_no from public.poker_seats where table_id = $1 and user_id = $2 and is_bot = true limit 1 for update")) {
            return [{ status: seatStatus, seat_no: seatNo }];
          }
          if (text.includes("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2")) return [];
          if (text.includes("update public.poker_state set state = $2 where table_id = $1")) return [];
          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
          if (text.includes("with singleton_tables as")) return [];
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
    klog: (name, payload) => logs.push({ name, payload }),
  });

  const res = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(res.statusCode, 200);
  assert.equal(postCalls.length, 0);
  assert.equal(queries.some((q) => q.text.includes("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2")), false);
  assert.equal(queries.some((q) => q.text.includes("update public.poker_state set state = $2 where table_id = $1")), false);
  assert.ok(logs.some((entry) => entry.name === "poker_timeout_cashout_bot_fail" && String(entry.payload?.error || "").includes("invalid_bot_user_id")));
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
