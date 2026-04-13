import test from "node:test";
import assert from "node:assert/strict";
import { createAuthoritativeLeaveExecutor } from "./authoritative-leave-adapter.mjs";

test("authoritative leave accepts retained seat when user is flagged leftTableByUserId", async () => {
  const env = {
    WS_TEST_LEAVE_RESULT_JSON: JSON.stringify({
      ok: true,
      state: {
        version: 3,
        state: {
          tableId: "t1",
          seats: [
            { userId: "u1", seatNo: 1 },
            { userId: "bot-1", seatNo: 2, isBot: true },
          ],
          leftTableByUserId: {
            u1: true,
          },
        },
      },
    }),
  };
  const execute = createAuthoritativeLeaveExecutor({ env, klog: () => {} });
  const result = await execute({ tableId: "t1", userId: "u1", requestId: "leave-r1" });
  assert.equal(result.ok, true);
});

test("authoritative leave still rejects retained seat without leftTable flag", async () => {
  const env = {
    WS_TEST_LEAVE_RESULT_JSON: JSON.stringify({
      ok: true,
      state: {
        version: 3,
        state: {
          tableId: "t1",
          seats: [
            { userId: "u1", seatNo: 1 },
            { userId: "bot-1", seatNo: 2, isBot: true },
          ],
          leftTableByUserId: {},
        },
      },
    }),
  };
  const execute = createAuthoritativeLeaveExecutor({ env, klog: () => {} });
  const result = await execute({ tableId: "t1", userId: "u1", requestId: "leave-r2" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "authoritative_state_invalid");
});
