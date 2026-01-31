import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "22222222-2222-4222-8222-222222222222";

const makeHandler = (queries) =>
  loadPokerHandler("netlify/functions/poker-create-table.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: "user-1" }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          if (text.includes("insert into public.poker_tables")) {
            return [{ id: tableId }];
          }
          if (text.includes("insert into public.poker_state")) {
            return [];
          }
          if (text.includes("chips_accounts")) {
            return [{ id: "escrow-1" }];
          }
          return [];
        },
      }),
    klog: () => {},
  });

const runDefaultStakes = async () => {
  const queries = [];
  const handler = makeHandler(queries);
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ maxPlayers: 6 }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.tableId, tableId);
  const insert = queries.find((q) => q.query.toLowerCase().includes("insert into public.poker_tables"));
  assert.ok(insert, "expected table insert");
  const stakes = JSON.parse(insert.params?.[0] || "{}");
  assert.deepEqual(stakes, { sb: 1, bb: 2 });
};

const runValidStakes = async () => {
  const queries = [];
  const handler = makeHandler(queries);
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ maxPlayers: 6, stakes: { sb: 2, bb: 4 } }),
  });

  assert.equal(response.statusCode, 200);
  const insert = queries.find((q) => q.query.toLowerCase().includes("insert into public.poker_tables"));
  assert.ok(insert, "expected table insert");
  const stakes = JSON.parse(insert.params?.[0] || "{}");
  assert.deepEqual(stakes, { sb: 2, bb: 4 });
};

const runInvalidStakes = async () => {
  const queries = [];
  const handler = makeHandler(queries);
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ maxPlayers: 6, stakes: { sb: 2, bb: 1 } }),
  });

  assert.equal(response.statusCode, 400);
  const payload = JSON.parse(response.body);
  assert.equal(payload.error, "invalid_stakes");
  assert.ok(!queries.some((q) => q.query.toLowerCase().includes("insert into public.poker_tables")));
};

await runDefaultStakes();
await runValidStakes();
await runInvalidStakes();
