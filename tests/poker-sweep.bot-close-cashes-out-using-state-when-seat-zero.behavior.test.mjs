import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "98989898-9898-4989-8989-989898989898";
const botUserId = "77777777-7777-4777-8777-777777777777";

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const postCalls = [];
  const state = { stacks: { [botUserId]: 125 } };
  const botSeat = { seat_no: 2, status: "ACTIVE", stack: 0, user_id: botUserId, is_bot: true };

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 21600,
    isHoleCardsTableMissing,
    isValidUuid: () => true,
    ensureBotSeatInactiveForCashout: async (tx, args) => {
      await tx.unsafe("update public.poker_seats set status = 'INACTIVE' where table_id = $1 and user_id = $2 and is_bot = true;", [args.tableId, args.botUserId]);
      botSeat.status = "INACTIVE";
      return { ok: true, changed: true, seatNo: botSeat.seat_no };
    },
    cashoutBotSeatIfNeeded: async (tx, args) => {
      const amount = Number(args.expectedAmount || 0);
      if (amount > 0) {
        postCalls.push({ amount, entries: [{ accountType: "ESCROW", amount: -amount }, { accountType: "USER", amount }] });
      }
      await tx.unsafe("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2;", [args.tableId, args.botUserId]);
      botSeat.stack = 0;
      return { ok: true, cashedOut: amount > 0, amount, seatNo: args.seatNo };
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("with singleton_tables as")) {
            return state.stacks[botUserId] > 0 ? [{ id: tableId }] : [];
          }
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = any")) return [];
          if (text.includes("select t.id") && text.includes("stack > 0")) {
            return state.stacks[botUserId] > 0 ? [{ id: tableId }] : [];
          }
          if (text.includes("select seat_no, status, stack, user_id, is_bot")) return [botSeat];
          if (text.includes("select state from public.poker_state")) return [{ state: JSON.stringify({ tableId, stacks: { ...state.stacks } }) }];
          if (text.includes("select status, stack, seat_no from public.poker_seats where table_id = $1 and user_id = $2 and is_bot = true limit 1 for update")) {
            return [{ status: botSeat.status, stack: botSeat.stack, seat_no: botSeat.seat_no }];
          }
          if (text.includes("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2")) {
            botSeat.stack = 0;
            return [];
          }
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = $1 and user_id = $2 and is_bot = true")) {
            botSeat.status = "INACTIVE";
            return [];
          }
          if (text.includes("update public.poker_state set state = $2 where table_id = $1")) {
            const next = JSON.parse(params?.[1] || "{}");
            state.stacks = next?.stacks && typeof next.stacks === "object" ? { ...next.stacks } : {};
            return [];
          }
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

  const first = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(first.statusCode, 200);
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].amount, 125);
  assert.equal(Object.prototype.hasOwnProperty.call(state.stacks, botUserId), false);

  const second = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(second.statusCode, 200);
  assert.equal(postCalls.length, 1, "table should not be re-cashed once state stack is cleared");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
