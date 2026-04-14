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
  const seenQueries = [];
  const handler = loadPokerHandler(
    "netlify/functions/poker-list-tables.mjs",
    makeAuthMocks(async (query) => {
      const text = String(query);
      seenQueries.push(text);
      if (text.includes("from public.poker_tables t")) {
        return [{
          id: "table-1",
          stakes: JSON.stringify({ sb: 1, bb: 2 }),
          max_players: 6,
          status: "OPEN",
          created_by: "user-2",
          created_at: "2026-04-13T00:00:00.000Z",
          updated_at: "2026-04-13T00:00:00.000Z",
          last_activity_at: "2026-04-13T00:00:00.000Z",
        }];
      }
      return [
        { table_id: "table-1", user_id: "user-2", state: { leftTableByUserId: { "user-2": false } } },
        { table_id: "table-1", user_id: "user-3", state: { leftTableByUserId: { "user-3": true } } }
      ];
    })
  );

  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { status: "OPEN", limit: "20" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(seenQueries.length, 2);
  assert.match(seenQueries[0], /from public\.poker_tables t/);
  assert.match(seenQueries[1], /from public\.poker_seats s/);
  const payload = JSON.parse(response.body);
  assert.equal(payload.tables[0].seatCount, 1);
});

test("poker-list-tables counts retained waiting seats in seatCount", async () => {
  const handler = loadPokerHandler(
    "netlify/functions/poker-list-tables.mjs",
    makeAuthMocks(async (query) => {
      const text = String(query);
      if (text.includes("from public.poker_tables t")) {
        return [{
          id: "table-1",
          stakes: JSON.stringify({ sb: 1, bb: 2 }),
          max_players: 6,
          status: "OPEN",
          created_by: "user-2",
          created_at: "2026-04-13T00:00:00.000Z",
          updated_at: "2026-04-13T00:00:00.000Z",
          last_activity_at: "2026-04-13T00:00:00.000Z",
        }];
      }
      return [
        {
          table_id: "table-1",
          user_id: "user-2",
          state: {
            leftTableByUserId: { "user-2": true },
            waitingForNextHandByUserId: { "user-2": true }
          }
        }
      ];
    })
  );

  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { status: "OPEN", limit: "20" },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.tables[0].seatCount, 1);
});

test("poker-list-tables still hides left seats when waiting flag is explicitly false", async () => {
  const handler = loadPokerHandler(
    "netlify/functions/poker-list-tables.mjs",
    makeAuthMocks(async (query) => {
      const text = String(query);
      if (text.includes("from public.poker_tables t")) {
        return [{
          id: "table-1",
          stakes: JSON.stringify({ sb: 1, bb: 2 }),
          max_players: 6,
          status: "OPEN",
          created_by: "user-2",
          created_at: "2026-04-13T00:00:00.000Z",
          updated_at: "2026-04-13T00:00:00.000Z",
          last_activity_at: "2026-04-13T00:00:00.000Z",
        }];
      }
      return [
        {
          table_id: "table-1",
          user_id: "user-2",
          state: {
            leftTableByUserId: { "user-2": true },
            waitingForNextHandByUserId: { "user-2": false }
          }
        }
      ];
    })
  );

  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { status: "OPEN", limit: "20" },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.tables[0].seatCount, 0);
});

