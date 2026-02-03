import assert from "node:assert/strict";
import { normalizeJsonState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { parseStakes } from "../netlify/functions/_shared/poker-stakes.mjs";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const handId = "22222222-2222-4222-8222-222222222222";
const userId = "user-1";

const makeHandler = (actions) =>
  loadPokerHandler("netlify/functions/poker-export-log.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    normalizeJsonState,
    isValidUuid: () => true,
    parseStakes,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) {
            return [{ user_id: userId, seat_no: 1 }];
          }
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, stakes: { sb: 1, bb: 2 }, max_players: 6 }];
          }
          if (text.includes("from public.poker_state")) {
            return [{ version: 12, state: { handId } }];
          }
          if (text.includes("from public.poker_actions")) {
            return actions;
          }
          return [];
        },
      }),
    klog: () => {},
  });

const run = async () => {
  const actions = [
    {
      id: 1,
      created_at: "2025-01-01T00:00:00.000Z",
      version: 10,
      user_id: userId,
      action_type: "START_HAND",
      amount: null,
      request_id: "req-1",
      hand_id: handId,
      phase_from: "INIT",
      phase_to: "PREFLOP",
      meta: { determinism: { handSeed: "seed-1" }, source: "server" },
    },
  ];

  const handler = makeHandler(actions);
  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.schema, "poker-hand-history@1");
  assert.equal(payload.tableId, tableId);
  assert.equal(payload.handId, handId);
  assert.equal(payload.stateVersion, 12);
  assert.equal(payload.table.maxPlayers, 6);
  assert.equal(payload.seats.length, 1);
  assert.equal(payload.seats[0].userId, userId);
  assert.equal(payload.actions.length, 1);
  assert.equal(payload.actions[0].type, "START_HAND");
  assert.deepEqual(payload.actions[0].meta, { source: "server" });
  assert.equal(JSON.stringify(payload).includes("handSeed"), false);

  const prev = process.env.POKER_DEBUG_EXPORT;
  process.env.POKER_DEBUG_EXPORT = "true";
  try {
    const debugHandler = makeHandler(actions);
    const debugResponse = await debugHandler({
      httpMethod: "GET",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      queryStringParameters: { tableId, handId },
    });
    assert.equal(debugResponse.statusCode, 200);
    const debugPayload = JSON.parse(debugResponse.body);
    assert.deepEqual(debugPayload.actions[0].meta, { determinism: { handSeed: "seed-1" }, source: "server" });
    assert.ok(JSON.stringify(debugPayload).includes("handSeed"));
  } finally {
    if (prev === undefined) {
      delete process.env.POKER_DEBUG_EXPORT;
    } else {
      process.env.POKER_DEBUG_EXPORT = prev;
    }
  }
};

await run();
