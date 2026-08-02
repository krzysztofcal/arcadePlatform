import assert from "node:assert/strict";
import test from "node:test";

process.env.XP_CORS_ALLOW = process.env.XP_CORS_ALLOW || "https://arcade.test";

const {
  createAdminPokerMaintenanceHandler,
  parseBody,
} = await import("../netlify/functions/admin-poker-maintenance.mjs");

function event(method, body = null) {
  return {
    httpMethod: method,
    headers: { origin: "https://arcade.test" },
    body,
  };
}

function previewIdentity() {
  return {
    environmentContext: "deploy-preview",
    databaseTarget: "stage",
    stageProjectRefMatches: true,
    databaseMatchesSupabaseProjectRef: true,
    serviceRoleStageProjectRefMatches: true,
  };
}

function productionIdentity() {
  return {
    environmentContext: "production",
    databaseTarget: "production",
    expectedProductionProjectRef: "production-project-ref",
    supabaseUrlProductionProjectRefMatches: true,
    databaseProductionProjectRefMatches: true,
    serviceRoleProductionProjectRefMatches: true,
    databaseMatchesSupabaseProjectRef: true,
  };
}

test("maintenance parser keeps operations bounded and rejects browser actor fields", () => {
  assert.deepEqual(parseBody(JSON.stringify({
    operation: "set_desired_state",
    enabled: false,
    desiredTableCount: 2,
  })), {
    operation: "set_desired_state",
    enabled: false,
    desiredTableCount: 2,
  });
  assert.deepEqual(parseBody(JSON.stringify({ operation: "request_rotation", tableId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })), {
    operation: "request_rotation",
    tableId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assert.throws(() => parseBody(JSON.stringify({ operation: "set_desired_state", enabled: true, desiredTableCount: 2, actorUserId: "spoofed" })), { code: "invalid_request" });
  assert.throws(() => parseBody(JSON.stringify({ operation: "set_desired_state", enabled: true, desiredTableCount: 3 })), { code: "invalid_desired_table_count" });
});

test("maintenance proxy selects verified Preview/Production target and signs actor context internally", async () => {
  const seen = [];
  const baseDeps = {
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          operation: "set_desired_state",
          environment: url.includes("ws-preview") ? "preview" : "production"
        })
      };
    },
  };
  const preview = createAdminPokerMaintenanceHandler({
    ...baseDeps,
    env: { CHIPS_ENABLED: "1", POKER_WS_INTERNAL_BASE_URL: "https://ws-preview.kcswh.pl", POKER_WS_INTERNAL_TOKEN: "preview-token" },
    buildStageIdentity: previewIdentity,
  });
  const previewResponse = await preview(event("POST", JSON.stringify({ operation: "set_desired_state", enabled: false, desiredTableCount: 2 })));
  assert.equal(previewResponse.statusCode, 200);
  assert.equal(seen[0].url, "https://ws-preview.kcswh.pl/internal/admin/poker-maintenance");
  const forwarded = JSON.parse(seen[0].options.body);
  assert.equal(forwarded.actorUserId, "00000000-0000-4000-8000-000000000010");
  assert.equal(typeof forwarded.requestId, "string");

  const production = createAdminPokerMaintenanceHandler({
    ...baseDeps,
    env: { CHIPS_ENABLED: "1", POKER_WS_INTERNAL_BASE_URL: "https://ws.kcswh.pl", POKER_WS_INTERNAL_TOKEN: "production-token" },
    buildStageIdentity: productionIdentity,
  });
  const productionResponse = await production(event("GET"));
  assert.equal(productionResponse.statusCode, 200);
  assert.equal(JSON.parse(productionResponse.body).environment, "production");
  assert.equal(seen[1].url, "https://ws.kcswh.pl/internal/admin/poker-maintenance");
});

test("maintenance proxy rejects an upstream environment mismatch", async () => {
  const handler = createAdminPokerMaintenanceHandler({
    env: {
      CHIPS_ENABLED: "1",
      POKER_WS_INTERNAL_BASE_URL: "https://ws-preview.kcswh.pl",
      POKER_WS_INTERNAL_TOKEN: "preview-token"
    },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    buildStageIdentity: previewIdentity,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, environment: "production" }) })
  });

  const response = await handler(event("GET"));
  assert.equal(response.statusCode, 502);
  assert.deepEqual(JSON.parse(response.body), { error: "ws_maintenance_environment_mismatch" });
});

test("maintenance proxy does not contact WS for non-admin or unverified environment", async () => {
  let calls = 0;
  const deps = {
    env: { CHIPS_ENABLED: "1", POKER_WS_INTERNAL_BASE_URL: "https://ws.kcswh.pl", POKER_WS_INTERNAL_TOKEN: "token" },
    fetchImpl: async () => { calls += 1; throw new Error("unexpected_fetch"); },
  };
  const nonAdmin = createAdminPokerMaintenanceHandler({
    ...deps,
    requireAdminUser: async () => { throw Object.assign(new Error("admin_required"), { status: 403, code: "admin_required" }); },
    buildStageIdentity: productionIdentity,
  });
  assert.equal((await nonAdmin(event("GET"))).statusCode, 403);

  const invalidEnvironment = createAdminPokerMaintenanceHandler({
    ...deps,
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    buildStageIdentity: () => ({ ...productionIdentity(), databaseMatchesSupabaseProjectRef: false }),
  });
  const response = await invalidEnvironment(event("GET"));
  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: "environment_not_allowed" });
  assert.equal(calls, 0);
});
