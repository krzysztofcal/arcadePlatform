import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const runListTablesContract = async () => {
  const handler = loadPokerHandler("netlify/functions/poker-list-tables.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "http://localhost" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: "user-1" }),
    klog: () => {},
    executeSql: async () => [
      {
        id: "t1",
        stakes: "1/2",
        max_players: 6,
        status: "OPEN",
        created_by: "u",
        created_at: new Date(0),
        updated_at: new Date(0),
        last_activity_at: new Date(0),
        seat_count: 2,
      },
    ],
  });

  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "http://localhost", authorization: "Bearer token" },
    queryStringParameters: {},
  });
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(Array.isArray(payload.tables), true);
  const table = payload.tables[0];
  assert.ok(table);
  assert.ok("id" in table);
  assert.ok("stakes" in table);
  assert.ok("maxPlayers" in table);
  assert.ok("status" in table);
  assert.ok("createdBy" in table);
  assert.ok("createdAt" in table);
  assert.ok("updatedAt" in table);
  assert.ok("lastActivityAt" in table);
  assert.ok("seatCount" in table);
  assert.equal(typeof table.seatCount, "number");
  assert.equal("max_players" in table, false);
  assert.equal("seat_count" in table, false);
};

const runGetTableContract = async () => {
  const toText = (q) => (typeof q === "string" ? q : q?.text || q?.sql || String(q));
  const handler = loadPokerHandler("netlify/functions/poker-get-table.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "http://localhost" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: "user-1" }),
    klog: () => {},
    isValidUuid: () => true,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = toText(query).toLowerCase();
          if (text.includes("from public.poker_tables")) {
            return [
              {
                id: "11111111-1111-4111-8111-111111111111",
                stakes: "1/2",
                max_players: 6,
                status: "OPEN",
                created_by: "u",
                created_at: new Date(0),
                updated_at: new Date(0),
                last_activity_at: new Date(0),
              },
            ];
          }
          if (text.includes("from public.poker_seats")) {
            return [
              {
                user_id: "user-1",
                seat_no: 1,
                status: "ACTIVE",
                last_seen_at: new Date(0),
                joined_at: new Date(0),
              },
            ];
          }
          if (text.includes("from public.poker_state")) {
            return [{ version: 1, state: { phase: "LOBBY" } }];
          }
          return [];
        },
      }),
  });

  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "http://localhost", authorization: "Bearer token" },
    queryStringParameters: { tableId: "11111111-1111-4111-8111-111111111111" },
  });
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.ok(payload.table);
  assert.ok("id" in payload.table);
  assert.ok("stakes" in payload.table);
  assert.ok("maxPlayers" in payload.table);
  assert.ok("status" in payload.table);
  assert.ok("createdBy" in payload.table);
  assert.ok("createdAt" in payload.table);
  assert.ok("updatedAt" in payload.table);
  assert.ok("lastActivityAt" in payload.table);
  assert.equal("max_players" in payload.table, false);
  assert.equal("created_by" in payload.table, false);
  assert.ok(Array.isArray(payload.seats));
  assert.ok(payload.seats.length > 0);
  const seat = payload.seats[0];
  assert.ok("userId" in seat);
  assert.ok("seatNo" in seat);
  assert.ok("status" in seat);
  assert.ok("lastSeenAt" in seat);
  assert.ok("joinedAt" in seat);
  assert.ok(payload.state);
  assert.equal(typeof payload.state.version, "number");
  assert.equal(typeof payload.state.state, "object");
};

await runListTablesContract();
await runGetTableContract();
