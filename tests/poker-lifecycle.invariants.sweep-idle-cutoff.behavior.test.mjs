import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { tableIdleCutoffExprSql } from "../netlify/functions/_shared/poker-table-lifecycle.mjs";

const normalizeSql = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000001";

  const expectedIdleExpr = normalizeSql(tableIdleCutoffExprSql({ tableAlias: "t" }));
  const tracked = { singleton: null, botOnly: null, empty: null };

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
          if (text.includes("with singleton_tables as")) tracked.singleton = text;
          if (text.includes("with bot_only_tables as")) tracked.botOnly = text;
          if (text.includes("update public.poker_tables t") && text.includes("set status = 'closed'")) tracked.empty = text;
          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
          if (text.includes("from public.chips_accounts")) return [];
          return [];
        },
      }),
    postTransaction: async () => ({ transaction: { id: "tx" } }),
    postHandSettlementToLedger: async () => {},
    cashoutBotSeatIfNeeded: async () => ({ ok: true, amount: 0, cashedOut: false }),
    ensureBotSeatInactiveForCashout: async () => ({ ok: true, changed: true }),
    klog: () => {},
  });

  const res = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(res.statusCode, 200);

  assert.ok(tracked.singleton, "expected singleton close query");
  assert.ok(tracked.botOnly, "expected bot-only close query");
  assert.ok(tracked.empty, "expected empty close query");

  assert.equal(tracked.singleton.includes(expectedIdleExpr), true);
  assert.equal(tracked.botOnly.includes(expectedIdleExpr), true);
  assert.equal(tracked.empty.includes(expectedIdleExpr), true);

  assert.equal(tracked.singleton.includes("t.updated_at <"), false);
  assert.equal(tracked.botOnly.includes("t.updated_at <"), false);
  assert.equal(tracked.botOnly.includes("order by t.updated_at"), false);
  assert.equal(tracked.empty.includes("t.updated_at <"), false);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
