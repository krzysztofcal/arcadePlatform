import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "77777777-7777-4777-8777-777777777777";
const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const actorId = "00000000-0000-4000-8000-000000000111";

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = actorId;

  const postCalls = [];
  const logs = [];
  const state = { lockHeld: false, escrowBalance: 100 };

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    isMemoryStore: true,
    store: {
      async get(key) { return key === "poker:sweep:lock:v1" && state.lockHeld ? "token" : null; },
      async setex(key) { if (key === "poker:sweep:lock:v1") state.lockHeld = true; return "OK"; },
      async del(key) { if (key === "poker:sweep:lock:v1") state.lockHeld = false; return 1; },
      async eval() { return 1; },
      async expire() { return 1; },
    },
    beginSql: async (fn) => fn({
      unsafe: async (query) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_requests")) return [];
        if (text.includes("delete from public.poker_requests")) return [];
        if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) return [];
        if (text.includes("with singleton_tables as")) return [];
        if (text.includes("with bot_only_tables as")) return [];
        if (text.includes("update public.poker_tables t\nset status = 'closed', updated_at = now()")) return [];
        if (text.includes("delete from public.poker_hole_cards")) return [];
        if (text.includes("select t.id") && text.includes("from public.poker_tables")) return [];
        if (text.includes("from public.chips_accounts a") && text.includes("a.balance <> 0")) return [{ system_key: `POKER_TABLE:${tableId}`, balance: 100 }];
        if (text.includes("from public.chips_accounts where account_type = 'escrow'")) return [{ balance: 100 }];
        if (text.includes("from public.poker_seats where table_id = $1 and status = 'active'")) return [];
        if (text.includes("select user_id, stack from public.poker_seats where table_id = $1 for update")) {
          return [{ user_id: userA, stack: 80 }, { user_id: userB, stack: 70 }];
        }
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

  const response = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(response.statusCode, 200);
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].idempotencyKey, `poker:orphan_quarantine:${tableId}:v1`);
  assert.equal(postCalls[0].userId, actorId);
  assert.ok(postCalls[0].entries.some((entry) => entry.accountType === "ESCROW" && entry.amount === -100));
  assert.ok(postCalls[0].entries.some((entry) => entry.accountType === "USER" && entry.amount === 100));
  assert.ok(!postCalls.some((call) => String(call.idempotencyKey || "").includes("orphan_cashout")));
  assert.ok(logs.some((entry) => entry.event === "poker_escrow_orphan_quarantined" && entry.payload?.tableId === tableId));
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