test("poker-list-my-tables excludes rows for users already marked as left", async () => {
  const seenQueries = [];
  const handler = loadPokerHandler(
    "netlify/functions/poker-list-my-tables.mjs",
    makeAuthMocks(async (query) => {
      const text = String(query);
      seenQueries.push(text);
      if (text.includes("where s.user_id = $1")) {
        return [{
          id: "table-1",
          stakes: JSON.stringify({ sb: 1, bb: 2 }),
          max_players: 6,
          status: "OPEN",
          created_by: "user-2",
          created_at: "2026-04-13T00:00:00.000Z",
          updated_at: "2026-04-13T00:00:00.000Z",
          last_activity_at: "2026-04-13T00:00:00.000Z",
          seat_no: 1,
          seat_status: "ACTIVE",
          seat_created_at: "2026-04-13T00:00:00.000Z",
          seat_last_seen_at: "2026-04-13T00:00:00.000Z",
          user_id: "user-1",
          state: { leftTableByUserId: { "user-1": true } }
        }];
      }
      return [];
    })
  );

  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { status: "OPEN", limit: "20" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(seenQueries.length, 1);
  assert.match(seenQueries[0], /where s\.user_id = \$1/);
  const payload = JSON.parse(response.body);
  assert.deepEqual(payload.tables, []);
});

test("poker-list-my-tables keeps retained waiting row visible", async () => {
  const handler = loadPokerHandler(
    "netlify/functions/poker-list-my-tables.mjs",
    makeAuthMocks(async (query) => {
      const text = String(query);
      if (text.includes("where s.user_id = $1")) {
        return [{
          id: "table-1",
          stakes: JSON.stringify({ sb: 1, bb: 2 }),
          max_players: 6,
          status: "OPEN",
          created_by: "user-2",
          created_at: "2026-04-13T00:00:00.000Z",
          updated_at: "2026-04-13T00:00:00.000Z",
          last_activity_at: "2026-04-13T00:00:00.000Z",
          seat_no: 1,
          seat_status: "ACTIVE",
          seat_created_at: "2026-04-13T00:00:00.000Z",
          seat_last_seen_at: "2026-04-13T00:00:00.000Z",
          user_id: "user-1",
          state: {
            leftTableByUserId: { "user-1": true },
            waitingForNextHandByUserId: { "user-1": true }
          }
        }];
      }
      return [];
    })
  );

  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { status: "OPEN", limit: "20" },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.tables.length, 1);
  assert.equal(payload.tables[0].id, "table-1");
});

test("poker-list-tables keeps active seats visible when poker_state row is missing", async () => {
  const handler = loadPokerHandler(
    "netlify/functions/poker-list-tables.mjs",
    makeAuthMocks(async (query) => {
      const text = String(query);
      if (text.includes("from public.poker_tables t")) {
        return [{
          id: "table-1",
          stakes: JSON.stringify({ sb: 1, bb: 2 }),
          max_players: 6,
          status: "OPEN",
          created_by: "user-2",
          created_at: "2026-04-13T00:00:00.000Z",
          updated_at: "2026-04-13T00:00:00.000Z",
          last_activity_at: "2026-04-13T00:00:00.000Z",
        }];
      }
      return [{ table_id: "table-1", user_id: "user-2", state: null }];
    })
  );

  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { status: "OPEN", limit: "20" },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.tables[0].seatCount, 1);
});

test("poker-list-tables keeps active seats visible when poker_state JSON is invalid", async () => {
  const handler = loadPokerHandler(
    "netlify/functions/poker-list-tables.mjs",
    makeAuthMocks(async (query) => {
      const text = String(query);
      if (text.includes("from public.poker_tables t")) {
        return [{
          id: "table-1",
          stakes: JSON.stringify({ sb: 1, bb: 2 }),
          max_players: 6,
          status: "OPEN",
          created_by: "user-2",
          created_at: "2026-04-13T00:00:00.000Z",
          updated_at: "2026-04-13T00:00:00.000Z",
          last_activity_at: "2026-04-13T00:00:00.000Z",
        }];
      }
      return [{ table_id: "table-1", user_id: "user-2", state: "{not-json" }];
    })
  );

  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { status: "OPEN", limit: "20" },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.tables[0].seatCount, 1);
});

