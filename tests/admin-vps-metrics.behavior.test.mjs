import assert from "node:assert/strict";
import test from "node:test";

const { createAdminVpsMetricsHandler } = await import("../netlify/functions/admin-vps-metrics.mjs");

const adminId = "00000000-0000-4000-8000-000000000010";
const previewIdentity = {
  environmentContext: "deploy-preview",
  databaseTarget: "stage",
  stageProjectRefMatches: true,
  databaseMatchesSupabaseProjectRef: true,
  serviceRoleStageProjectRefMatches: true,
};

function event(overrides = {}) {
  return {
    httpMethod: "GET",
    headers: {},
    ...overrides,
  };
}

function snapshot(environment = "preview") {
  return {
    environment,
    measuredAt: "2026-08-02T19:00:00.000Z",
    secretDiagnostic: "must-not-forward",
    rootFilesystem: null,
    logs: { varLogBytes: null, journaldBytes: null },
    runtime: { wsCpuPercent: null },
    continuousTables: null,
    cleanup: null,
  };
}

test("admin VPS metrics requires an admin and forwards the verified target", async () => {
  let capturedUrl = null;
  let capturedOptions = null;
  const handler = createAdminVpsMetricsHandler({
    env: {
      CHIPS_ENABLED: "0",
      POKER_WS_INTERNAL_BASE_URL: "https://ws-preview.kcswh.pl",
      POKER_WS_INTERNAL_TOKEN: "preview-token",
    },
    requireAdminUser: async () => ({ userId: adminId }),
    buildStageIdentity: () => previewIdentity,
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return { ok: true, status: 200, json: async () => snapshot() };
    },
  });

  const response = await handler(event());
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(capturedUrl, "https://ws-preview.kcswh.pl/internal/admin/vps-metrics");
  assert.equal(capturedOptions.method, "GET");
  assert.equal(capturedOptions.headers.authorization, "Bearer preview-token");
  const body = JSON.parse(response.body);
  assert.equal(body.environment, "preview");
  assert.equal(Object.prototype.hasOwnProperty.call(body, "secretDiagnostic"), false);

  const unauthorized = createAdminVpsMetricsHandler({
    env: { CHIPS_ENABLED: "0" },
    requireAdminUser: async () => {
      const error = new Error("admin_required");
      error.status = 403;
      error.code = "admin_required";
      throw error;
    },
  });
  const unauthorizedResponse = await unauthorized(event());
  assert.equal(unauthorizedResponse.statusCode, 403);
  assert.deepEqual(JSON.parse(unauthorizedResponse.body), { error: "admin_required" });
});

test("admin VPS metrics rejects an upstream environment mismatch", async () => {
  const handler = createAdminVpsMetricsHandler({
    env: {
      POKER_WS_INTERNAL_BASE_URL: "https://ws-preview.kcswh.pl",
      POKER_WS_INTERNAL_TOKEN: "preview-token",
    },
    requireAdminUser: async () => ({ userId: adminId }),
    buildStageIdentity: () => previewIdentity,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => snapshot("production") }),
  });
  const response = await handler(event());
  assert.equal(response.statusCode, 502);
  assert.deepEqual(JSON.parse(response.body), { error: "ws_vps_metrics_environment_mismatch" });
});
