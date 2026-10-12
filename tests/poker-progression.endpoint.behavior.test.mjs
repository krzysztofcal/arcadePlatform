import test from "node:test";
import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

import { evaluatePokerProgression } from "../shared/poker-domain/poker-progression.mjs";

const origin = "https://example.test";

function makeHandler({ poolSchema = true, authResult, progression, calls, unsafe, checkWsBuyInCapability = async () => ({ ok: true }), klog = () => {} }) {
  const fallbackUnsafe = async (sql) => {
    if (String(sql).toLowerCase().includes("select poker_auto_class, poker_access_override")) {
      return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 1 }];
    }
    return [];
  };
  return loadPokerHandler("netlify/functions/poker-progression.mjs", {
    baseHeaders: () => ({ "cache-control": "no-store" }),
    corsHeaders: () => ({ "access-control-allow-origin": origin }),
    extractBearerToken: (headers) => String(headers?.authorization || "").replace(/^Bearer\s+/i, ""),
    verifySupabaseJwt: async (token) => {
      calls.tokens.push(token);
      return authResult;
    },
    klog,
    beginSql: async (fn) => fn({ unsafe: async (sql, params) => String(sql).includes("to_regclass") ? [{ available: poolSchema }] : (unsafe || fallbackUnsafe)(sql, params) }),
    readPokerProgression: async (_tx, options) => {
      calls.progression.push(options);
      return progression?.tiers ? progression : {
        ...progression,
        tiers: (progression?.availableBuyIns || []).map((buyIn) => ({ buyIn })),
        enabledBuyIns: progression?.availableBuyIns || []
      };
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
      tiers: [{ buyIn: 500 }, { buyIn: 100 }],
      enabledBuyIns: [500, 100],
      singlePlayerAvailableBuyIns: [100, 500],
      pokerAccess: {
        automaticClass: "NORMAL",
        override: "AUTO",
        effectiveClass: "NORMAL",
        revision: 1,
        automaticSlowAt: null
      },
      rejoinableTableIds: [],
      singlePlayerRejoinableTableIds: [],
      singlePlayerRejoinableTables: [],
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
          { buyIn: 100, unlockBankroll: 100, available: false },
          { buyIn: 1000, unlockBankroll: 1100, available: true },
          { buyIn: 5000, unlockBankroll: 5500, available: true }
        ]
      },
      calls: { tokens: [], progression: [] },
      checkWsBuyInCapability: async () => ({ ok: true }),
      unsafe: async (sql) => {
        const text = String(sql).toLowerCase();
        if (text.includes("select poker_auto_class, poker_access_override")) return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 1 }];
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
        if (text.includes("select poker_auto_class, poker_access_override")) return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 1 }];
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
    assert.equal(JSON.parse(locked.body).tableAccess.viewAllowed, true);
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


test("pre-migration progression/table access stays available without new schema columns", async () => {
  const previous = process.env.CHIPS_ENABLED;
  process.env.CHIPS_ENABLED = "1";
  try {
    for (const rejoin of [false, true]) {
      const handler = makeHandler({
        poolSchema: false,
        authResult: { valid: true, userId: "legacy-user" },
        progression: { balance: 110, availableBuyIns: [100], tiers: [{ buyIn: 100 }] },
        calls: { tokens: [], progression: [] },
        unsafe: async (query) => {
          assert.doesNotMatch(query, /is_slow_only|poker_auto_class|poker_access_policy/);
          if (query.includes("select id, status")) return [{ id: "legacy-table", status: "OPEN", buy_in: 100, stakes: { sb: 1, bb: 2 } }];
          if (query.includes("select 1 from public.poker_seats")) return rejoin ? [{}] : [];
          return [];
        }
      });
      const response = await handler({ httpMethod: "GET", queryStringParameters: { tableId: "legacy-table" }, headers: { origin, authorization: "Bearer token" } });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.pokerAccess.effectiveClass, "NORMAL");
      assert.equal(body.tableAccess.allowed, true);
      assert.equal(body.tableAccess.rejoin, rejoin);
    }
  } finally {
    if (previous === undefined) delete process.env.CHIPS_ENABLED;
    else process.env.CHIPS_ENABLED = previous;
  }
});

