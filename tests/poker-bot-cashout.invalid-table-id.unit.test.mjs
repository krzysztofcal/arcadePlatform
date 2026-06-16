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
    (value) => value !== "bad-table-id",
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
          tableId: "bad-table-id",
          botUserId: "11111111-1111-4111-8111-111111111111",
          seatNo: 7,
          reason: "SWEEP_CLOSE",
          actorUserId: "00000000-0000-4000-8000-000000000001",
          idempotencyKeySuffix: "close_cashout:v1",
        }
      ),
    (error) => error?.code === "invalid_table_id"
  );

  assert.equal(postCalls.length, 0);
  assert.equal(txCalls.length, 0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
