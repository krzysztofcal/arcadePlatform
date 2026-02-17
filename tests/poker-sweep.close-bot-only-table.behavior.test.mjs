import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "33333333-3333-4333-8333-333333333333";
const botA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const buildScenario = ({ tableActivityAgeSec }) => {
  const queries = [];
  const postCalls = [];
  const TABLE_BOT_ONLY_CLOSE_SEC = 10;
  const seats = new Map([
    [botA, { seat_no: 2, status: "ACTIVE", stack: 120, is_bot: true, user_id: botA }],
    [botB, { seat_no: 6, status: "ACTIVE", stack: 80, is_bot: true, user_id: botB }],
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
      const seat = seats.get(args.botUserId);
      const amount = Number(seat?.stack || 0);
      if (amount > 0) {
        postCalls.push({ botUserId: args.botUserId, amount });
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
          if (text.includes("with bot_only_tables as")) {
            const thresholdSec = Number(params?.[0] ?? TABLE_BOT_ONLY_CLOSE_SEC);
            const hasActiveHuman = false;
            const hasActiveBot = true;
            const shouldClose = tableActivityAgeSec > thresholdSec && !hasActiveHuman && hasActiveBot;
            return shouldClose ? [{ id: tableId }] : [];
          }
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = any")) {
            for (const row of seats.values()) row.status = "INACTIVE";
            return [];
          }
          if (text.includes("select t.id") && text.includes("stack > 0")) {
            const hasPositiveStack = Array.from(seats.values()).some((row) => Number(row.stack || 0) > 0);
            const hasActiveSeat = Array.from(seats.values()).some((row) => row.status === "ACTIVE");
            return hasPositiveStack && !hasActiveSeat ? [{ id: tableId }] : [];
          }
          if (text.includes("select seat_no, status, stack, user_id, is_bot")) {
            return Array.from(seats.values());
          }
          if (text.includes("select state from public.poker_state")) {
            return [{ state: JSON.stringify({ tableId, stacks: { [botA]: 120, [botB]: 80 } }) }];
          }
          if (text.includes("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2")) {
            const userId = params?.[1];
            const row = seats.get(userId);
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

  return { handler, queries, postCalls };
};

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const recent = buildScenario({ tableActivityAgeSec: 5 });
  const recentRun = await recent.handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(recentRun.statusCode, 200);
  assert.equal(recent.postCalls.length, 0, "recent last_activity_at should block bot-only close cashout");

  const botOnlyCloseQuery = recent.queries.find((entry) => entry.text.includes("with bot_only_tables as"));
  assert.ok(botOnlyCloseQuery, "expected bot-only close candidate query");
  assert.equal(botOnlyCloseQuery.text.includes("coalesce(t.last_activity_at, t.created_at)"), true);
  assert.equal(botOnlyCloseQuery.text.includes("t.updated_at"), false);

  const stale = buildScenario({ tableActivityAgeSec: 999 });
  const first = await stale.handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(first.statusCode, 200);
  assert.equal(stale.postCalls.length, 2, "stale bot-only table should close and cash out both bots");

  const second = await stale.handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(second.statusCode, 200);
  assert.equal(stale.postCalls.length, 2, "replay should not issue extra cashouts once stacks are zero");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
