import assert from "node:assert/strict";
import test from "node:test";

const { createAdminTableEvaluateHandler } = await import("../netlify/functions/admin-table-evaluate.mjs");
const { createAdminTableCleanupHandler } = await import("../netlify/functions/admin-table-cleanup.mjs");
const { createAdminTableForceCloseHandler } = await import("../netlify/functions/admin-table-force-close.mjs");
const { createAdminTableBotClaimsRecoveryHandler } = await import("../netlify/functions/admin-table-bot-claims-recovery.mjs");

function createGetEvent(queryStringParameters = {}) {
  return {
    httpMethod: "GET",
    headers: { origin: "https://arcade.test" },
    queryStringParameters,
  };
}

function createPostEvent(body) {
  return {
    httpMethod: "POST",
    headers: { origin: "https://arcade.test" },
    body: JSON.stringify(body),
  };
}

test("admin-table-evaluate returns janitor classification", async () => {
  const handler = createAdminTableEvaluateHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    evaluateTable: async (tableId) => {
      assert.equal(tableId, "00000000-0000-4000-8000-000000000111");
      return {
        table: { tableId },
        janitor: { healthy: false, classification: "stale_human_seat", action: "stale_seat_cleanup", reasonCode: "stale_human_last_seen_expired" },
      };
    },
  });
  const response = await handler(createGetEvent({ tableId: "00000000-0000-4000-8000-000000000111" }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.janitor.action, "stale_seat_cleanup");
});

test("admin-table-cleanup rejects unauthorized callers", async () => {
  const handler = createAdminTableCleanupHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => {
      const error = new Error("admin_required");
      error.status = 403;
      error.code = "admin_required";
      throw error;
    },
  });
  const response = await handler(createPostEvent({
    tableId: "00000000-0000-4000-8000-000000000111",
    action: "reconcile",
    reason: "manual reconcile",
    idempotencyKey: "client-1",
  }));

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: "admin_required" });
});

test("admin-table-cleanup forwards action payload", async () => {
  let seen = null;
  const handler = createAdminTableCleanupHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    runAdminTableAction: async (payload) => {
      seen = payload;
      return { ok: true, changed: true, status: "cleaned_closed", effectiveAction: "zombie_cleanup" };
    },
  });
  const response = await handler(createPostEvent({
    tableId: "00000000-0000-4000-8000-000000000111",
    action: "reconcile",
    reason: "manual reconcile",
    idempotencyKey: "client-2",
  }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(seen.adminUserId, "00000000-0000-4000-8000-000000000010");
  assert.equal(seen.tableId, "00000000-0000-4000-8000-000000000111");
  assert.equal(seen.requestedAction, "reconcile");
  assert.match(seen.idempotencyKey, /^admin-table:/);
  assert.equal(body.result.status, "cleaned_closed");
});

test("admin-table-force-close requires explicit confirmation token", async () => {
  const handler = createAdminTableForceCloseHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
  });
  const response = await handler(createPostEvent({
    tableId: "00000000-0000-4000-8000-000000000111",
    reason: "dangerous close",
    idempotencyKey: "client-3",
    confirmAction: "force_close",
    confirmationToken: "wrong-token",
  }));

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "invalid_confirmation_token" });
});

test("admin-table-force-close forwards dangerous action only after validation", async () => {
  let seen = null;
  const handler = createAdminTableForceCloseHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    runAdminTableAction: async (payload) => {
      seen = payload;
      return { ok: true, changed: true, status: "force_closed" };
    },
  });
  const response = await handler(createPostEvent({
    tableId: "00000000-0000-4000-8000-000000000111",
    reason: "dangerous close",
    idempotencyKey: "client-4",
    confirmAction: "force_close",
    confirmationToken: "force-close:00000000-0000-4000-8000-000000000111",
  }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(seen.requestedAction, "force_close");
  assert.match(seen.idempotencyKey, /^admin-force-close:/);
  assert.equal(body.result.status, "force_closed");
});

test("bot claims recovery remains fail-closed outside exact Preview stage identity", async () => {
  const handler = createAdminTableBotClaimsRecoveryHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    buildStageIdentity: () => ({
      environmentContext: "production",
      databaseTarget: "production",
      stageProjectRefMatches: false,
      databaseMatchesSupabaseProjectRef: true,
      serviceRoleStageProjectRefMatches: false,
    }),
  });
  const response = await handler(createPostEvent({
    mode: "preflight",
    tableId: "00000000-0000-4000-8000-000000000111",
  }));

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: "preview_only" });
});

test("bot claims recovery proxies an explicitly confirmed execute request", async () => {
  let upstream = null;
  const handler = createAdminTableBotClaimsRecoveryHandler({
    env: {
      CHIPS_ENABLED: "1",
      POKER_WS_INTERNAL_BASE_URL: "https://ws-preview.kcswh.pl",
      POKER_WS_INTERNAL_TOKEN: "internal-test-token",
    },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    buildStageIdentity: () => ({
      environmentContext: "deploy-preview",
      databaseTarget: "stage",
      stageProjectRefMatches: true,
      databaseMatchesSupabaseProjectRef: true,
      serviceRoleStageProjectRefMatches: true,
    }),
    fetchImpl: async (_url, options) => {
      upstream = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          eligible: true,
          changed: true,
          closed: true,
          environment: "ws-preview",
          stateVersion: 78,
          finalStateVersion: 80,
          inputHash: "a".repeat(64),
          bots: [],
        }),
      };
    },
  });
  const response = await handler(createPostEvent({
    mode: "execute",
    tableId: "00000000-0000-4000-8000-000000000111",
    expectedStateVersion: 78,
    expectedInputHash: "a".repeat(64),
    idempotencyKey: "client-recovery-1",
    confirmation: "REPAIR BOT CLAIMS AND CLOSE",
    reason: "approved Preview repair",
  }));

  assert.equal(response.statusCode, 200);
  assert.equal(upstream.mode, "execute");
  assert.equal(upstream.adminUserId, "00000000-0000-4000-8000-000000000010");
  assert.match(upstream.requestId, /^admin-recovery:/);
});
