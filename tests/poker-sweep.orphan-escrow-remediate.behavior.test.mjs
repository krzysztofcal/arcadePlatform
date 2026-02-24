import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";

const tableId = "44444444-4444-4444-8444-444444444444";
const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

const buildHandler = ({ postCalls, logs }) => {
  const state = {
    lockHeld: false,
    escrowBalance: 200,
    seats: [
      { user_id: userA, stack: 120, status: "INACTIVE" },
      { user_id: userB, stack: 80, status: "INACTIVE" },
    ],
    ranWorkQuery: false,
  };

  const handler = loadPokerHandler("netlify/functions/poker-sweep.mjs", {
    baseHeaders: () => ({}),
    isMemoryStore: true,
    store: {
      async get(key) {
        if (key === "poker:sweep:lock:v1") return state.lockHeld ? "token" : null;
        return null;
      },
      async setex(key) {
        if (key === "poker:sweep:lock:v1") state.lockHeld = true;
        return "OK";
      },
      async eval() { return 1; },
      async del(key) {
        if (key === "poker:sweep:lock:v1") state.lockHeld = false;
        return 1;
      },
      async expire(key) {
        if (key === "poker:sweep:lock:v1") state.lockHeld = false;
        return 1;
      },
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_seats") && text.includes("last_seen_at < now()")) return [];
          if (text.includes("with singleton_tables as")) return [];
          if (text.includes("with bot_only_tables as")) return [];
          if (text.includes("update public.poker_tables t\nset status = 'closed', updated_at = now()")) return [];
          if (text.includes("delete from public.poker_hole_cards")) return [];
          if (text.includes("select t.id") && text.includes("stack > 0")) return [];
          if (text.includes("from public.chips_accounts a") && text.includes("a.balance <> 0")) {
            return [{ system_key: `POKER_TABLE:${tableId}`, balance: state.escrowBalance }];
          }
          if (text.includes("from public.chips_accounts where account_type = 'escrow'")) {
            return [{ balance: state.escrowBalance }];
          }
          if (text.includes("from public.poker_seats where table_id = $1 and status = 'active'")) {
            return [];
          }
          if (text.includes("select user_id, stack from public.poker_seats where table_id = $1 for update")) {
            state.ranWorkQuery = true;
            return state.seats.map((row) => ({ ...row }));
          }
          if (text.includes("update public.poker_seats set stack = 0, status = 'inactive'")) {
            state.seats = state.seats.map((row) => ({ ...row, stack: 0, status: "INACTIVE" }));
            return [];
          }
          return [];
        },
      }),
    postTransaction: async (payload) => {
      postCalls.push(payload);
      if (payload.idempotencyKey === `poker:orphan_cashout:${tableId}:${userA}:v1`) state.escrowBalance -= 120;
      if (payload.idempotencyKey === `poker:orphan_cashout:${tableId}:${userB}:v1`) state.escrowBalance -= 80;
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
  const postCalls = [];
  const logs = [];
  const { handler, state } = buildHandler({ postCalls, logs });

  const first = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(first.statusCode, 200);
  assert.equal(state.ranWorkQuery, true);
  assert.equal(postCalls.length, 2);
  assert.deepEqual(
    postCalls.map((call) => call.idempotencyKey).sort(),
    [`poker:orphan_cashout:${tableId}:${userA}:v1`, `poker:orphan_cashout:${tableId}:${userB}:v1`].sort()
  );
  assert.ok(postCalls.every((call) => call.txType === "TABLE_CASH_OUT"));
  assert.ok(
    postCalls.some((call) =>
      call.entries.some((entry) => entry.accountType === "ESCROW" && entry.systemKey === `POKER_TABLE:${tableId}`)
    )
  );
  assert.ok(logs.some((entry) => entry.event === "poker_escrow_orphan_remediated" && entry.payload?.total === 200));

  const second = await handler({ httpMethod: "POST", headers: { "x-sweep-secret": "secret" } });
  assert.equal(second.statusCode, 200);
  assert.equal(postCalls.length, 2);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