test("table access follows shared activation, bankroll and financed rejoin", async () => {
  const previous = process.env.CHIPS_ENABLED;
  process.env.CHIPS_ENABLED = "1";
  try {
    for (const [enabledBuyIns, balance, buyIn, rejoin, allowed, availableBuyIns] of [
      [[100, 500], 1_000_000, 500, false, true, [500, 100]],
      [[100, 500], 1_000_000, 1000, false, false, [500, 100]],
      [[100, 500], 1_000_000, 1000, true, true, [500, 100]],
      [[100, 500, 1000], 1099, 1000, false, false, [500, 100]],
      [[100, 500, 1000], 1100, 1000, false, true, [1000, 500]]
    ]) {
      const progression = evaluatePokerProgression({ balance, tiers: [100, 500, 1000, 5000], enabledBuyIns });
      const handler = makeHandler({
        authResult: { valid: true, userId: "wealthy" }, progression,
        calls: { tokens: [], progression: [] },
        unsafe: async (sql) => {
          const text = String(sql).toLowerCase();
          if (text.includes("select poker_auto_class, poker_access_override")) return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 1 }];
          if (text.includes("select id, status, buy_in, stakes")) return [{ id: "frontier-table", status: "OPEN", buy_in: buyIn, stakes: { sb: buyIn / 100, bb: buyIn / 50 } }];
          if (text.includes("select 1 from public.poker_seats")) return rejoin ? [{ ok: 1 }] : [];
          return [];
        }
      });
      const response = await handler({ httpMethod: "GET", queryStringParameters: { tableId: "frontier-table" }, headers: { origin, authorization: "Bearer token" } });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.deepEqual(body.availableBuyIns, availableBuyIns);
      assert.deepEqual(body.enabledBuyIns, enabledBuyIns);
      assert.equal(body.tableAccess.allowed, allowed);
      assert.equal(body.tableAccess.reason, rejoin ? "rejoin" : allowed ? "available" : "buy_in_tier_locked");
    }
  } finally {
    if (previous === undefined) delete process.env.CHIPS_ENABLED;
    else process.env.CHIPS_ENABLED = previous;
  }
});

test("poker progression returns active Single Player tables for user resume", async () => {
  const previous = process.env.CHIPS_ENABLED;
  process.env.CHIPS_ENABLED = "1";
  try {
    const handler = makeHandler({
      authResult: { valid: true, userId: "sp-player" },
      progression: { balance: 1000, highestUnlockedBuyIn: 500, availableBuyIns: [500, 100] },
      calls: { tokens: [], progression: [] },
      unsafe: async (sql) => {
        const text = String(sql).toLowerCase();
        if (text.includes("select poker_auto_class, poker_access_override")) {
          return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 1 }];
        }
        if (text.includes("coalesce(t.is_single_player, false) = false")) {
          return [];
        }
        if (text.includes("t.is_single_player = true")) {
          return [
            { id: "sp-table-1", buy_in: 500, stakes: { sb: 5, bb: 10 } },
            { id: "sp-table-2", buy_in: 100, stakes: { sb: 1, bb: 2 } }
          ];
        }
        return [];
      }
    });
    const response = await handler({
      httpMethod: "GET",
      headers: { origin, authorization: "Bearer valid-token" }
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.deepEqual(body.rejoinableTableIds, [], "online rejoinable tables must remain empty");
    assert.deepEqual(body.singlePlayerRejoinableTableIds, ["sp-table-1", "sp-table-2"]);
    assert.deepEqual(body.singlePlayerRejoinableTables, [
      { id: "sp-table-1", buyIn: 500, stakes: { sb: 5, bb: 10 } },
      { id: "sp-table-2", buyIn: 100, stakes: { sb: 1, bb: 2 } }
    ]);
  } finally {
    if (previous === undefined) delete process.env.CHIPS_ENABLED;
    else process.env.CHIPS_ENABLED = previous;
  }
});

