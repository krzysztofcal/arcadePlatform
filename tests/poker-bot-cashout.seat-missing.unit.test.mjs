import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const run = async () => {
  const root = process.cwd();
  const source = fs.readFileSync(path.join(root, "netlify/functions/_shared/poker-bot-cashout.mjs"), "utf8");
  const stripped = source.replace(/^\s*import[\s\S]*?;\s*$/gm, "");
  const rewritten = stripped.replace(/export\s+async\s+function\s+/g, "async function ");
  const factory = new Function(
    "postTransaction",
    "isValidUuid",
    "klog",
    `"use strict";
${rewritten}
return { cashoutBotSeatIfNeeded };`
  );

  const postCalls = [];
  const { cashoutBotSeatIfNeeded } = factory(
    async (payload) => {
      postCalls.push(payload);
      return { transaction: { id: "tx" } };
    },
    () => true,
    () => {}
  );

  const result = await cashoutBotSeatIfNeeded(
    {
      unsafe: async (query) => {
        const text = String(query).toLowerCase();
        if (text.includes("select user_id, seat_no, status, is_bot, stack") && text.includes("is_bot = true") && text.includes("for update")) {
          return [];
        }
        return [];
      },
    },
    {
      tableId: "99999999-9999-4999-8999-999999999999",
      botUserId: "11111111-1111-4111-8111-111111111111",
      seatNo: 3,
      reason: "SWEEP_TIMEOUT",
      actorUserId: "00000000-0000-4000-8000-000000000001",
      idempotencyKeySuffix: "timeout_cashout:v1",
    }
  );

  assert.deepEqual(result, { ok: false, skipped: true, reason: "seat_missing" });
  assert.equal(postCalls.length, 0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
