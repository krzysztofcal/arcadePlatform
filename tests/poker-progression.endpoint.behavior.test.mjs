import test from "node:test";
import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const origin = "https://example.test";

function makeHandler({ authResult, progression, calls, unsafe, checkWsBuyInCapability = async () => ({ ok: true }), klog = () => {} }) {
  return loadPokerHandler("netlify/functions/poker-progression.mjs", {
    baseHeaders: () => ({ "cache-control": "no-store" }),
    corsHeaders: () => ({ "access-control-allow-origin": origin }),
    extractBearerToken: (headers) => String(headers?.authorization || "").replace(/^Bearer\s+/i, ""),
    verifySupabaseJwt: async (token) => {
      calls.tokens.push(token);
      return authResult;
    },
    klog,
    beginSql: async (fn) => fn({ unsafe: unsafe || (async () => []) }),
    readPokerProgression: async (_tx, options) => {
      calls.progression.push(options);
      return progression;
    },
    checkWsBuyInCapability
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
      availableBuyIns: [500, 100],
      rejoinableTableIds: [],
      tableAccess: null
    });
    assert.deepEqual(calls.tokens, ["verified-token"]);
    assert.deepEqual(calls.progression, [{ userId: "verified-user" }]);
  } finally {
    if (previous === undefined) delete process.env.CHIPS_ENABLED;
    else process.env.CHIPS_ENABLED = previous;
  }
});

test("poker progression table access allows available tiers, locks historical lower tiers, and preserves active rejoin", async () => {
  const previous = process.env.CHIPS_ENABLED;
  process.env.CHIPS_ENABLED = "1";
  try {
    const makeAccessHandler = (tableId, table, seatRows = []) => makeHandler({
      authResult: { valid: true, userId: "access-user" },
      progression: {
        balance: 5500,
        highestUnlockedBuyIn: 5000,
        availableBuyIns: [5000, 1000],
        tiers: [
          { buyIn: 100, unlockBankroll: 110, available: false },
          { buyIn: 1000, unlockBankroll: 1100, available: true },
          { buyIn: 5000, unlockBankroll: 5500, available: true }
        ]
      },
      calls: { tokens: [], progression: [] },
      checkWsBuyInCapability: async () => ({ ok: true }),
      unsafe: async (sql) => {
        const text = String(sql).toLowerCase();
        if (text.includes("select distinct t.id")) return [{ id: tableId }].filter(() => seatRows.length > 0);
        if (text.includes("select id, status, buy_in, stakes")) return [table];
        if (text.includes("select 1 from public.poker_seats")) return seatRows;
        return [];
      }
    });

    const allowed = await makeAccessHandler("table-5000", { id: "table-5000", status: "OPEN", buy_in: 5000, stakes: { sb: 50, bb: 100 } })({
      httpMethod: "GET", queryStringParameters: { tableId: "table-5000" }, headers: { origin, authorization: "Bearer token" }
    });
    assert.equal(JSON.parse(allowed.body).tableAccess.allowed, true);
    assert.equal(JSON.parse(allowed.body).tableAccess.reason, "available");

    const capabilityDenied = await makeHandler({
      authResult: { valid: true, userId: "access-user" },
      progression: {
        balance: 5500,
        highestUnlockedBuyIn: 5000,
        availableBuyIns: [5000, 1000],
        tiers: [{ buyIn: 5000, unlockBankroll: 5500, available: true }]
      },
      calls: { tokens: [], progression: [] },
      checkWsBuyInCapability: async () => ({ ok: false, reason: "buy_in_capability_unavailable" }),
      unsafe: async (sql) => {
        const text = String(sql).toLowerCase();
        if (text.includes("select id, status, buy_in, stakes")) return [{ id: "table-5000", status: "OPEN", buy_in: 5000, stakes: { sb: 50, bb: 100 } }];
        return [];
      }
    })({
      httpMethod: "GET", queryStringParameters: { tableId: "table-5000" }, headers: { origin, authorization: "Bearer token" }
    });
    assert.deepEqual(JSON.parse(capabilityDenied.body).tableAccess, {
      tableId: "table-5000", buyIn: 5000, allowed: false, rejoin: false, reason: "ws_buy_in_capability_unavailable"
    });

    const locked = await makeAccessHandler("table-100", { id: "table-100", status: "OPEN", buy_in: 100, stakes: { sb: 1, bb: 2 } })({
      httpMethod: "GET", queryStringParameters: { tableId: "table-100" }, headers: { origin, authorization: "Bearer token" }
    });
    assert.equal(JSON.parse(locked.body).tableAccess.allowed, false);
    assert.equal(JSON.parse(locked.body).tableAccess.reason, "buy_in_tier_locked");

    const rejoin = await makeAccessHandler("table-100", { id: "table-100", status: "OPEN", buy_in: 100, stakes: { sb: 1, bb: 2 } }, [{ ok: 1 }])({
      httpMethod: "GET", queryStringParameters: { tableId: "table-100" }, headers: { origin, authorization: "Bearer token" }
    });
    assert.deepEqual(JSON.parse(rejoin.body).tableAccess, { tableId: "table-100", buyIn: 100, allowed: true, rejoin: true, reason: "rejoin" });
  } finally {
    if (previous === undefined) delete process.env.CHIPS_ENABLED;
    else process.env.CHIPS_ENABLED = previous;
  }
});