test("high-bankroll progression offers Single Player tiers independently and allows its owner table", async () => {
  const previous = process.env.CHIPS_ENABLED;
  process.env.CHIPS_ENABLED = "1";
  try {
    const tiers = [100, 500, 1000, 2500, 5000, 10000];
    const handler = makeHandler({
      authResult: { valid: true, userId: "sp-player" },
      progression: evaluatePokerProgression({ balance: 11000, tiers, enabledBuyIns: tiers }),
      calls: { tokens: [], progression: [] },
      unsafe: async (sql) => {
        if (sql.includes("select poker_auto_class")) return [{ poker_auto_class: "NORMAL", poker_access_override: "AUTO", poker_access_revision: 1 }];
        if (sql.includes("select id, status, buy_in, stakes")) return [{ id: "sp-table", status: "OPEN", buy_in: 1000, stakes: { sb: 10, bb: 20 }, is_single_player: true, created_by: "sp-player" }];
        return [];
      }
    });
    const response = await handler({ httpMethod: "GET", queryStringParameters: { tableId: "sp-table" }, headers: { origin, authorization: "Bearer token" } });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.deepEqual(body.availableBuyIns, [10000, 5000]);
    assert.deepEqual(body.singlePlayerAvailableBuyIns, [1000, 500, 100]);
    assert.equal(body.tableAccess.allowed, true);
  } finally {
    if (previous === undefined) delete process.env.CHIPS_ENABLED;
    else process.env.CHIPS_ENABLED = previous;
  }
});

test('ended Single Player participation denies table access while Online keeps fresh admission', async () => {
  const previous = process.env.CHIPS_ENABLED; process.env.CHIPS_ENABLED = '1';
  try {
    for (const isSinglePlayer of [true, false]) {
      const handler = makeHandler({ authResult: { valid: true, userId: 'owner' },
        progression: evaluatePokerProgression({ balance: 550, tiers: [100,500], enabledBuyIns: [100,500] }),
        calls: { tokens: [], progression: [] },
        unsafe: async sql => {
          if (sql.includes('select poker_auto_class')) return [{ poker_auto_class: 'NORMAL', poker_access_override: 'AUTO', poker_access_revision: 1 }];
          if (sql.includes('select id, status, buy_in, stakes')) return [{ id: 'ended-table', status: 'OPEN', buy_in: 100, stakes: { sb: 1, bb: 2 }, is_single_player: isSinglePlayer, created_by: 'owner', has_human_participant: true }];
          return [];
        }
      });
      const response = await handler({ httpMethod: 'GET', queryStringParameters: { tableId: 'ended-table' }, headers: { origin, authorization: 'Bearer token' } });
      const access = JSON.parse(response.body).tableAccess;
      assert.equal(access.allowed, !isSinglePlayer);
      assert.equal(access.reason, isSinglePlayer ? 'single_player_participation_ended' : 'available');
      assert.equal(access.rejoin, false);
    }
  } finally { if (previous === undefined) delete process.env.CHIPS_ENABLED; else process.env.CHIPS_ENABLED = previous; }
});

test("RESTRICTED Single Player Resume is denied while Online active-seat rejoin remains allowed", async () => {
  const previous = process.env.CHIPS_ENABLED;
  process.env.CHIPS_ENABLED = "1";
  try {
    for (const isSinglePlayer of [true, false]) {
      const handler = makeHandler({
        authResult: { valid: true, userId: "restricted-player" },
        progression: evaluatePokerProgression({ balance: 550, tiers: [100,500], enabledBuyIns: [100,500] }),
        calls: { tokens: [], progression: [] },
        unsafe: async (sql) => {
          if (sql.includes("select poker_auto_class")) return [{ poker_auto_class: "NORMAL", poker_access_override: "FORCE_RESTRICTED", poker_access_revision: 1 }];
          if (sql.includes("select id, status, buy_in, stakes")) return [{ id: "restricted-table", status: "OPEN", buy_in: 500, stakes: { sb: 5, bb: 10 }, is_single_player: isSinglePlayer, created_by: "restricted-player" }];
          if (sql.includes("select 1 from public.poker_seats")) return [{ seated: 1 }];
          return [];
        }
      });
      const response = await handler({ httpMethod: "GET", queryStringParameters: { tableId: "restricted-table" }, headers: { origin, authorization: "Bearer token" } });
      assert.equal(response.statusCode, 200);
      const access = JSON.parse(response.body).tableAccess;
      assert.equal(access.allowed, !isSinglePlayer);
      assert.equal(access.rejoin, !isSinglePlayer);
      assert.equal(access.reason, isSinglePlayer ? "single_player_restricted_unavailable" : "rejoin");
    }
  } finally {
    if (previous === undefined) delete process.env.CHIPS_ENABLED;
    else process.env.CHIPS_ENABLED = previous;
  }
});



