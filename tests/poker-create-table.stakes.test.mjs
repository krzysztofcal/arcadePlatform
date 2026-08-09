import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isStateStorageValid, normalizeJsonState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { checkWsBuyInCapability } from "../netlify/functions/_shared/poker-ws-runtime-notify.mjs";

process.env.CHIPS_ENABLED = "1";

const makeHandler = (queries, options = {}) =>
  loadPokerHandler("netlify/functions/poker-create-table.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: "user-1" }),
    klog: options.klog || (() => {}),
    checkWsBuyInCapability: options.checkWsBuyInCapability || (async () => ({ ok: true })),
    notifyWsLobbyMaterialize: options.notifyWsLobbyMaterialize || (async () => ({ ok: true, skipped: true })),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          if (text.includes("account_type = 'user'")) {
            if (options.balanceError) throw new Error("balance_read_failed");
            if (options.missingAccount) return [];
            return [{ balance: options.balance ?? 110 }];
          }
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
  assert.equal(response.statusCode, 200);
  const insertCall = queries.find((entry) => entry.query.toLowerCase().includes("insert into public.poker_tables"));
  assert.deepEqual(JSON.parse(insertCall.params?.[0]), { sb: 1, bb: 2 });
};

const runInvalidStakes = async () => {
  const queries = [];
  const handler = makeHandler(queries);
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ maxPlayers: 6, stakes: { sb: 2, bb: 2 } }),
  });
  assert.equal(response.statusCode, 200);
  const insertCall = queries.find((entry) => entry.query.toLowerCase().includes("insert into public.poker_tables"));
  assert.deepEqual(JSON.parse(insertCall.params?.[0]), { sb: 1, bb: 2 });
};

const runInvalidBuyIn = async () => {
  const queries = [];
  const handler = makeHandler(queries);
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ maxPlayers: 6, stakes: "1/2", buyIn: 500.5 }),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, "invalid_buy_in");
  assert.equal(queries.length, 0);
};

const runSlashStakes = async () => {
  const queries = [];
  const notifications = [];
  const handler = makeHandler(queries, {
    notifyWsLobbyMaterialize: async (payload) => {
      notifications.push(payload);
      return { ok: true };
    }
  });
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
  assert.deepEqual(JSON.parse(insertCall.params?.[0]), { sb: 1, bb: 2 });
  assert.equal(insertCall.params?.[1], 100);
  const stateInsertCall = queries.find((entry) => entry.query.toLowerCase().includes("insert into public.poker_state"));
  assert.ok(stateInsertCall, "expected insert into poker_state");
  const storedState = normalizeJsonState(stateInsertCall?.params?.[1]);
  assert.equal(isStateStorageValid(storedState), true, "create-table should persist a storage-valid init state");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.tableId, "table-1");
  assert.equal(notifications[0]?.maxPlayers, 6);
  assert.deepEqual(notifications[0]?.stakes, { sb: 1, bb: 2 });
  assert.equal(notifications[0]?.buyIn, 100);
  assert.equal(typeof notifications[0]?.klog, "function");
};

const runCustomBuyIn = async () => {
  const queries = [];
  const notifications = [];
  let capabilityChecks = 0;
  const handler = makeHandler(queries, {
    balance: 550,
    checkWsBuyInCapability: async () => {
      capabilityChecks += 1;
      return { ok: true };
    },
    notifyWsLobbyMaterialize: async (payload) => {
      notifications.push(payload);
      return { ok: true };
    }
  });
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ maxPlayers: 6, stakes: "1/2", buyIn: 500 }),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(capabilityChecks, 1);
  const insertCall = queries.find((entry) => entry.query.toLowerCase().includes("insert into public.poker_tables"));
  assert.ok(insertCall, "expected insert into poker_tables");
  assert.equal(insertCall.params?.[1], 500);
  assert.deepEqual(JSON.parse(insertCall.params?.[0]), { sb: 5, bb: 10 });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.buyIn, 500);
  assert.deepEqual(notifications[0]?.stakes, { sb: 5, bb: 10 });
};

const runCustomBuyInRolloutGuard = async () => {
  const queries = [];
  const handler = makeHandler(queries, {
    balance: 550,
    checkWsBuyInCapability: async () => ({ ok: false, reason: "buy_in_capability_unavailable" })
  });
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ maxPlayers: 6, stakes: "1/2", buyIn: 500 }),
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: "ws_buy_in_capability_unavailable" });
  assert.equal(queries.some((entry) => entry.query.toLowerCase().includes("insert into public.poker_tables")), false, "custom buy-in must not create a DB table while the WS is too old");
};

const runLockedBuyIn = async () => {
  const queries = [];
  let capabilityChecks = 0;
  const handler = makeHandler(queries, {
    balance: 500,
    checkWsBuyInCapability: async () => {
      capabilityChecks += 1;
      return { ok: true };
    }
  });
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ maxPlayers: 6, buyIn: 500 })
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), {
    error: "buy_in_tier_locked",
    buyIn: 500,
    requiredBuyIn: 500,
    requiredBankroll: 550,
    balance: 500
  });
  assert.equal(capabilityChecks, 0, "locked buy-in should be rejected before the WS capability check");
  assert.equal(queries.some((entry) => entry.query.toLowerCase().includes("insert into public.poker_tables")), false);
};

const runWsCapabilityHeaderCheck = async () => {
  const supported = await checkWsBuyInCapability({
    env: { POKER_WS_INTERNAL_BASE_URL: "https://ws.example.test" },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name === "x-poker-buy-in-materialization" ? "2" : null }
    })
  });
  assert.equal(supported.ok, true);

  const legacy = await checkWsBuyInCapability({
    env: { POKER_WS_INTERNAL_BASE_URL: "https://ws.example.test" },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "1" }
    })
  });
  assert.equal(legacy.ok, false);
  assert.equal(legacy.reason, "buy_in_capability_unavailable");
};

const runSlowNotifyDoesNotDelayResponse = async () => {
  const queries = [];
  let resolveNotify;
  let notifyCalled = false;
  const pendingNotify = new Promise((resolve) => {
    resolveNotify = resolve;
  });
  const handler = makeHandler(queries, {
    notifyWsLobbyMaterialize: async () => {
      notifyCalled = true;
      return pendingNotify;
    }
  });
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ maxPlayers: 6, stakes: "1/2" }),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(notifyCalled, true, "create-table should trigger runtime notify");
  resolveNotify({ ok: true });
};

const runMaintenanceGuard = async () => {
  const queries = [];
  const handler = makeHandler(queries);
  process.env.CHIPS_ENABLED = "0";
  try {
    const response = await handler({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ maxPlayers: 6, stakes: "1/2" }),
    });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(JSON.parse(response.body), { error: "not_found" });
    assert.equal(queries.length, 0);
  } finally {
    process.env.CHIPS_ENABLED = "1";
  }
};

await runMissingStakes();
await runInvalidStakes();
await runInvalidBuyIn();
await runSlashStakes();
await runCustomBuyIn();
await runCustomBuyInRolloutGuard();
await runLockedBuyIn();
await runWsCapabilityHeaderCheck();
await runSlowNotifyDoesNotDelayResponse();
await runMaintenanceGuard();
