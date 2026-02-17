import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { hasActiveHumanGuardSql } from "../netlify/functions/_shared/poker-table-lifecycle.mjs";

const normalizeSql = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
const tableId = "99999999-9999-4999-8999-999999999999";

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const expectedGuard = normalizeSql(hasActiveHumanGuardSql({ tableAlias: "t" }));
  const seen = { singleton: false, botOnly: false, empty: false };
  const calls = { closeUpdates: 0, inactivate: 0, humanCashout: 0, botCashout: 0 };

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 1,
    TABLE_SINGLETON_CLOSE_SEC: 1,
    TABLE_BOT_ONLY_CLOSE_SEC: 1,
    isValidUuid: () => true,
    isHoleCardsTableMissing: () => false,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = normalizeSql(query);
          if (text.includes("from public.poker_requests") || text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) return [];

          if (text.includes("with singleton_tables as")) {
            seen.singleton = true;
            return text.includes(expectedGuard) ? [] : [{ id: tableId }];
          }
          if (text.includes("with bot_only_tables as")) {
            seen.botOnly = true;
            return text.includes(expectedGuard) ? [] : [{ id: tableId }];
          }
          if (text.includes("update public.poker_tables t") && text.includes("set status = 'closed'")) {
            seen.empty = true;
            calls.closeUpdates += text.includes(expectedGuard) ? 0 : 1;
            return text.includes(expectedGuard) ? [] : [{ id: tableId }];
          }
          if (text.includes("update public.poker_seats set status = 'inactive' where table_id = any")) {
            calls.inactivate += 1;
            return [];
          }
          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
          if (text.includes("from public.chips_accounts")) return [];
          if (text.includes("delete from public.poker_hole_cards")) return [];
          if (text.includes("select seat_no, status, stack, user_id, is_bot")) {
            calls.humanCashout += 1;
            return [{ seat_no: 1, status: "ACTIVE", stack: 100, user_id: "human", is_bot: false }];
          }
          return [];
        },
      }),
    postTransaction: async () => {
      calls.humanCashout += 1;
      return { transaction: { id: "tx" } };
    },
    postHandSettlementToLedger: async () => {},
    cashoutBotSeatIfNeeded: async () => {
      calls.botCashout += 1;
      return { ok: true, amount: 0, cashedOut: false };
    },
    ensureBotSeatInactiveForCashout: async () => ({ ok: true, changed: true }),
    klog: () => {},
  });

  const res = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(res.statusCode, 200);
  assert.equal(seen.singleton, true);
  assert.equal(seen.botOnly, true);
  assert.equal(seen.empty, true);
  assert.equal(calls.closeUpdates, 0);
  assert.equal(calls.inactivate, 0);
  assert.equal(calls.humanCashout, 0);
  assert.equal(calls.botCashout, 0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
