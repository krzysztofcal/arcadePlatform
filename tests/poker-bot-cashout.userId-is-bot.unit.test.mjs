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
    `"use strict";\n${rewritten}\nreturn { cashoutBotSeatIfNeeded };`
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

  const tableId = "99999999-9999-4999-8999-999999999999";
  const botUserId = "11111111-1111-4111-8111-111111111111";
  const actorUserId = "00000000-0000-4000-8000-000000000001";
  await cashoutBotSeatIfNeeded(
    {
      unsafe: async (query) => {
        const text = String(query).toLowerCase();
        if (text.includes("select user_id, seat_no, status, is_bot, stack") && text.includes("for update")) {
          return [{ user_id: botUserId, seat_no: 7, status: "INACTIVE", is_bot: true, stack: 33 }];
        }
        return [];
      },
    },
    {
      tableId,
      botUserId,
      seatNo: 7,
        reason: "SWEEP_CLOSE",
      actorUserId,
      idempotencyKeySuffix: "close_cashout:v1",
    }
  );

  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].userId, botUserId);
  assert.equal(postCalls[0].createdBy, actorUserId);
  assert.equal(postCalls[0].txType, "TABLE_CASH_OUT");
  assert.deepEqual(postCalls[0].entries, [
    { accountType: "ESCROW", systemKey: `POKER_TABLE:${tableId}`, amount: -33 },
    { accountType: "USER", amount: 33 },
  ]);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
