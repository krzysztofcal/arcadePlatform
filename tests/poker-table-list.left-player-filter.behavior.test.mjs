import test from "node:test";
import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const makeAuthMocks = (executeSql) => ({
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId: "user-1" }),
  executeSql,
  klog: () => {},
});

test("poker-list-tables excludes left seats from open seat counts", async () => {
  let seenQuery = "";
  const handler = loadPokerHandler(
    "netlify/functions/poker-list-tables.mjs",
    makeAuthMocks(async (query) => {
      seenQuery = String(query);
      return [{
        id: "table-1",
        stakes: JSON.stringify({ sb: 1, bb: 2 }),
        max_players: 6,
        status: "OPEN",
        created_by: "user-2",
        created_at: "2026-04-13T00:00:00.000Z",
        updated_at: "2026-04-13T00:00:00.000Z",
        last_activity_at: "2026-04-13T00:00:00.000Z",
        seat_count: 0,
      }];
    })
  );

  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { status: "OPEN", limit: "20" },
  });

  assert.equal(response.statusCode, 200);
  assert.match(seenQuery, /leftTableByUserId/);
  assert.match(seenQuery, /user_id::text/);
  assert.match(seenQuery, /<> 'true'/);
  const payload = JSON.parse(response.body);
  assert.equal(payload.tables[0].seatCount, 0);
});

test("poker-list-my-tables excludes rows for users already marked as left", async () => {
  let seenQuery = "";
  const handler = loadPokerHandler(
    "netlify/functions/poker-list-my-tables.mjs",
    makeAuthMocks(async (query) => {
      seenQuery = String(query);
      return [];
    })
  );

  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { status: "OPEN", limit: "20" },
  });

  assert.equal(response.statusCode, 200);
  assert.match(seenQuery, /leftTableByUserId/);
  assert.match(seenQuery, /user_id::text/);
  assert.match(seenQuery, /<> 'true'/);
  const payload = JSON.parse(response.body);
  assert.deepEqual(payload.tables, []);
});
