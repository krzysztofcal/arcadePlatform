import test from "node:test";
import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const origin = "https://example.test";

function makeHandler({ authResult, progression, calls }) {
  return loadPokerHandler("netlify/functions/poker-progression.mjs", {
    baseHeaders: () => ({ "cache-control": "no-store" }),
    corsHeaders: () => ({ "access-control-allow-origin": origin }),
    extractBearerToken: (headers) => String(headers?.authorization || "").replace(/^Bearer\s+/i, ""),
    verifySupabaseJwt: async (token) => {
      calls.tokens.push(token);
      return authResult;
    },
    beginSql: async (fn) => fn({ unsafe: async () => [] }),
    readPokerProgression: async (_tx, options) => {
      calls.progression.push(options);
      return progression;
    }
  });
}

test("poker progression endpoint requires a valid bearer identity before reading bankroll", async () => {
  const previous = process.env.CHIPS_ENABLED;
  process.env.CHIPS_ENABLED = "1";
  try {
    const calls = { tokens: [], progression: [] };
    const handler = makeHandler({
      authResult: { valid: false, reason: "invalid_signature" },
      progression: { balance: 550 },
      calls
    });
    const response = await handler({
      httpMethod: "GET",
      headers: { origin, authorization: "Bearer invalid-token" }
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(JSON.parse(response.body), { error: "unauthorized", reason: "invalid_signature" });
    assert.deepEqual(calls.tokens, ["invalid-token"]);
    assert.deepEqual(calls.progression, []);
  } finally {
    if (previous === undefined) delete process.env.CHIPS_ENABLED;
    else process.env.CHIPS_ENABLED = previous;
  }
});

test("poker progression endpoint reads progression only for the verified user", async () => {
  const previous = process.env.CHIPS_ENABLED;
  process.env.CHIPS_ENABLED = "1";
  try {
    const calls = { tokens: [], progression: [] };
    const handler = makeHandler({
      authResult: { valid: true, userId: "verified-user" },
      progression: {
        balance: 550,
        highestUnlockedBuyIn: 500,
        availableBuyIns: [500, 100]
      },
      calls
    });
    const response = await handler({
      httpMethod: "GET",
      headers: { origin, authorization: "Bearer verified-token" }
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      userId: "verified-user",
      balance: 550,
      highestUnlockedBuyIn: 500,
      availableBuyIns: [500, 100]
    });
    assert.deepEqual(calls.tokens, ["verified-token"]);
    assert.deepEqual(calls.progression, [{ userId: "verified-user" }]);
  } finally {
    if (previous === undefined) delete process.env.CHIPS_ENABLED;
    else process.env.CHIPS_ENABLED = previous;
  }
});
