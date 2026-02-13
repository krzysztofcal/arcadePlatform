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
    (value) => value !== "not-a-uuid",
    () => {}
  );

  await assert.rejects(
    () =>
      cashoutBotSeatIfNeeded(
        {
          unsafe: async (query) => {
            txCalls.push(String(query).toLowerCase());
            return [];
          },
        },
        {
          tableId: "99999999-9999-4999-8999-999999999999",
          botUserId: "not-a-uuid",
          seatNo: 7,
          reason: "SWEEP_TIMEOUT",
          actorUserId: "00000000-0000-4000-8000-000000000001",
          idempotencyKeySuffix: "timeout_cashout:v1",
        }
      ),
    (error) => error?.code === "invalid_bot_user_id"
  );

  assert.equal(postCalls.length, 0);
  assert.equal(txCalls.length, 0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
