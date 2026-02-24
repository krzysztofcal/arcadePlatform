import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";

  let lockAttempt = 0;
  let workQueryCount = 0;
  const logs = [];
  const evalCalls = [];

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    isMemoryStore: false,
    store: {
      async eval(script, keys, argv) {
        evalCalls.push({ script: String(script || ""), keys, argv });
        const src = String(script || "").toLowerCase();
        if (src.includes("set") && src.includes("nx")) {
          lockAttempt += 1;
          return lockAttempt === 1 ? 1 : 0;
        }
        if (src.includes("del") && src.includes("get")) {
          return 1;
        }
        return 0;
      },
      async get() { return null; },
      async setex() { return "OK"; },
      async expire() { return 1; },
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) {
            workQueryCount += 1;
            return [];
          }
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) return [];
          if (text.includes("with singleton_tables as")) return [];
          if (text.includes("with bot_only_tables as")) return [];
          if (text.includes("update public.poker_tables t\nset status = 'closed', updated_at = now()")) return [];
          if (text.includes("delete from public.poker_hole_cards")) return [];
          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
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
  assert.ok(workQueryCount > 0);

  const second = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(second.statusCode, 200);
  assert.deepEqual(JSON.parse(second.body), { ok: true, skipped: "locked" });
  assert.equal(workQueryCount, 1, "second locked run should not execute sweep queries");
  assert.ok(logs.some((entry) => entry.event === "poker_sweep_skip_locked"));
  const unlockCall = evalCalls.find((entry) => entry.script.toLowerCase().includes("redis.call('del', key)"));
  assert.ok(unlockCall, "expected atomic unlock eval to be invoked");
  assert.equal(unlockCall.keys?.[0], "poker:sweep:lock:v1");
  assert.equal(typeof unlockCall.argv?.[0], "string");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
