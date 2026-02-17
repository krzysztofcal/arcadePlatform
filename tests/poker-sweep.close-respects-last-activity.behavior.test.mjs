import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const staleTable = "11111111-1111-4111-8111-111111111111";
const recentTable = "22222222-2222-4222-8222-222222222222";
const nullActivityTable = "33333333-3333-4333-8333-333333333333";

const botByTable = {
  [staleTable]: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  [recentTable]: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  [nullActivityTable]: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const TABLE_BOT_ONLY_CLOSE_SEC = 10;
  const queries = [];
  const postCalls = [];
  const scenario = new Map([
    [staleTable, { activityAgeSec: 40, createdAgeSec: 120, hasLastActivity: true, stack: 50, active: true }],
    [recentTable, { activityAgeSec: 5, createdAgeSec: 120, hasLastActivity: true, stack: 60, active: true }],
    [nullActivityTable, { activityAgeSec: null, createdAgeSec: 120, hasLastActivity: false, stack: 70, active: true }],
  ]);

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 9999,
    TABLE_SINGLETON_CLOSE_SEC: 9999,
    TABLE_BOT_ONLY_CLOSE_SEC,
    isHoleCardsTableMissing,
    isValidUuid: () => true,
    ensureBotSeatInactiveForCashout: async () => ({ ok: true, changed: true }),
    cashoutBotSeatIfNeeded: async (tx, args) => {
      const table = scenario.get(args.tableId);
      const amount = Number(table?.stack || 0);
      if (amount > 0) postCalls.push({ tableId: args.tableId, amount });
      if (table) table.stack = 0;
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
          if (text.includes("with bot_only_tables as")) {
            const thresholdSec = Number(params?.[0] ?? TABLE_BOT_ONLY_CLOSE_SEC);
            const closable = [];
            for (const [tableId, row] of scenario.entries()) {
              const activityAge = row.hasLastActivity ? row.activityAgeSec : row.createdAgeSec;
              if (activityAge > thresholdSec && row.active) closable.push({ id: tableId });
            }
            return closable;
          }
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = any")) {
            const ids = params?.[0] || [];
            for (const id of ids) {
              const row = scenario.get(id);
              if (row) row.active = false;
            }
            return [];
          }
          if (text.includes("select t.id") && text.includes("stack > 0")) {
            const ids = [];
            for (const [tableId, row] of scenario.entries()) {
              if (!row.active && row.stack > 0) ids.push({ id: tableId });
            }
            return ids;
          }
          if (text.includes("select seat_no, status, stack, user_id, is_bot")) {
            const row = scenario.get(params?.[0]);
            const botUserId = botByTable[params?.[0]];
            return row
              ? [{ seat_no: 1, status: row.active ? "ACTIVE" : "INACTIVE", stack: row.stack, user_id: botUserId, is_bot: true }]
              : [];
          }
          if (text.includes("select state from public.poker_state")) {
            const tableId = params?.[0];
            const row = scenario.get(tableId);
            const botUserId = botByTable[tableId];
            return [{ state: JSON.stringify({ tableId, stacks: { [botUserId]: row?.stack || 0 } }) }];
          }
          if (text.includes("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2")) {
            const row = scenario.get(params?.[0]);
            if (row) row.stack = 0;
            return [];
          }
          if (text.includes("update public.poker_state set state = $2 where table_id = $1")) return [];
          if (text.includes("update public.poker_tables t\nset status = 'closed', updated_at = now()\nwhere t.status != 'closed'")) return [];
          if (text.includes("delete from public.poker_hole_cards")) return [];
          if (text.includes("from public.chips_accounts")) return [];
          return [];
        },
      }),
    postTransaction: async () => {
      throw new Error("unexpected_human_cashout");
    },
    postHandSettlementToLedger: async () => {},
    klog: () => {},
  });

  const first = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(
    postCalls.map((c) => c.tableId).sort(),
    [nullActivityTable, staleTable].sort(),
    "stale last_activity_at and null-last_activity-old-created tables should close; recent should not"
  );

  const second = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(second.statusCode, 200);
  assert.equal(postCalls.length, 2, "second sweep run should be idempotent with no extra cashouts");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
