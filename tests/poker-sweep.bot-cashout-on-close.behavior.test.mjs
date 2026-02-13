import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "22222222-2222-4222-8222-222222222222";
const botA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const postCalls = [];
  const botSeats = new Map([
    [botA, { seat_no: 1, status: "INACTIVE", stack: 120, is_bot: true, user_id: botA }],
    [botB, { seat_no: 4, status: "INACTIVE", stack: 80, is_bot: true, user_id: botB }],
  ]);

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 21600,
    isHoleCardsTableMissing,
    isValidUuid: () => true,
    getBotConfig: () => ({ bankrollSystemKey: "TREASURY" }),
    cashoutBotSeatIfNeeded: async (tx, args) => {
      const seat = botSeats.get(args.botUserId);
      const amount = Number(seat?.stack || 0);
      if (amount > 0) {
        postCalls.push({
          txType: "TABLE_CASH_OUT",
          idempotencyKey: `bot-cashout:${args.tableId}:${args.seatNo}:SWEEP_CLOSE:${args.idempotencyKeySuffix}`,
          entries: [
            { accountType: "ESCROW", systemKey: `POKER_TABLE:${args.tableId}`, amount: -amount },
            { accountType: "SYSTEM", systemKey: args.bankrollSystemKey, amount },
          ],
        });
      }
      if (seat) seat.stack = 0;
      await tx.unsafe("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2;", [args.tableId, args.botUserId]);
      return { ok: true, amount };
    },
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
          if (text.includes("select seat_no, status, stack, user_id, is_bot")) return Array.from(botSeats.values());
          if (text.includes("select version, state from public.poker_state")) {
            return [{ version: 7, state: JSON.stringify({ tableId, stacks: { [botA]: 120, [botB]: 80 } }) }];
          }
          if (text.includes("select user_id, seat_no, status, is_bot, stack from public.poker_seats") && text.includes("for update")) {
            const userId = params?.[1];
            const row = botSeats.get(userId);
            return row ? [row] : [];
          }
          if (text.includes("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2")) {
            const userId = params?.[1];
            const row = botSeats.get(userId);
            if (row) row.stack = 0;
            return [];
          }
          if (text.includes("update public.poker_seats set status = 'inactive', stack = 0")) {
            const seat = params?.[1];
            for (const row of botSeats.values()) {
              if (row.seat_no === seat) row.status = "INACTIVE";
            }
            return [];
          }
          if (text.includes("update public.poker_state set state = $2 where table_id = $1")) return [];
          if (text.includes("update public.poker_tables t")) return [{ id: tableId }];
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

  const first = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(first.statusCode, 200);
  assert.equal(postCalls.length, 2);
  assert.equal(postCalls[0].idempotencyKey, `bot-cashout:${tableId}:1:SWEEP_CLOSE:close_cashout:v1:7`);
  assert.equal(postCalls[1].idempotencyKey, `bot-cashout:${tableId}:4:SWEEP_CLOSE:close_cashout:v1:7`);
  assert.equal(postCalls[0].entries[0].amount, -120);
  assert.equal(postCalls[1].entries[0].amount, -80);

  const second = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(second.statusCode, 200);
  assert.equal(postCalls.length, 2, "replay should not issue extra cashouts once stacks are zero");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
