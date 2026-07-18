import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { isStateStorageValid, normalizeJsonState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { readPokerBuyInEligibility } from "../netlify/functions/_shared/poker-buy-in-eligibility.mjs";

process.env.CHIPS_ENABLED = "1";

const genericEligibility = await readPokerBuyInEligibility(
  { unsafe: async () => [{ balance: 999 }] },
  { userId: "user-1", requiredBuyIn: 1000 }
);
assert.deepEqual(genericEligibility, { eligible: false, balance: 999, requiredBuyIn: 1000 });
await assert.rejects(
  readPokerBuyInEligibility(
    { unsafe: async () => [{ balance: -1 }] },
    { userId: "user-1", requiredBuyIn: 100 }
  ),
  /chips_balance_integrity_error/
);

const makeHandler = (queries, options = {}) =>
  loadPokerHandler("netlify/functions/poker-create-table.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: "user-1" }),
    klog: options.klog || (() => {}),
    notifyWsLobbyMaterialize: options.notifyWsLobbyMaterialize || (async () => ({ ok: true, skipped: true })),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          if (text.includes("account_type = 'user'")) {
            if (options.balanceError) throw new Error("balance_read_failed");
            if (options.missingAccount) return [];
            return [{ balance: options.balance ?? 100 }];
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
  const stateInsertCall = queries.find((entry) => entry.query.toLowerCase().includes("insert into public.poker_state"));
  assert.ok(stateInsertCall, "expected insert into poker_state");
  const storedState = normalizeJsonState(stateInsertCall?.params?.[1]);
  assert.equal(isStateStorageValid(storedState), true, "create-table should persist a storage-valid init state");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.tableId, "table-1");
  assert.equal(notifications[0]?.maxPlayers, 6);
  assert.deepEqual(notifications[0]?.stakes, { sb: 1, bb: 2 });
  assert.equal(typeof notifications[0]?.klog, "function");
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

const runInsufficientBalance = async () => {
  const queries = [];
  const notifications = [];
  const handler = makeHandler(queries, {
    balance: 99,
    notifyWsLobbyMaterialize: async (payload) => { notifications.push(payload); },
  });
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ maxPlayers: 6, stakes: "1/2" }),
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), { error: "insufficient_chips", requiredBuyIn: 100, balance: 99 });
  assert.equal(queries.some((entry) => entry.query.toLowerCase().includes("insert into public.poker_tables")), false);
  assert.equal(notifications.length, 0);
};

const runMissingAccount = async () => {
  const queries = [];
  const handler = makeHandler(queries, { missingAccount: true });
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ maxPlayers: 6, stakes: "1/2" }),
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), { error: "insufficient_chips", requiredBuyIn: 100, balance: 0 });
};

const runBalanceReadFailure = async () => {
  const queries = [];
  const handler = makeHandler(queries, { balanceError: true });
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ maxPlayers: 6, stakes: "1/2" }),
  });
  assert.equal(response.statusCode, 500);
  assert.equal(JSON.parse(response.body).error, "server_error");
};

await runMissingStakes();
await runInvalidStakes();
await runSlashStakes();
await runSlowNotifyDoesNotDelayResponse();
await runMaintenanceGuard();
await runInsufficientBalance();
await runMissingAccount();
await runBalanceReadFailure();
