import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";

  const logs = [];
  let delCalls = 0;
  const mem = new Map();
  const store = {
    async get(key) { return mem.get(key) ?? null; },
    async setex(key, _seconds, value) { mem.set(key, String(value)); return "OK"; },
    async del(key) { delCalls += 1; return mem.delete(key) ? 1 : 0; },
    async eval() { return 1; },
    async expire(key) { return mem.delete(key) ? 1 : 0; },
  };

  let workRuns = 0;
  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    isMemoryStore: true,
    store,
    beginSql: async (fn) => fn({
      unsafe: async (query) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_requests") && text.includes("result_json is null")) {
          workRuns += 1;
          return [];
        }
        if (text.includes("delete from public.poker_requests")) return [];
        if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) return [];
        if (text.includes("with singleton_tables as")) return [];
        if (text.includes("with bot_only_tables as")) return [];
        if (text.includes("update public.poker_tables t\nset status = 'closed', updated_at = now()")) return [];
        if (text.includes("delete from public.poker_hole_cards")) return [];
        if (text.includes("select t.id") && text.includes("from public.poker_tables")) return [];
        if (text.includes("from public.chips_accounts")) return [];
        return [];
      },
    }),
    postTransaction: async () => ({ transaction: { id: "tx" } }),
    postHandSettlementToLedger: async () => {},
    klog: (event, payload) => logs.push({ event, payload }),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 10,
    TABLE_BOT_ONLY_CLOSE_SEC: 10,
    isHoleCardsTableMissing,
  });

  const first = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(first.statusCode, 200);
  assert.equal(workRuns, 1);
  assert.equal(mem.has("poker:sweep:lock:v1"), false);

  const second = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(second.statusCode, 200);
  assert.equal(JSON.parse(second.body).skipped, undefined);
  assert.equal(workRuns, 2);
  assert.equal(mem.has("poker:sweep:lock:v1"), false);
  assert.ok(delCalls >= 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
