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
    (value) => value !== "bad-actor",
    () => {}
  );

  await assert.rejects(
    () =>
      cashoutBotSeatIfNeeded(
        {
          unsafe: async (query) => {
            const text = String(query).toLowerCase();
            txCalls.push(text);
            if (text.includes("select user_id, seat_no, status, is_bot, stack") && text.includes("for update")) {
              return [{ user_id: "11111111-1111-4111-8111-111111111111", seat_no: 7, status: "INACTIVE", is_bot: true, stack: 33 }];
            }
            return [];
          },
        },
        {
          tableId: "99999999-9999-4999-8999-999999999999",
          botUserId: "11111111-1111-4111-8111-111111111111",
          seatNo: 7,
            reason: "SWEEP_CLOSE",
          actorUserId: "bad-actor",
          idempotencyKeySuffix: "close_cashout:v1",
        }
      ),
    (error) => error?.code === "invalid_actor_user_id"
  );

  assert.equal(postCalls.length, 0);
  assert.equal(txCalls.some((text) => text.includes("update public.poker_seats set stack = 0")), false);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
