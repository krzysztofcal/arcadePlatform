import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { formatStakes, parseStakes } from "../netlify/functions/_shared/poker-stakes.mjs";

const makeHandler = (queries, options = {}) =>
  loadPokerHandler("netlify/functions/poker-create-table.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: "user-1" }),
    parseStakes,
    formatStakes,
    klog: options.klog || (() => {}),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          if (text.includes("insert into public.poker_tables")) {
            return [{ id: "table-1" }];
          }
          if (text.includes("insert into public.poker_state")) {
            return [];
          }
          if (text.includes("from public.chips_accounts")) {
            return [{ id: "escrow-1" }];
          }
          if (text.includes("insert into public.chips_accounts")) {
            return [{ id: "escrow-1" }];
          }
          return [];
        },
      }),
  });

const runMissingStakes = async () => {
  const queries = [];
  const handler = makeHandler(queries);
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ maxPlayers: 6 }),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, "invalid_stakes");
  assert.equal(queries.length, 0);
};

const runInvalidStakes = async () => {
  const queries = [];
  const handler = makeHandler(queries);
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ maxPlayers: 6, stakes: { sb: 2, bb: 2 } }),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, "invalid_stakes");
  assert.equal(queries.length, 0);
};

const runSlashStakes = async () => {
  const queries = [];
  const handler = makeHandler(queries);
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ maxPlayers: 6, stakes: "1/2" }),
  });
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.tableId, "table-1");
  const insertCall = queries.find((entry) => entry.query.toLowerCase().includes("insert into public.poker_tables"));
  assert.ok(insertCall, "expected insert into poker_tables");
  assert.equal(insertCall.params?.[0], JSON.stringify({ sb: 1, bb: 2 }));
};

await runMissingStakes();
await runInvalidStakes();
await runSlashStakes();
