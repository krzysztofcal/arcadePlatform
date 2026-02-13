import assert from "node:assert/strict";
import { cashoutBotSeatIfNeeded } from "../netlify/functions/_shared/poker-bot-cashout.mjs";

const run = async () => {
  const tx = {
    unsafe: async (query) => {
      const text = String(query).toLowerCase();
      if (text.includes("select user_id, seat_no, status, is_bot, stack") && text.includes("for update")) {
        return [{ user_id: "bot-1", seat_no: null, status: "INACTIVE", is_bot: true, stack: 100 }];
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
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
