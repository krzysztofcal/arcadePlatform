import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const run = async () => {
  const pokerRequestQueryCount = { value: 0 };

  const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({
      ok: true,
      value: typeof value === "string" && value.trim() ? value.trim() : null,
    }),
    updatePokerStateOptimistic,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("public.poker_requests")) pokerRequestQueryCount.value += 1;
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
          if (text.includes("from public.poker_state")) {
            return [
              {
                version: 7,
                state: {
                  tableId,
                  phase: "INIT",
                  seats: [{ userId, seatNo: 1 }],
                  stacks: { [userId]: 150 },
                  deck: ["As", "Kd"],
                  holeCardsByUserId: { [userId]: ["Ah", "Ad"] },
                  pot: 0,
                },
              },
            ];
          }
          if (text.includes("from public.poker_seats") && text.includes("for update")) {
            return [{ seat_no: 1, status: "ACTIVE", stack: 150 }];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            const baseVersion = Number(params?.[1] ?? 0);
            return [{ version: baseVersion + 1 }];
          }
          return [];
        },
      }),
    postTransaction: async () => ({ transaction: { id: "tx-leave-no-request" } }),
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, includeState: true }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.ok, true);
  assert.equal(payload.error, undefined);
  assert.ok(payload.state);
  assert.equal(typeof payload.state.version, "number");
  assert.equal(payload.state.state?.deck, undefined);
  assert.equal(payload.state.state?.holeCardsByUserId, undefined);
  assert.equal(pokerRequestQueryCount.value, 0);
};

run()
  .then(() => console.log("poker-leave no-requestId behavior test passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
