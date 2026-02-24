import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tableId = "78787878-7878-4787-8787-787878787878";

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000222";

  const mem = new Map();
  const logs = [];
  const postCalls = [];

  const store = {
    async get(key) { return mem.get(key) ?? null; },
    async setex(key, _seconds, value) { mem.set(key, String(value)); return "OK"; },
    async setNxEx(key, _seconds, value) {
      if (mem.has(key)) return null;
      mem.set(key, String(value));
      return "OK";
    },
    async del(key) { return mem.delete(key) ? 1 : 0; },
    async eval() { return 1; },
    async expire(key) { return mem.delete(key) ? 1 : 0; },
  };

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    isMemoryStore: true,
    store,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests") && text.includes("result_json is null")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) return [];
          if (text.includes("with singleton_tables as")) return [];
          if (text.includes("with bot_only_tables as")) return [];
          if (text.includes("update public.poker_tables t\nset status = 'closed', updated_at = now()")) return [];
          if (text.includes("delete from public.poker_hole_cards")) return [];
          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
          if (text.includes("from public.chips_accounts a") && text.includes("a.balance <> 0")) {
            await delay(25);
            return [{ system_key: `POKER_TABLE:${tableId}`, balance: 50 }];
          }
          if (text.includes("from public.chips_accounts where account_type = 'escrow'")) return [{ balance: 50 }];
          if (text.includes("from public.poker_seats where table_id = $1 and status = 'active'")) return [];
          if (text.includes("select user_id, stack from public.poker_seats where table_id = $1 for update")) return [];
          return [];
        },
      }),
    postTransaction: async (payload) => {
      postCalls.push(payload);
      return { transaction: { id: payload.idempotencyKey } };
    },
    postHandSettlementToLedger: async () => {},
    klog: (event, payload) => logs.push({ event, payload }),
    PRESENCE_TTL_SEC: 10,
    TABLE_EMPTY_CLOSE_SEC: 10,
    TABLE_SINGLETON_CLOSE_SEC: 10,
    TABLE_BOT_ONLY_CLOSE_SEC: 10,
    isHoleCardsTableMissing,
  });

  const req = { httpMethod: "POST", headers: { "x-sweep-secret": "secret" } };
  const [a, b] = await Promise.all([handler(req), handler(req)]);
  const bodies = [JSON.parse(a.body), JSON.parse(b.body)];
  const skippedCount = bodies.filter((x) => x?.skipped === "locked").length;
  assert.equal(skippedCount, 1);
  assert.equal(postCalls.length, 1, "only one remediation/quarantine path should run");
  assert.equal(mem.has("poker:sweep:lock:v1"), false);
  assert.ok(logs.some((entry) => entry.event === "poker_sweep_skip_locked"));
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
