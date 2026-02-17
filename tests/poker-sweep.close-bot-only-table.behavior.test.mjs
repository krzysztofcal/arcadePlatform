import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "33333333-3333-4333-8333-333333333333";
const botA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const human = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const buildScenario = ({ humanLastActivityAgeSec, humanSeatStatus = "INACTIVE", includeHumanSeat = true }) => {
  const postCalls = [];
  const queries = [];
  const TABLE_BOT_ONLY_CLOSE_SEC = 10;
  const seats = new Map([
    [botA, { seat_no: 2, status: "ACTIVE", stack: 120, is_bot: true, user_id: botA }],
    [botB, { seat_no: 6, status: "ACTIVE", stack: 80, is_bot: true, user_id: botB }],
  ]);
  if (includeHumanSeat) {
    seats.set(human, { seat_no: 1, status: humanSeatStatus, stack: 0, is_bot: false, user_id: human });
  }

  const botRows = () => Array.from(seats.values()).filter((row) => row.is_bot === true);

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 9999,
    TABLE_SINGLETON_CLOSE_SEC: 9999,
    TABLE_BOT_ONLY_CLOSE_SEC,
    isHoleCardsTableMissing,
    isValidUuid: () => true,
    ensureBotSeatInactiveForCashout: async (tx, { tableId: tid, botUserId }) => {
      const row = seats.get(botUserId);
      if (!row) return { ok: false, skipped: true, reason: "seat_missing" };
      if (row.status === "INACTIVE") return { ok: true, changed: false, seatNo: row.seat_no };
      await tx.unsafe("update public.poker_seats set status = 'INACTIVE' where table_id = $1 and user_id = $2 and is_bot = true;", [tid, botUserId]);
      row.status = "INACTIVE";
      return { ok: true, changed: true, seatNo: row.seat_no };
    },
    cashoutBotSeatIfNeeded: async (tx, args) => {
      const seat = seats.get(args.botUserId);
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
          if (text.includes("with bot_only_tables as")) {
            const thresholdSec = Number(params?.[0] ?? TABLE_BOT_ONLY_CLOSE_SEC);
            const hasActiveHuman = Array.from(seats.values()).some((row) => row.is_bot !== true && row.status === "ACTIVE");
            const hasActiveBot = Array.from(seats.values()).some((row) => row.is_bot === true && row.status === "ACTIVE");
            const hasHumanHistory = Array.from(seats.values()).some((row) => row.is_bot !== true);
            const tableAgeSec = humanLastActivityAgeSec;
            const eligibleAgeSec = hasHumanHistory ? humanLastActivityAgeSec : tableAgeSec;
            const shouldClose = eligibleAgeSec > thresholdSec && !hasActiveHuman && hasActiveBot;
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
          if (text.includes("select seat_no, status, stack, user_id, is_bot")) return botRows();
          if (text.includes("select state from public.poker_state")) {
            return [{ state: JSON.stringify({ tableId, stacks: { [botA]: 120, [botB]: 80 } }) }];
          }
          if (text.includes("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2")) {
            const userId = params?.[1];
            const row = seats.get(userId);
            if (row) row.stack = 0;
            return [];
          }
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = $1 and user_id = $2 and is_bot = true")) {
            const userId = params?.[1];
            const row = seats.get(userId);
            if (row) row.status = "INACTIVE";
            return [];
          }
          if (text.includes("update public.poker_state set state = $2 where table_id = $1")) return [];
          if (text.includes("update public.poker_tables t\nset status = 'closed', updated_at = now()\nwhere t.status != 'closed'")) return [];
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

  return { handler, postCalls, queries };
};

const assertBotCashoutOrdering = (queries) => {
  const bulkStatusIdx = queries.findIndex((entry) =>
    entry.text.includes("update public.poker_seats set status = 'inactive' where table_id = any")
  );
  for (const botUserId of [botA, botB]) {
    const seatStatusIdx = queries.findIndex(
      (entry) =>
        entry.text.includes("update public.poker_seats set status = 'inactive' where table_id = $1 and user_id = $2 and is_bot = true") &&
        entry.params?.[1] === botUserId
    );
    const statusUpdateIdx = seatStatusIdx >= 0 ? seatStatusIdx : bulkStatusIdx;
    const stackUpdateIdx = queries.findIndex(
      (entry) =>
        entry.text.includes("update public.poker_seats set stack = 0 where table_id = $1 and user_id = $2") &&
        entry.params?.[1] === botUserId
    );
    assert.ok(statusUpdateIdx >= 0, `expected status inactivation query for ${botUserId}`);
    assert.ok(stackUpdateIdx > statusUpdateIdx, `expected stack cashout update after status inactivation for ${botUserId}`);
  }
};

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const recent = buildScenario({ humanLastActivityAgeSec: 5, humanSeatStatus: "INACTIVE" });
  const recentRun = await recent.handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(recentRun.statusCode, 200);
  assert.equal(recent.postCalls.length, 0, "recent inactive human should block bot-only close cashout");

  const old = buildScenario({ humanLastActivityAgeSec: 999, humanSeatStatus: "INACTIVE" });
  const first = await old.handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(first.statusCode, 200);
  assert.equal(old.postCalls.length, 2);
  assert.equal(old.postCalls[0].idempotencyKey, `bot-cashout:${tableId}:${botA}:2:SWEEP_CLOSE:close_cashout:v1`);
  assert.equal(old.postCalls[1].idempotencyKey, `bot-cashout:${tableId}:${botB}:6:SWEEP_CLOSE:close_cashout:v1`);
  assert.deepEqual(old.postCalls[0].entries, [
    { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -120 },
    { accountType: "USER", amount: 120 },
  ]);
  assert.deepEqual(old.postCalls[1].entries, [
    { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -80 },
    { accountType: "USER", amount: 80 },
  ]);

  const botOnlyCloseQuery = old.queries.find((entry) => entry.text.includes("with bot_only_tables as"));
  assert.ok(botOnlyCloseQuery, "expected bot-only close candidate query");
  assert.equal(botOnlyCloseQuery.text.includes("t.last_activity_at < now()"), false);
  assert.equal(botOnlyCloseQuery.text.includes("hs.updated_at"), false, "bot-only close query must not reference missing poker_seats.updated_at");
  assert.equal(
    botOnlyCloseQuery.text.includes("hs.joined_at") || botOnlyCloseQuery.text.includes("hs.created_at"),
    true,
    "bot-only close query should use existing poker_seats timestamps as fallback"
  );
  const closeTimerStart = botOnlyCloseQuery.text.indexOf("and coalesce(");
  const closeTimerEnd = botOnlyCloseQuery.text.indexOf(") < now() -", closeTimerStart);
  const closeTimerExpr =
    closeTimerStart >= 0 && closeTimerEnd > closeTimerStart
      ? botOnlyCloseQuery.text.slice(closeTimerStart, closeTimerEnd)
      : "";
  assert.equal(closeTimerExpr.includes(", t.updated_at"), false, "bot-only close timer fallback must not include poker_tables.updated_at");
  assert.equal(closeTimerExpr.includes("t.created_at"), true, "bot-only close timer fallback should include poker_tables.created_at");

  assertBotCashoutOrdering(old.queries);

  const second = await old.handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(second.statusCode, 200);
  assert.equal(old.postCalls.length, 2, "replay should not issue extra cashouts once stacks are zero");

  const activeHuman = buildScenario({ humanLastActivityAgeSec: 999, humanSeatStatus: "ACTIVE" });
  const activeHumanRun = await activeHuman.handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(activeHumanRun.statusCode, 200);
  assert.equal(activeHuman.postCalls.length, 0, "active human seat should block bot-only close");

  const noHumanHistory = buildScenario({ humanLastActivityAgeSec: 999, includeHumanSeat: false });
  const noHumanHistoryFirst = await noHumanHistory.handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(noHumanHistoryFirst.statusCode, 200);
  assert.equal(noHumanHistory.postCalls.length, 2, "bot-only table with no human history should close and cash out bots");
  assertBotCashoutOrdering(noHumanHistory.queries);

  const noHumanHistorySecond = await noHumanHistory.handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(noHumanHistorySecond.statusCode, 200);
  assert.equal(noHumanHistory.postCalls.length, 2, "no-human-history replay should not issue extra cashouts once stacks are zero");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
