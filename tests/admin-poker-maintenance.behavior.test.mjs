import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

process.env.XP_CORS_ALLOW = process.env.XP_CORS_ALLOW || "https://arcade.test";

const {
  createAdminPokerMaintenanceHandler,
  parseBody,
} = await import("../netlify/functions/admin-poker-maintenance.mjs");

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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

test("maintenance parser accepts the 100-table bound and rejects browser actor fields", () => {
  assert.deepEqual(parseBody(JSON.stringify({
    operation: "set_desired_state",
    enabled: false,
    desiredTableCount: 100,
  }), { maxDesiredTableCount: 100 }), {
    operation: "set_desired_state",
    enabled: false,
    desiredTableCount: 100,
  });
  assert.deepEqual(parseBody(JSON.stringify({ operation: "request_rotation", tableId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })), {
    operation: "request_rotation",
    tableId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assert.throws(() => parseBody(JSON.stringify({ operation: "set_desired_state", enabled: true, desiredTableCount: 2, actorUserId: "spoofed" })), { code: "invalid_request" });
  assert.throws(() => parseBody(JSON.stringify({ operation: "set_desired_state", enabled: true, desiredTableCount: 100 })), { code: "invalid_desired_table_count" });
  assert.throws(() => parseBody(JSON.stringify({ operation: "set_desired_state", enabled: true, desiredTableCount: 101 }), { maxDesiredTableCount: 100 }), { code: "invalid_desired_table_count" });
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
        json: async () => ({ ok: true, operation: "set_desired_state" })
      };
    },
  };
  const preview = createAdminPokerMaintenanceHandler({
    ...baseDeps,
    env: { CHIPS_ENABLED: "1", POKER_WS_INTERNAL_BASE_URL: "https://ws-preview.kcswh.pl", POKER_WS_INTERNAL_TOKEN: "preview-token" },
    buildStageIdentity: previewIdentity,
  });
  const previewResponse = await preview(event("POST", JSON.stringify({ operation: "set_desired_state", enabled: false, desiredTableCount: 2 })));
  assert.equal(previewResponse.statusCode, 502);
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
  assert.equal(productionResponse.statusCode, 502);
  assert.equal(seen[1].url, "https://ws.kcswh.pl/internal/admin/poker-maintenance");
});

test("maintenance proxy rejects a 100-table request for the verified Production target", async () => {
  let fetchCalls = 0;
  const handler = createAdminPokerMaintenanceHandler({
    env: {
      CHIPS_ENABLED: "1",
      POKER_WS_INTERNAL_BASE_URL: "https://ws.kcswh.pl",
      POKER_WS_INTERNAL_TOKEN: "production-token"
    },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    buildStageIdentity: productionIdentity,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("unexpected_fetch");
    }
  });

  const response = await handler(event("POST", JSON.stringify({
    operation: "set_desired_state",
    enabled: true,
    desiredTableCount: 100
  })));

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "invalid_desired_table_count" });
  assert.equal(fetchCalls, 0);
});

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
    server.on("error", reject);
  });
}

function waitForWsListening(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`WS did not start: ${output}`)), timeoutMs);
    const onData = (chunk) => {
      output += String(chunk);
      if (output.includes("ws_listening")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`WS exited before listening: ${code || signal || "unknown"}: ${output}`));
    });
  });
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

test("maintenance proxy accepts the environment from an actual WS POST response", async () => {
  const port = await getFreePort();
  const token = "actual-ws-maintenance-token";
  const child = spawn(process.execPath, ["ws-server/server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      POKER_WS_INTERNAL_TOKEN: token,
      WS_DEPLOY_ENVIRONMENT: "preview",
      SUPABASE_DB_URL: "postgres://example.invalid/db",
      WS_POKER_LOG_LEVEL: "INFO"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await waitForWsListening(child);
    const handler = createAdminPokerMaintenanceHandler({
      env: {
        CHIPS_ENABLED: "1",
        POKER_WS_INTERNAL_BASE_URL: "https://ws-preview.kcswh.pl",
        POKER_WS_INTERNAL_TOKEN: token
      },
      requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
      buildStageIdentity: previewIdentity,
      fetchImpl: (url, options) => fetch(`http://127.0.0.1:${port}/internal/admin/poker-maintenance`, options)
    });

    const response = await handler(event("POST", JSON.stringify({ operation: "cleanup" })));
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(JSON.parse(response.body), {
      ok: true,
      operation: "cleanup",
      orphanHoleCardsDeleted: 0,
      holeCardsDeleted: 0,
      phase1Deleted: 0,
      phase2Deleted: 0,
      failedPhases: [],
      skipped: true,
      reason: "cleanup_disabled",
      environment: "preview"
    });
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
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

test("maintenance proxy preserves cleanup failure counters and failed phases from HTTP 409", async () => {
  const handler = createAdminPokerMaintenanceHandler({
    env: {
      CHIPS_ENABLED: "1",
      POKER_WS_INTERNAL_BASE_URL: "https://ws-preview.kcswh.pl",
      POKER_WS_INTERNAL_TOKEN: "preview-token"
    },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    buildStageIdentity: previewIdentity,
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        operation: "cleanup",
        result: "failed",
        orphanHoleCardsDeleted: 3,
        holeCardsDeleted: 4,
        phase1Deleted: 9,
        phase2Deleted: 2,
        errorCode: "hole_cards_cleanup_failed",
        failedPhases: ["hole_cards"],
        environment: "preview"
      })
    })
  });

  const response = await handler(event("POST", JSON.stringify({ operation: "cleanup" })));
  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), {
    operation: "cleanup",
    result: "failed",
    orphanHoleCardsDeleted: 3,
    holeCardsDeleted: 4,
    phase1Deleted: 9,
    phase2Deleted: 2,
    errorCode: "hole_cards_cleanup_failed",
    failedPhases: ["hole_cards"],
    error: "cleanup_failed"
  });
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