test("poker-list-tables still counts current seat when left flag belongs to another user only", async () => {
  const handler = loadPokerHandler(
    "netlify/functions/poker-list-tables.mjs",
    makeAuthMocks(async (query) => {
      const text = String(query);
      if (text.includes("from public.poker_tables t")) {
        return [{
          id: "table-1",
          stakes: JSON.stringify({ sb: 1, bb: 2 }),
          max_players: 6,
          status: "OPEN",
          created_by: "user-2",
          created_at: "2026-04-13T00:00:00.000Z",
          updated_at: "2026-04-13T00:00:00.000Z",
          last_activity_at: "2026-04-13T00:00:00.000Z",
        }];
      }
      return [{
        table_id: "table-1",
        user_id: "user-2",
        state: { leftTableByUserId: { "other-user": true } }
      }];
    })
  );

  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { status: "OPEN", limit: "20" },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.tables[0].seatCount, 1);
});

test("poker-list-my-tables keeps active row visible when poker_state row is missing", async () => {
  const handler = loadPokerHandler(
    "netlify/functions/poker-list-my-tables.mjs",
    makeAuthMocks(async (query) => {
      const text = String(query);
      if (text.includes("where s.user_id = $1")) {
        return [{
          id: "table-1",
          stakes: JSON.stringify({ sb: 1, bb: 2 }),
          max_players: 6,
          status: "OPEN",
          created_by: "user-2",
          created_at: "2026-04-13T00:00:00.000Z",
          updated_at: "2026-04-13T00:00:00.000Z",
          last_activity_at: "2026-04-13T00:00:00.000Z",
          seat_no: 1,
          seat_status: "ACTIVE",
          seat_created_at: "2026-04-13T00:00:00.000Z",
          seat_last_seen_at: "2026-04-13T00:00:00.000Z",
          user_id: "user-1",
          state: null
        }];
      }
      return [];
    })
  );

  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { status: "OPEN", limit: "20" },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.tables.length, 1);
  assert.equal(payload.tables[0].id, "table-1");
});

test("poker-list-my-tables keeps active row visible when poker_state JSON is invalid", async () => {
  const handler = loadPokerHandler(
    "netlify/functions/poker-list-my-tables.mjs",
    makeAuthMocks(async (query) => {
      const text = String(query);
      if (text.includes("where s.user_id = $1")) {
        return [{
          id: "table-1",
          stakes: JSON.stringify({ sb: 1, bb: 2 }),
          max_players: 6,
          status: "OPEN",
          created_by: "user-2",
          created_at: "2026-04-13T00:00:00.000Z",
          updated_at: "2026-04-13T00:00:00.000Z",
          last_activity_at: "2026-04-13T00:00:00.000Z",
          seat_no: 1,
          seat_status: "ACTIVE",
          seat_created_at: "2026-04-13T00:00:00.000Z",
          seat_last_seen_at: "2026-04-13T00:00:00.000Z",
          user_id: "user-1",
          state: "{not-json"
        }];
      }
      return [];
    })
  );

  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { status: "OPEN", limit: "20" },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.tables.length, 1);
  assert.equal(payload.tables[0].id, "table-1");
});

test("poker-list-my-tables keeps current row when left flag belongs to another user only", async () => {
  const handler = loadPokerHandler(
    "netlify/functions/poker-list-my-tables.mjs",
    makeAuthMocks(async (query) => {
      const text = String(query);
      if (text.includes("where s.user_id = $1")) {
        return [{
          id: "table-1",
          stakes: JSON.stringify({ sb: 1, bb: 2 }),
          max_players: 6,
          status: "OPEN",
          created_by: "user-2",
          created_at: "2026-04-13T00:00:00.000Z",
          updated_at: "2026-04-13T00:00:00.000Z",
          last_activity_at: "2026-04-13T00:00:00.000Z",
          seat_no: 1,
          seat_status: "ACTIVE",
          seat_created_at: "2026-04-13T00:00:00.000Z",
          seat_last_seen_at: "2026-04-13T00:00:00.000Z",
          user_id: "user-1",
          state: { leftTableByUserId: { "user-2": true } }
        }];
      }
      return [{
        table_id: "table-1",
        user_id: "user-1",
        state: { leftTableByUserId: { "user-2": true } }
      }];
    })
  );

  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { status: "OPEN", limit: "20" },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.tables.length, 1);
  assert.equal(payload.tables[0].seatCount, 1);
});
