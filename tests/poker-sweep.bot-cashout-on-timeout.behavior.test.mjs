import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "66666666-6666-4666-8666-666666666666";
const botUserId = "77777777-7777-4777-8777-777777777777";
const seatNo = 2;

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const postCalls = [];
  const helperCalls = [];
  const queries = [];
  const db = {
    seatStatus: "ACTIVE",
    seatStack: 150,
    stateVersion: 7,
    stacks: { [botUserId]: 150 },
  };

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 21600,
    isHoleCardsTableMissing,
    isValidUuid: (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")),
    getBotConfig: () => ({ bankrollSystemKey: "TREASURY" }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push(text);
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()") && !text.includes("for update")) {
            if (db.seatStatus !== "ACTIVE") return [];
            return [{ table_id: tableId, user_id: botUserId, seat_no: seatNo, stack: db.seatStack, last_seen_at: new Date(0) }];
          }
          if (text.includes("from public.poker_seats") && text.includes("for update") && text.includes("last_seen_at")) {
            if (db.seatStatus !== "ACTIVE") return [];
            return [{ seat_no: seatNo, status: db.seatStatus, stack: db.seatStack, last_seen_at: new Date(0), is_bot: true }];
          }
          if (text.includes("from public.poker_state") && text.includes("for update")) {
            return [{ version: db.stateVersion, state: JSON.stringify({ stacks: { ...db.stacks } }) }];
          }
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = $1 and user_id = $2")) {
            db.seatStatus = "INACTIVE";
            return [];
          }
          if (text.includes("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2")) {
            db.seatStack = 0;
            return [];
          }
          if (text.includes("update public.poker_state set state = $2 where table_id = $1")) {
            const next = JSON.parse(params?.[1] || "{}");
            db.stacks = next?.stacks && typeof next.stacks === "object" ? { ...next.stacks } : {};
            return [];
          }
          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
          if (text.includes("update public.poker_tables t")) return [];
          if (text.includes("delete from public.poker_hole_cards")) return [];
          if (text.includes("from public.chips_accounts")) return [];
          return [];
        },
      }),
    ensureBotSeatInactiveForCashout: async (tx, args) => {
      helperCalls.push({ phase: "ensure_inactive", ...args });
      await tx.unsafe("update public.poker_seats set status = 'INACTIVE' where table_id = $1 and user_id = $2;", [args.tableId, args.botUserId]);
      return { ok: true, changed: true, seatNo };
    },
    cashoutBotSeatIfNeeded: async (tx, args) => {
      helperCalls.push({ phase: "cashout", ...args });
      const amount = db.seatStack;
      if (amount > 0) {
        postCalls.push({
          txType: "TABLE_CASH_OUT",
          idempotencyKey: `bot-cashout:${args.tableId}:${args.botUserId}:${args.seatNo}:SWEEP_TIMEOUT:${args.idempotencyKeySuffix}`,
          entries: [
            { accountType: "ESCROW", systemKey: `POKER_TABLE:${args.tableId}`, amount: -amount },
            { accountType: "SYSTEM", systemKey: args.bankrollSystemKey, amount },
          ],
        });
      }
      await tx.unsafe("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2;", [args.tableId, args.botUserId]);
      return { ok: true, cashedOut: amount > 0, amount, seatNo: args.seatNo };
    },
    postTransaction: async () => ({ transaction: { id: "tx-timeout" } }),
    postHandSettlementToLedger: async () => ({ count: 0, total: 0 }),
    klog: () => {},
  });

  const first = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(first.statusCode, 200);
  assert.equal(postCalls.length, 1);
  assert.equal(helperCalls.filter((c) => c.phase === "cashout").length, 1);
  assert.equal(helperCalls.filter((c) => c.phase === "ensure_inactive").length, 1);
  const statusUpdateIdx = queries.findIndex((q) => q.includes("update public.poker_seats set status = 'inactive' where table_id = $1 and user_id = $2"));
  const stackUpdateIdx = queries.findIndex((q) => q.includes("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2"));
  assert.ok(statusUpdateIdx >= 0, "should set bot seat INACTIVE before bot timeout cashout");
  assert.ok(stackUpdateIdx > statusUpdateIdx, "stack zeroing must occur after status INACTIVE transition");
  assert.equal(postCalls[0].idempotencyKey, `bot-cashout:${tableId}:${botUserId}:${seatNo}:SWEEP_TIMEOUT:timeout_cashout:v1`);
  assert.deepEqual(postCalls[0].entries, [
    { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -150 },
    { accountType: "SYSTEM", systemKey: "TREASURY", amount: 150 },
  ]);

  const second = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(second.statusCode, 200);
  assert.equal(postCalls.length, 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
