import assert from "node:assert/strict";
import test from "node:test";

const { createAdminTableEvaluateHandler } = await import("../netlify/functions/admin-table-evaluate.mjs");
const { createAdminTableCleanupHandler } = await import("../netlify/functions/admin-table-cleanup.mjs");
const { createAdminTableForceCloseHandler } = await import("../netlify/functions/admin-table-force-close.mjs");

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
