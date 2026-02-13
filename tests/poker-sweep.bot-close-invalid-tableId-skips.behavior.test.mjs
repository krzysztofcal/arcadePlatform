import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "bad-table-id";
const botUserId = "33333333-3333-4333-8333-333333333333";

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const postCalls = [];
  const queries = [];
  const logs = [];
  const seat = { seat_no: 2, status: "ACTIVE", stack: 0, user_id: botUserId, is_bot: true };

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 21600,
    isHoleCardsTableMissing,
    isValidUuid: (value) => value !== "bad-table-id",
    ensureBotSeatInactiveForCashout: async (tx, args) => {
      await tx.unsafe("update public.poker_seats set status = 'INACTIVE' where table_id = $1 and user_id = $2 and is_bot = true;", [args.tableId, args.botUserId]);
      seat.status = "INACTIVE";
      return { ok: true, changed: true, seatNo: seat.seat_no };
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ text, params });
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) return [];
          if (text.includes("with singleton_tables as")) return [];
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = any")) return [];
          if (text.includes("select t.id") && text.includes("stack > 0")) return [{ id: tableId }];
          if (text.includes("select seat_no, status, stack, user_id, is_bot")) return [seat];
          if (text.includes("select state from public.poker_state")) return [{ state: JSON.stringify({ stacks: { [botUserId]: 75 } }) }];
          if (text.includes("select status, stack, seat_no from public.poker_seats where table_id = $1 and user_id = $2 and is_bot = true limit 1 for update")) {
            return [{ status: seat.status, stack: seat.stack, seat_no: seat.seat_no }];
          }
          if (text.includes("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2")) return [];
          if (text.includes("update public.poker_state set state = $2 where table_id = $1")) return [];
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
  assert.ok(logs.some((entry) => entry.name === "poker_close_cashout_fail" && String(entry.payload?.error || "").includes("invalid_table_id")));
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
