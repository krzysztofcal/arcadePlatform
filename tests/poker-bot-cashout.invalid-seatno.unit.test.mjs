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
  const txCalls = [];
  const { cashoutBotSeatIfNeeded } = factory(
    async (payload) => {
      postCalls.push(payload);
      return { transaction: { id: "tx" } };
    },
    () => true,
    () => {}
  );

  const tx = {
    unsafe: async (query) => {
      const text = String(query).toLowerCase();
      txCalls.push(text);
      if (text.includes("select user_id, seat_no, status, is_bot, stack") && text.includes("for update")) {
        return [{ user_id: "11111111-1111-4111-8111-111111111111", seat_no: null, status: "INACTIVE", is_bot: true, stack: 100 }];
      }
      return [];
    },
  };

  await assert.rejects(
    () =>
      cashoutBotSeatIfNeeded(tx, {
        tableId: "99999999-9999-4999-8999-999999999999",
        botUserId: "11111111-1111-4111-8111-111111111111",
        reason: "SWEEP_CLOSE",
        actorUserId: "00000000-0000-4000-8000-000000000001",
        idempotencyKeySuffix: "close_cashout:v1:7",
      }),
    (error) => error?.code === "invalid_seat_no"
  );

  assert.equal(postCalls.length, 0);
  assert.equal(txCalls.some((text) => text.includes("update public.poker_seats set stack = 0")), false);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
