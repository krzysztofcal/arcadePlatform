import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const makeHandler = ({ tableStatus = "CLOSED", maxPlayers = 6 }) => {
  const botInsertCalls = [];
  const handler = loadPokerHandler("netlify/functions/poker-join.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: value ?? null }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          if (text.includes("insert into public.poker_requests")) return [{ request_id: "join-id" }];
          if (text.includes("from public.poker_requests")) return [];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: tableStatus, max_players: maxPlayers, stakes: "1/2" }];
          if (text.includes("insert into public.poker_seats") && text.includes("is_bot")) {
            botInsertCalls.push(1);
            return [];
          }
          return [];
        },
      }),
    postTransaction: async () => ({ transaction: { id: "tx" } }),
    klog: () => {},
  });

  return { handler, botInsertCalls };
};

const run = async () => {
  {
    const ctx = makeHandler({ tableStatus: "CLOSED", maxPlayers: 6 });
    const res = await ctx.handler({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ tableId, seatNo: 0, buyIn: 100, requestId: "join-closed" }),
    });
    assert.equal(res.statusCode, 409);
    assert.equal(JSON.parse(res.body).error, "table_closed");
    assert.equal(ctx.botInsertCalls.length, 0);
  }

  {
    const ctx = makeHandler({ tableStatus: "OPEN", maxPlayers: 1 });
    const res = await ctx.handler({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ tableId, seatNo: 0, buyIn: 100, requestId: "join-open-invalid" }),
    });
    assert.equal(res.statusCode >= 400, true);
    assert.equal(ctx.botInsertCalls.length, 0);
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
