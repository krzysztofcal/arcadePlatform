import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const run = async () => {
  const root = process.cwd();
  const source = fs.readFileSync(path.join(root, "netlify/functions/_shared/poker-bot-cashout.mjs"), "utf8");
  const stripped = source.replace(/^\s*import[\s\S]*?;\s*$/gm, "");
  const rewritten = stripped.replace(/export\s+async\s+function\s+/g, "async function ");
  const factory = new Function("postTransaction", "isValidUuid", "klog", `"use strict";\n${rewritten}\nreturn { cashoutBotSeatIfNeeded };`);

  const postCalls = [];
  const calls = [];
  const { cashoutBotSeatIfNeeded } = factory(
    async (payload) => {
      postCalls.push(payload);
      return { transaction: { id: "tx" } };
    },
    () => true,
    () => {}
  );

  const tx = {
    unsafe: async (query, params) => {
      calls.push({ query: String(query), params });
      const text = String(query).toLowerCase();
      if (text.includes("select user_id, seat_no, status, is_bot, stack") && text.includes("for update")) {
        return [{ user_id: "11111111-1111-4111-8111-111111111111", seat_no: 3, status: "ACTIVE", is_bot: true, stack: 100 }];
      }
      if (text.includes("update public.poker_seats set stack = 0")) {
        throw new Error("must_not_update_stack_for_active_seat");
      }
      return [];
    },
  };

  const result = await cashoutBotSeatIfNeeded(tx, {
    tableId: "99999999-9999-4999-8999-999999999999",
    botUserId: "11111111-1111-4111-8111-111111111111",
    seatNo: 3,
    reason: "SWEEP_TIMEOUT",
    actorUserId: "00000000-0000-4000-8000-000000000001",
    idempotencyKeySuffix: "timeout_cashout:v1:7",
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "active_seat");
  assert.equal(result.amount, 0);
  assert.equal(result.seatNo, 3);
  assert.equal(postCalls.length, 0);
  assert.equal(calls.filter((entry) => entry.query.toLowerCase().includes("update public.poker_seats set stack = 0")).length, 0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
