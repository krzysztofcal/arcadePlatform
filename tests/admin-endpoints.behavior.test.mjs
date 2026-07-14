import assert from "node:assert/strict";
import test from "node:test";

const { createAdminMeHandler } = await import("../netlify/functions/admin-me.mjs");
const { createAdminUserBalanceHandler } = await import("../netlify/functions/admin-user-balance.mjs");
const { createAdminUserLedgerHandler } = await import("../netlify/functions/admin-user-ledger.mjs");
const { createAdminWsPreviewBotReactionHandler, parseBody: parseBotReactionBody } = await import("../netlify/functions/admin-ws-preview-bot-reaction.mjs");

function event(method, queryStringParameters = {}, body = null) {
  return {
    httpMethod: method,
    headers: { origin: "https://arcade.test" },
    queryStringParameters,
    body,
  };
}

function previewStageIdentity() {
  return {
    environmentContext: "deploy-preview",
    databaseTarget: "stage",
    stageProjectRefMatches: true,
    databaseMatchesSupabaseProjectRef: true,
  };
}

test("admin-me returns admin payload for an allowlisted caller", async () => {
  const handler = createAdminMeHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
  });
  const response = await handler(event("GET"));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(body, {
    ok: true,
    isAdmin: true,
    userId: "00000000-0000-4000-8000-000000000010",
  });
});

test("admin-me fails closed for non-admin callers", async () => {
  const handler = createAdminMeHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => {
      const error = new Error("admin_required");
      error.status = 403;
      error.code = "admin_required";
      throw error;
    },
  });
  const response = await handler(event("GET"));

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: "admin_required" });
});

test("admin WS Preview bot reaction proxy forwards only a controlled payload with trusted admin identity", async () => {
  let seen = null;
  const handler = createAdminWsPreviewBotReactionHandler({
    env: {
      POKER_WS_INTERNAL_BASE_URL: "https://ws-preview.kcswh.pl",
      POKER_WS_INTERNAL_TOKEN: "preview-internal-token",
    },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    buildStageIdentity: previewStageIdentity,
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          environment: "ws-preview",
          mode: "override",
          defaults: { minMs: 2000, maxMs: 4000 },
          active: { minMs: 500, maxMs: 500 },
          override: { minMs: 500, maxMs: 500, updatedBy: "00000000-0000-4000-8000-000000000010" },
        }),
      };
    },
  });
  const response = await handler(event("POST", {}, JSON.stringify({ mode: "override", minMs: 500, maxMs: 500 })));

  assert.equal(response.statusCode, 200);
  assert.equal(seen.url, "https://ws-preview.kcswh.pl/internal/admin/bot-reaction");
  assert.equal(seen.options.headers.authorization, "Bearer preview-internal-token");
  assert.deepEqual(JSON.parse(seen.options.body), {
    mode: "override",
    minMs: 500,
    maxMs: 500,
    updatedBy: "00000000-0000-4000-8000-000000000010",
  });
});

test("admin WS Preview bot reaction proxy rejects non-admin and non-preview requests before contacting WS", async () => {
  let fetchCalls = 0;
  const deps = {
    env: {
      POKER_WS_INTERNAL_BASE_URL: "https://ws-preview.kcswh.pl",
      POKER_WS_INTERNAL_TOKEN: "preview-internal-token",
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("unexpected_fetch");
    },
  };
  const nonAdminHandler = createAdminWsPreviewBotReactionHandler({
    ...deps,
    requireAdminUser: async () => {
      const error = new Error("admin_required");
      error.status = 403;
      error.code = "admin_required";
      throw error;
    },
    buildStageIdentity: previewStageIdentity,
  });
  const nonAdminResponse = await nonAdminHandler(event("GET"));
  assert.equal(nonAdminResponse.statusCode, 403);

  const productionHandler = createAdminWsPreviewBotReactionHandler({
    ...deps,
    requireAdminUser: async () => ({ userId: "admin-1" }),
    buildStageIdentity: () => ({ ...previewStageIdentity(), environmentContext: "production", databaseTarget: "production" }),
  });
  const productionResponse = await productionHandler(event("GET"));
  assert.equal(productionResponse.statusCode, 403);
  assert.deepEqual(JSON.parse(productionResponse.body), { error: "preview_only" });
  assert.equal(fetchCalls, 0);
});

test("admin WS Preview bot reaction body allowlist rejects unexpected fields", () => {
  assert.deepEqual(parseBotReactionBody(JSON.stringify({ mode: "default" })), { mode: "default" });
  assert.deepEqual(parseBotReactionBody(JSON.stringify({ mode: "override", minMs: 500, maxMs: 500 })), { mode: "override", minMs: 500, maxMs: 500 });
  assert.throws(() => parseBotReactionBody(JSON.stringify({ mode: "default", minMs: 500 })), { code: "invalid_request" });
  assert.throws(() => parseBotReactionBody(JSON.stringify({ mode: "override", minMs: 500, maxMs: 500, updatedBy: "spoofed" })), { code: "invalid_request" });
});

test("admin WS Preview bot reaction proxy rejects a non-JSON Caddy fallback response", async () => {
  const handler = createAdminWsPreviewBotReactionHandler({
    env: {
      POKER_WS_INTERNAL_BASE_URL: "https://ws-preview.kcswh.pl",
      POKER_WS_INTERNAL_TOKEN: "preview-internal-token",
    },
    requireAdminUser: async () => ({ userId: "admin-1" }),
    buildStageIdentity: previewStageIdentity,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("not_json");
      },
    }),
  });
  const response = await handler(event("GET"));

  assert.equal(response.statusCode, 502);
  assert.deepEqual(JSON.parse(response.body), { error: "ws_preview_unavailable" });
});

test("admin-user-balance returns target user balance", async () => {
  let seenUserId = null;
  const handler = createAdminUserBalanceHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    getUserBalance: async (userId) => {
      seenUserId = userId;
      return { accountId: "acct-55", balance: 1234, nextEntrySeq: 9, status: "active" };
    },
  });
  const response = await handler(event("GET", { userId: "00000000-0000-4000-8000-000000000055" }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(seenUserId, "00000000-0000-4000-8000-000000000055");
  assert.equal(body.balance, 1234);
  assert.equal(body.userId, "00000000-0000-4000-8000-000000000055");
});

test("admin-user-ledger returns target user entries with cursor params", async () => {
  let seenArgs = null;
  const handler = createAdminUserLedgerHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    listUserLedger: async (userId, options) => {
      seenArgs = { userId, options };
      return {
        items: [
          {
            entry_seq: 7,
            amount: -50,
            tx_type: "ADMIN_ADJUST",
            description: "rollback",
          },
        ],
        nextCursor: "cursor-2",
      };
    },
  });
  const response = await handler(event("GET", {
    userId: "00000000-0000-4000-8000-000000000077",
    cursor: "cursor-1",
    limit: "15",
  }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-chips-ledger-version"] != null, true);
  assert.deepEqual(seenArgs, {
    userId: "00000000-0000-4000-8000-000000000077",
    options: { cursor: "cursor-1", limit: 15 },
  });
  assert.equal(body.items.length, 1);
  assert.equal(body.nextCursor, "cursor-2");
});
