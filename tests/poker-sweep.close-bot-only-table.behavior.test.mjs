import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "33333333-3333-4333-8333-333333333333";
const botA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const postCalls = [];
  const queries = [];
  const botSeats = new Map([
    [botA, { seat_no: 2, status: "ACTIVE", stack: 120, is_bot: true, user_id: botA }],
    [botB, { seat_no: 6, status: "ACTIVE", stack: 80, is_bot: true, user_id: botB }],
  ]);

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 9999,
    TABLE_SINGLETON_CLOSE_SEC: 9999,
    TABLE_BOT_ONLY_CLOSE_SEC: 10,
    isHoleCardsTableMissing,
    isValidUuid: () => true,
    ensureBotSeatInactiveForCashout: async (tx, { tableId: tid, botUserId }) => {
      const row = botSeats.get(botUserId);
      if (!row) return { ok: false, skipped: true, reason: "seat_missing" };
      if (row.status === "INACTIVE") return { ok: true, changed: false, seatNo: row.seat_no };
      await tx.unsafe("update public.poker_seats set status = 'INACTIVE' where table_id = $1 and user_id = $2 and is_bot = true;", [tid, botUserId]);
      row.status = "INACTIVE";
      return { ok: true, changed: true, seatNo: row.seat_no };
    },
    cashoutBotSeatIfNeeded: async (tx, args) => {
      const seat = botSeats.get(args.botUserId);
      const amount = Number(seat?.stack || 0);
      if (amount > 0) {
        postCalls.push({
          txType: "TABLE_CASH_OUT",
          idempotencyKey: `bot-cashout:${args.tableId}:${args.botUserId}:${args.seatNo}:SWEEP_CLOSE:${args.idempotencyKeySuffix}`,
          entries: [
            { accountType: "ESCROW", systemKey: `POKER_TABLE:${args.tableId}`, amount: -amount },
            { accountType: "USER", amount },
          ],
        });
      }
      if (seat) seat.stack = 0;
      await tx.unsafe("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2;", [args.tableId, args.botUserId]);
      return { ok: true, cashedOut: amount > 0, amount, seatNo: args.seatNo };
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ text, params });
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("with singleton_tables as")) return [];
          if (text.includes("with bot_only_tables as")) return [{ id: tableId }];
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = any")) return [];
          if (text.includes("select t.id") && text.includes("stack > 0")) return [{ id: tableId }];
          if (text.includes("select seat_no, status, stack, user_id, is_bot")) return Array.from(botSeats.values());
          if (text.includes("select state from public.poker_state")) {
            return [{ state: JSON.stringify({ tableId, stacks: { [botA]: 120, [botB]: 80 } }) }];
          }
          if (text.includes("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2")) {
            const userId = params?.[1];
            const row = botSeats.get(userId);
            if (row) row.stack = 0;
            return [];
          }
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = $1 and user_id = $2 and is_bot = true")) {
            const userId = params?.[1];
            const row = botSeats.get(userId);
            if (row) row.status = "INACTIVE";
            return [];
          }
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
    klog: () => {},
  });

  const first = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(first.statusCode, 200);
  assert.equal(postCalls.length, 2);
  assert.equal(postCalls[0].idempotencyKey, `bot-cashout:${tableId}:${botA}:2:SWEEP_CLOSE:close_cashout:v1`);
  assert.equal(postCalls[1].idempotencyKey, `bot-cashout:${tableId}:${botB}:6:SWEEP_CLOSE:close_cashout:v1`);
  assert.deepEqual(postCalls[0].entries, [
    { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -120 },
    { accountType: "USER", amount: 120 },
  ]);
  assert.deepEqual(postCalls[1].entries, [
    { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -80 },
    { accountType: "USER", amount: 80 },
  ]);

  for (const botUserId of [botA, botB]) {
    const statusUpdateIdx = queries.findIndex(
      (entry) =>
        entry.text.includes("update public.poker_seats set status = 'inactive' where table_id = $1 and user_id = $2 and is_bot = true") &&
        entry.params?.[1] === botUserId
    );
    const stackUpdateIdx = queries.findIndex(
      (entry) =>
        entry.text.includes("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2") &&
        entry.params?.[1] === botUserId
    );
    assert.ok(statusUpdateIdx >= 0, `expected status inactivation query for ${botUserId}`);
    assert.ok(stackUpdateIdx > statusUpdateIdx, `expected stack cashout update after status inactivation for ${botUserId}`);
  }

  const second = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(second.statusCode, 200);
  assert.equal(postCalls.length, 2, "replay should not issue extra cashouts once stacks are zero");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
