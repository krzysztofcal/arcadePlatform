import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "33333333-3333-4333-8333-333333333333";
const botA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const human = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const buildScenario = ({ includeHumanSeat, humanSeatStatus = "INACTIVE", tableActivityAgeSec }) => {
  const queries = [];
  const postCalls = [];
  const TABLE_BOT_ONLY_CLOSE_SEC = 10;
  const seats = new Map([
    [botA, { seat_no: 2, status: "ACTIVE", stack: 120, is_bot: true, user_id: botA }],
    [botB, { seat_no: 6, status: "ACTIVE", stack: 80, is_bot: true, user_id: botB }],
  ]);
  if (includeHumanSeat) {
    seats.set(human, { seat_no: 1, status: humanSeatStatus, stack: 0, is_bot: false, user_id: human });
  }

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
            const hasActiveHuman = Array.from(seats.values()).some((row) => row.is_bot !== true && row.status === "ACTIVE");
            const hasActiveBot = Array.from(seats.values()).some((row) => row.is_bot === true && row.status === "ACTIVE");
            const shouldClose = tableActivityAgeSec > thresholdSec && !hasActiveHuman && hasActiveBot;
            return shouldClose ? [{ id: tableId }] : [];
          }
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = any")) {
            for (const row of seats.values()) {
              if (row.status === "ACTIVE") row.status = "INACTIVE";
            }
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

const assertBotCashoutOrdering = (queries) => {
  const statusUpdateIndex = queries.findIndex((entry) =>
    entry.text.includes("update public.poker_seats set status = 'inactive' where table_id = any")
  );
  assert.ok(statusUpdateIndex >= 0, "expected seat inactivation before cashout stage");
  for (const botUserId of [botA, botB]) {
    const stackUpdateIndex = queries.findIndex(
      (entry) =>
        entry.text.includes("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2") &&
        entry.params?.[1] === botUserId
    );
    assert.ok(stackUpdateIndex > statusUpdateIndex, `expected stack zeroing after inactivation for ${botUserId}`);
  }
};

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const recent = buildScenario({ includeHumanSeat: false, tableActivityAgeSec: 5 });
  const recentRun = await recent.handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(recentRun.statusCode, 200);
  assert.equal(recent.postCalls.length, 0, "recent last_activity_at should block bot-only close cashout");

  const botOnlyCloseQuery = recent.queries.find((entry) => entry.text.includes("with bot_only_tables as"));
  assert.ok(botOnlyCloseQuery, "expected bot-only close candidate query");
  assert.equal(botOnlyCloseQuery.text.includes("coalesce(t.last_activity_at, t.created_at)"), true);
  assert.equal(botOnlyCloseQuery.text.includes("t.updated_at"), false);
  assert.equal(botOnlyCloseQuery.text.includes("not exists (") && botOnlyCloseQuery.text.includes("coalesce(hs.is_bot, false) = false"), true);

  const activeHuman = buildScenario({ includeHumanSeat: true, humanSeatStatus: "ACTIVE", tableActivityAgeSec: 999 });
  const activeHumanRun = await activeHuman.handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(activeHumanRun.statusCode, 200);
  assert.equal(activeHuman.postCalls.length, 0, "active human seat should block bot-only close");

  const inactiveHuman = buildScenario({ includeHumanSeat: true, humanSeatStatus: "INACTIVE", tableActivityAgeSec: 999 });
  const inactiveHumanFirst = await inactiveHuman.handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(inactiveHumanFirst.statusCode, 200);
  assert.equal(inactiveHuman.postCalls.length, 2, "inactive human history should still allow stale bot-only close");
  assertBotCashoutOrdering(inactiveHuman.queries);
  const inactiveHumanSecond = await inactiveHuman.handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(inactiveHumanSecond.statusCode, 200);
  assert.equal(inactiveHuman.postCalls.length, 2, "second run should be idempotent with no extra bot cashout");

  const noHumanHistory = buildScenario({ includeHumanSeat: false, tableActivityAgeSec: 999 });
  const noHumanFirst = await noHumanHistory.handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(noHumanFirst.statusCode, 200);
  assert.equal(noHumanHistory.postCalls.length, 2, "bot-only table with stale activity should close");
  assertBotCashoutOrdering(noHumanHistory.queries);
  const noHumanSecond = await noHumanHistory.handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(noHumanSecond.statusCode, 200);
  assert.equal(noHumanHistory.postCalls.length, 2, "no-human-history replay should be idempotent");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