test('deferred Single Player Leave denies table access despite ACTIVE seat; Online unchanged', async () => {
  const previous = process.env.CHIPS_ENABLED; process.env.CHIPS_ENABLED = '1';
  try {
    for (const single of [true, false]) {
      const handler = makeHandler({ authResult: { valid: true, userId: 'owner' }, progression: evaluatePokerProgression({ balance: 550, tiers: [100,500], enabledBuyIns: [100,500] }), calls: { tokens: [], progression: [] }, unsafe: async sql => {
        if (sql.includes('select poker_auto_class')) return [{ poker_auto_class: 'NORMAL', poker_access_override: 'AUTO', poker_access_revision: 1 }];
        if (sql.includes('select id, status, buy_in, stakes')) return [{ id: 'deferred', status: 'OPEN', buy_in: 100, stakes: { sb: 1, bb: 2 }, is_single_player: single, created_by: 'owner', has_human_participant: true, has_left: true }];
        if (sql.includes('select 1 from public.poker_seats')) return [{ seated: 1 }];
        return [];
      } });
      const response = await handler({ httpMethod: 'GET', queryStringParameters: { tableId: 'deferred' }, headers: { origin, authorization: 'Bearer token' } });
      const access = JSON.parse(response.body).tableAccess;
      assert.equal(access.allowed, !single); assert.equal(access.rejoin, !single);
      assert.equal(access.reason, single ? 'single_player_participation_ended' : 'rejoin');
    }
  } finally { if (previous === undefined) delete process.env.CHIPS_ENABLED; else process.env.CHIPS_ENABLED = previous; }
});

test('Single Player Resume list excludes deferred Leave and foreign tables using real state SQL', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(); const previous = process.env.CHIPS_ENABLED; process.env.CHIPS_ENABLED = '1';
  try {
    await db.exec(`create table poker_tables(id text, buy_in int, stakes jsonb, status text, is_single_player boolean, created_by text, created_at timestamptz default now());
      create table poker_seats(table_id text, user_id text, status text, last_seen_at timestamptz, created_at timestamptz default now());
      create table poker_state(table_id text, state jsonb);
      insert into poker_tables(id,buy_in,stakes,status,is_single_player,created_by) values ('active',100,'{}','OPEN',true,'owner'),('left',100,'{}','OPEN',true,'owner'),('foreign',100,'{}','OPEN',true,'other');
      insert into poker_seats(table_id,user_id,status) values ('active','owner','ACTIVE'),('left','owner','ACTIVE'),('foreign','other','ACTIVE');
      insert into poker_state values ('active','{}'),('left','{"leftTableByUserId":{"owner":true}}'),('foreign','{}');`);
    const handler = makeHandler({ authResult: { valid: true, userId: 'owner' }, progression: evaluatePokerProgression({ balance: 550, tiers: [100,500], enabledBuyIns: [100,500] }), calls: { tokens: [], progression: [] }, unsafe: async (sql, params) => {
      if (sql.includes('select t.id, t.buy_in, t.stakes')) return (await db.query(sql, params)).rows;
      if (sql.includes('select poker_auto_class')) return [{ poker_auto_class: 'NORMAL', poker_access_override: 'AUTO', poker_access_revision: 1 }];
      return [];
    } });
    const response = await handler({ httpMethod: 'GET', headers: { origin, authorization: 'Bearer token' } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body).singlePlayerRejoinableTableIds, ['active']);
  } finally { await db.close(); if (previous === undefined) delete process.env.CHIPS_ENABLED; else process.env.CHIPS_ENABLED = previous; }
});
