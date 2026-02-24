import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "55555555-5555-4555-8555-555555555555";

const buildHandler = ({ postCalls, logs }) => {
  const state = {
    lockAcquireCalls: 0,
    lockHeld: false,
    escrowBalance: 90,
  };

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    isMemoryStore: true,
    store: {
      async get(key) { return key === "poker:sweep:lock:v1" && state.lockHeld ? String(state.lockHeld) : null; },
      async setex(key) { if (key === "poker:sweep:lock:v1") state.lockHeld = true; return "OK"; },
      async setNxEx(key, _seconds, value) {
        if (key !== "poker:sweep:lock:v1") return "OK";
        state.lockAcquireCalls += 1;
        if (state.lockHeld) return null;
        state.lockHeld = String(value || "token");
        return "OK";
      },
      async eval() { return 1; },
      async del(key) { if (key === "poker:sweep:lock:v1") state.lockHeld = false; return 1; },
      async expire(key) { if (key === "poker:sweep:lock:v1") state.lockHeld = false; return 1; },
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) return [];
          if (text.includes("with singleton_tables as")) return [];
          if (text.includes("with bot_only_tables as")) return [];
          if (text.includes("update public.poker_tables t\nset status = 'closed', updated_at = now()")) return [];
          if (text.includes("delete from public.poker_hole_cards")) return [];
          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
          if (text.includes("from public.chips_accounts a") && text.includes("a.balance <> 0")) return [{ system_key: `POKER_TABLE:${tableId}`, balance: state.escrowBalance }];
          if (text.includes("from public.chips_accounts where account_type = 'escrow'")) return [{ balance: state.escrowBalance }];
          if (text.includes("from public.poker_seats where table_id = $1 and status = 'active'")) return [];
          if (text.includes("select user_id, stack from public.poker_seats where table_id = $1 for update")) return [];
          return [];
        },
      }),
    postTransaction: async (payload) => {
      postCalls.push(payload);
      if (payload.idempotencyKey === `poker:orphan_quarantine:${tableId}:v1`) state.escrowBalance = 0;
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

  return { handler, state };
};

const run = async () => {
  process.env.POKER_SWEEP_SECRET = "secret";
  process.env.POKER_SYSTEM_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000099";
  const postCalls = [];
  const logs = [];
  const { handler, state } = buildHandler({ postCalls, logs });

  const first = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(first.statusCode, 200);
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].idempotencyKey, `poker:orphan_quarantine:${tableId}:v1`);
  assert.equal(postCalls[0].userId, "00000000-0000-4000-8000-000000000099");
  assert.ok(postCalls[0].entries.some((entry) => entry.accountType === "USER" && entry.amount === 90));
  assert.ok(!postCalls[0].entries.some((entry) => entry.accountType === "SYSTEM"));
  assert.ok(logs.some((entry) => entry.event === "poker_escrow_orphan_quarantined"));

  const second = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(second.statusCode, 200);
  assert.equal(postCalls.length, 1);
  assert.ok(state.lockAcquireCalls > 0, "expected setNxEx lock acquisition path");
  assert.equal(state.lockHeld, false, "lock should be released after handler run");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
