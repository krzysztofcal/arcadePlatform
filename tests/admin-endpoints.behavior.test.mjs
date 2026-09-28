import assert from "node:assert/strict";
import test from "node:test";

const { createAdminMeHandler } = await import("../netlify/functions/admin-me.mjs");
const { createAdminUserBalanceHandler } = await import("../netlify/functions/admin-user-balance.mjs");
const { createAdminUserLedgerHandler } = await import("../netlify/functions/admin-user-ledger.mjs");
const { createAdminWsPreviewBotReactionHandler, parseBody: parseBotReactionBody } = await import("../netlify/functions/admin-ws-preview-bot-reaction.mjs");
const { createAdminPokerLogControlHandler, parseBody: parsePokerLogControlBody } = await import("../netlify/functions/admin-poker-log-control.mjs");
const { createAdminUserPokerAccessHandler, updatePokerAccess } = await import("../netlify/functions/admin-user-poker-access.mjs");
const { notifyWsPokerAccessMutation } = await import("../netlify/functions/_shared/poker-ws-runtime-notify.mjs");
const { updatePokerPolicy } = await import("../netlify/functions/admin-poker-policy.mjs");

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
    serviceRoleStageProjectRefMatches: true,
  };
}

function productionStageIdentity() {
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

function pokerLogSnapshot() {
  return {
    defaultLevel: "INFO",
    serverNow: "2026-07-28T13:00:00.000Z",
    ttl: {
      minMs: 60000,
      defaultMs: 900000,
      maxMs: 3600000,
      presetsMs: [900000, 1800000, 3600000],
    },
    overrides: [],
  };
}

test("poker access admin rejects unauthorized override mutation before any write", async () => {
  let writes = 0;
  const handler = createAdminUserPokerAccessHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => {
      const error = new Error("admin_required");
      error.status = 403;
      error.code = "admin_required";
      throw error;
    },
    updatePokerAccess: async () => { writes += 1; return {}; }
  });
  const response = await handler(event("PATCH", {}, JSON.stringify({
    userId: "00000000-0000-4000-8000-000000000020",
    override: "FORCE_RESTRICTED",
    expectedRevision: 1
  })));
  assert.equal(response.statusCode, 403);
  assert.equal(writes, 0);
});

test("poker access admin requires an acknowledged WS cache refresh after commit", async () => {
  const notifications = [];
  const handler = createAdminUserPokerAccessHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    updatePokerAccess: async () => ({ access: { revision: 9, override: "FORCE_RESTRICTED" } }),
    notifyWsPokerAccessMutation: async (payload) => {
      notifications.push(payload);
      return payload.phase === "invalidate"
        ? { ok: true, invalidated: true, refreshed: false, failClosed: true, skipped: false }
        : { ok: true, invalidated: true, refreshed: true, failClosed: false, pending: false, revision: 9, override: "FORCE_RESTRICTED", skipped: false };
    }
  });
  const response = await handler({
    httpMethod: "PATCH",
    headers: {},
    body: JSON.stringify({ userId: "00000000-0000-4000-8000-000000000020", override: "FORCE_RESTRICTED", expectedRevision: 8 })
  });
  assert.equal(response.statusCode, 200);
  assert.equal(notifications[0].phase, "invalidate");
  assert.equal(notifications[0].override, "FORCE_RESTRICTED");
  assert.equal(notifications[0].expectedRevision, 8);
  assert.equal(notifications[1].phase, "refresh");
  assert.equal(notifications[1].override, "FORCE_RESTRICTED");
  assert.equal(notifications[1].revision, 9);
  assert.equal(JSON.parse(response.body).propagation.refreshed, true);

  const failedHandler = createAdminUserPokerAccessHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    updatePokerAccess: async () => ({ access: { revision: 10, override: "AUTO" } }),
    notifyWsPokerAccessMutation: async (payload) => payload.phase === "invalidate"
      ? { ok: true, invalidated: true, failClosed: true, skipped: false }
      : { ok: false, skipped: false, reason: "timeout" }
  });
  const failed = await failedHandler({
    httpMethod: "PATCH",
    headers: {},
    body: JSON.stringify({ userId: "00000000-0000-4000-8000-000000000020", override: "AUTO", expectedRevision: 9 })
  });
  assert.equal(failed.statusCode, 503);
  assert.equal(JSON.parse(failed.body).error, "poker_access_propagation_failed");
});

test("poker access admin refuses to commit when WS pre-invalidation is unavailable", async () => {
  let writes = 0;
  const handler = createAdminUserPokerAccessHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    updatePokerAccess: async () => { writes += 1; return { access: { revision: 11 } }; },
    notifyWsPokerAccessMutation: async () => ({ ok: false, skipped: false, reason: "timeout" })
  });
  const response = await handler({
    httpMethod: "PATCH",
    headers: {},
    body: JSON.stringify({ userId: "00000000-0000-4000-8000-000000000020", override: "FORCE_RESTRICTED", expectedRevision: 10 })
  });
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, "poker_access_pre_invalidation_failed");
  assert.equal(writes, 0);
});

test("poker access admin refreshes after a failed DB commit to release only an authoritative fail-closed barrier", async () => {
  const phases = [];
  const handler = createAdminUserPokerAccessHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    updatePokerAccess: async () => {
      const error = new Error("db_unavailable");
      error.status = 503;
      error.code = "db_unavailable";
      throw error;
    },
    notifyWsPokerAccessMutation: async (payload) => {
      phases.push(payload);
      return { ok: true, invalidated: true, failClosed: payload.phase === "invalidate", refreshed: payload.phase === "refresh", skipped: false };
    }
  });
  const response = await handler({
    httpMethod: "PATCH",
    headers: {},
    body: JSON.stringify({ userId: "00000000-0000-4000-8000-000000000020", override: "FORCE_SLOW", expectedRevision: 10 })
  });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(phases.map((payload) => payload.phase), ["invalidate", "refresh"]);
  assert.equal(phases[1].releasePending, true);
});

test("poker access admin rejects a second mutation while the first pending barrier owns the user", async () => {
  let pending = false;
  let writes = 0;
  let committed = null;
  let releaseFirstUpdate;
  const firstUpdate = new Promise((resolve) => { releaseFirstUpdate = resolve; });
  const handler = createAdminUserPokerAccessHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    updatePokerAccess: async ({ override }) => {
      writes += 1;
      if (writes === 1) await firstUpdate;
      committed = { revision: 8 + writes, override };
      return { access: committed };
    },
    notifyWsPokerAccessMutation: async ({ phase }) => {
      if (phase === "invalidate") {
        if (pending) return { ok: false, invalidated: false, failClosed: true, skipped: false, reason: "poker_access_mutation_pending" };
        pending = true;
        return { ok: true, invalidated: true, failClosed: true, skipped: false };
      }
      if (!committed) return { ok: true, refreshed: false, pending: true, failClosed: true };
      pending = false;
      return { ok: true, refreshed: true, failClosed: false, pending: false, ...committed };
    }
  });
  const event = {
    httpMethod: "PATCH",
    headers: {},
    body: JSON.stringify({ userId: "00000000-0000-4000-8000-000000000020", override: "FORCE_RESTRICTED", expectedRevision: 8 })
  };
  const first = handler(event);
  while (writes !== 1) await new Promise((resolve) => setImmediate(resolve));
  const second = await handler({ ...event, body: JSON.stringify({ ...JSON.parse(event.body), override: "FORCE_SLOW" }) });
  assert.equal(second.statusCode, 409);
  assert.equal(JSON.parse(second.body).error, "poker_access_mutation_pending");
  assert.equal(writes, 1, "the rejected mutation must not reach the DB write");
  releaseFirstUpdate();
  assert.equal((await first).statusCode, 200);

  const third = await handler({ ...event, body: JSON.stringify({ ...JSON.parse(event.body), override: "FORCE_SLOW" }) });
  assert.equal(third.statusCode, 200);
  assert.equal(writes, 2);
});

function accessPatch(override = "FORCE_RESTRICTED", expectedRevision = 8) {
  return { httpMethod: "PATCH", headers: {}, body: JSON.stringify({
    userId: "00000000-0000-4000-8000-000000000020", override, expectedRevision
  }) };
}

const exactAccessAck = { ok: true, refreshed: true, failClosed: false, pending: false,
  revision: 9, override: "FORCE_RESTRICTED", effectiveClass: "RESTRICTED" };

for (const firstFailure of ["timeout", "throw"]) {
  test(`Admin retries only WS confirmation after ${firstFailure}, with exactly one DB mutation`, async () => {
    let writes = 0;
    let confirmations = 0;
    const handler = createAdminUserPokerAccessHandler({
      env: { CHIPS_ENABLED: "1" }, requireAdminUser: async () => ({ userId: "admin" }),
      updatePokerAccess: async () => { writes += 1; return { access: { revision: 9, override: "FORCE_RESTRICTED" } }; },
      notifyWsPokerAccessMutation: async (payload) => {
        if (payload.phase === "invalidate") return { ok: true, invalidated: true, failClosed: true };
        assert.equal(payload.revision, 9);
        assert.equal(payload.override, "FORCE_RESTRICTED");
        confirmations += 1;
        if (confirmations === 1) {
          if (firstFailure === "throw") throw new Error("timeout");
          return { ok: false, reason: "timeout" };
        }
        return exactAccessAck;
      }
    });
    const response = await handler(accessPatch());
    assert.equal(response.statusCode, 200);
    assert.equal(writes, 1);
    assert.equal(confirmations, 2);
    assert.deepEqual(JSON.parse(response.body).propagation, exactAccessAck);
  });
}

for (const mismatch of [{ revision: 10 }, { override: "AUTO" }, { pending: true }, { failClosed: true },
  { pending: undefined }, { failClosed: undefined }, { ok: false, reason: "timeout" }]) {
  test(`Admin refuses inexact WS confirmation ${JSON.stringify(mismatch)}`, async () => {
    let writes = 0;
    let confirmations = 0;
    const handler = createAdminUserPokerAccessHandler({
      env: { CHIPS_ENABLED: "1" }, requireAdminUser: async () => ({ userId: "admin" }),
      updatePokerAccess: async () => { writes += 1; return { access: { revision: 9, override: "FORCE_RESTRICTED" } }; },
      notifyWsPokerAccessMutation: async ({ phase }) => {
        if (phase === "invalidate") return { ok: true, invalidated: true, failClosed: true };
        confirmations += 1;
        return notifyWsPokerAccessMutation({
          userId: "00000000-0000-4000-8000-000000000020",
          env: { POKER_WS_INTERNAL_BASE_URL: "https://ws.test", POKER_WS_INTERNAL_TOKEN: "test-token" },
          fetchImpl: async () => ({ ok: true, json: async () => ({ ...exactAccessAck, ...mismatch }) })
        });
      }
    });
    const response = await handler(accessPatch());
    assert.equal(response.statusCode, 503);
    assert.equal(JSON.parse(response.body).error, "poker_access_propagation_failed");
    assert.equal(writes, 1);
    assert.equal(confirmations, 3);
  });
}

test("Admin synchronously recovers committed pending and returns current access for a stale caller without writing", async () => {
  let writes = 0;
  const phases = [];
  const current = { revision: 9, override: "FORCE_RESTRICTED", effectiveClass: "RESTRICTED" };
  const handler = createAdminUserPokerAccessHandler({
    env: { CHIPS_ENABLED: "1" }, requireAdminUser: async () => ({ userId: "admin" }),
    loadPokerAccess: async () => current,
    updatePokerAccess: async () => { writes += 1; },
    notifyWsPokerAccessMutation: async (payload) => {
      phases.push(payload.phase);
      if (payload.phase === "invalidate") return { ok: false, reason: "poker_access_mutation_pending" };
      assert.notEqual(payload.releasePending, true, "recovery cannot release an uncommitted mutation");
      assert.equal(payload.override, undefined, "recovery uses the previous pending override, not the new AUTO request");
      return exactAccessAck;
    }
  });
  const response = await handler(accessPatch("AUTO", 8));
  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), { error: "stale_revision", access: current });
  assert.equal(writes, 0);
  assert.deepEqual(phases, ["invalidate", "refresh"]);
});

test("poker access admin preserves automatic SLOW while applying an optimistic override revision", async () => {
  const result = await updatePokerAccess({
    userId: "00000000-0000-4000-8000-000000000020",
    override: "FORCE_NORMAL",
    expectedRevision: 7,
    actorId: "00000000-0000-4000-8000-000000000010",
    runTransaction: async (fn) => fn({ unsafe: async (sql) => {
      if (String(sql).includes("to_regclass")) return [{ available: true }];
      if (String(sql).includes("select user_id")) return [{ user_id: "00000000-0000-4000-8000-000000000020", poker_auto_class: "SLOW", poker_access_override: "AUTO", poker_access_revision: 7 }];
      if (String(sql).includes("update public.chips_accounts")) return [{ user_id: "00000000-0000-4000-8000-000000000020", poker_auto_class: "SLOW", poker_access_override: "FORCE_NORMAL", poker_access_revision: 8 }];
      return [];
    } })
  });
  assert.equal(result.access.automaticClass, "SLOW");
  assert.equal(result.access.override, "FORCE_NORMAL");
  assert.equal(result.access.effectiveClass, "NORMAL");
  assert.equal(result.access.revision, 8);
});

test("poker access admin accepts FORCE_RESTRICTED without changing automatic class", async () => {
  const result = await updatePokerAccess({
    userId: "00000000-0000-4000-8000-000000000020",
    override: "FORCE_RESTRICTED",
    expectedRevision: 7,
    actorId: "00000000-0000-4000-8000-000000000010",
    runTransaction: async (fn) => fn({ unsafe: async (sql) => {
      if (String(sql).includes("to_regclass")) return [{ available: true }];
      if (String(sql).includes("select user_id")) return [{ user_id: "00000000-0000-4000-8000-000000000020", poker_auto_class: "SLOW", poker_access_override: "AUTO", poker_access_revision: 7 }];
      if (String(sql).includes("update public.chips_accounts")) return [{ user_id: "00000000-0000-4000-8000-000000000020", poker_auto_class: "SLOW", poker_access_override: "FORCE_RESTRICTED", poker_access_revision: 8 }];
      return [];
    } })
  });
  assert.equal(result.access.automaticClass, "SLOW");
  assert.equal(result.access.override, "FORCE_RESTRICTED");
  assert.equal(result.access.effectiveClass, "RESTRICTED");
});

test("pre-migration poker access mutation fails with a controlled capability error", async () => {
  await assert.rejects(
    () => updatePokerAccess({
      userId: "00000000-0000-4000-8000-000000000020",
      override: "FORCE_RESTRICTED",
      expectedRevision: 7,
      actorId: "00000000-0000-4000-8000-000000000010",
      runTransaction: async (fn) => fn({ unsafe: async (sql) => {
        if (String(sql).includes("to_regclass")) return [{ available: false }];
        return [];
      } })
    }),
    (error) => error?.code === "poker_access_schema_unavailable" && error?.status === 409
  );
});

test("poker tier policy cannot enable a tier without both exact NORMAL and SLOW pools", async () => {
  await assert.rejects(
    () => updatePokerPolicy({
      body: {
        kind: "tier",
        buyIn: 100,
        enabled: true,
        expectedRevision: 1,
        normal_refill_threshold_ch: 100,
        normal_refill_amount_ch: 50,
        slow_refill_threshold_ch: 100,
        slow_refill_amount_ch: 50
      },
      actorId: "00000000-0000-4000-8000-000000000010",
      runTransaction: async (fn) => fn({ unsafe: async (sql) => {
        if (String(sql).includes("select buy_in, revision")) return [{ buy_in: 100, revision: 1 }];
        if (String(sql).includes("select system_key")) return [{ system_key: "POKER_BOT_BANKROLL_100" }];
        return [];
      } })
    }),
    (error) => error?.code === "tier_pools_unprovisioned"
  );
});

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
    chipsEnabled: true,
    maintenance: false,
  });
});

test("admin-me preserves allowlisted admin bootstrap during CH maintenance", async () => {
  let authCalls = 0;
  const handler = createAdminMeHandler({
    env: { CHIPS_ENABLED: "0" },
    requireAdminUser: async () => {
      authCalls += 1;
      return { userId: "00000000-0000-4000-8000-000000000010" };
    },
  });
  const response = await handler(event("GET"));

  assert.equal(response.statusCode, 200);
  assert.equal(authCalls, 1);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    isAdmin: true,
    userId: "00000000-0000-4000-8000-000000000010",
    chipsEnabled: false,
    maintenance: true,
  });
});

test("admin-me fails closed for non-admin callers", async () => {
  const handler = createAdminMeHandler({
    env: { CHIPS_ENABLED: "0" },
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
      CHIPS_ENABLED: "1",
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
          reactionSettings: { enabled: true, frequencyPercent: 100 },
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
  const settingsResponse = await handler(event("POST", {}, JSON.stringify({
    mode: "reaction_settings", enabled: false, frequencyPercent: 25
  })));
  assert.equal(settingsResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(seen.options.body), {
    mode: "reaction_settings",
    enabled: false,
    frequencyPercent: 25,
    updatedBy: "00000000-0000-4000-8000-000000000010",
  });
});

test("admin WS Preview bot reaction proxy rejects non-admin and non-preview requests before contacting WS", async () => {
  let fetchCalls = 0;
  const deps = {
    env: {
      CHIPS_ENABLED: "1",
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
  assert.deepEqual(parseBotReactionBody(JSON.stringify({ mode: "reaction_settings", enabled: false, frequencyPercent: 25 })), {
    mode: "reaction_settings", enabled: false, frequencyPercent: 25
  });
  assert.throws(() => parseBotReactionBody(JSON.stringify({ mode: "default", minMs: 500 })), { code: "invalid_request" });
  assert.throws(() => parseBotReactionBody(JSON.stringify({ mode: "override", minMs: 500, maxMs: 500, updatedBy: "spoofed" })), { code: "invalid_request" });
});

test("admin WS Preview bot reaction endpoint stays unavailable during CH maintenance", async () => {
  let authCalls = 0;
  let fetchCalls = 0;
  const handler = createAdminWsPreviewBotReactionHandler({
    env: {
      CHIPS_ENABLED: "0",
      POKER_WS_INTERNAL_BASE_URL: "https://ws-preview.kcswh.pl",
      POKER_WS_INTERNAL_TOKEN: "preview-internal-token",
    },
    requireAdminUser: async () => {
      authCalls += 1;
      return { userId: "admin-1" };
    },
    buildStageIdentity: previewStageIdentity,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("unexpected_fetch");
    },
  });
  for (const method of ["GET", "POST"]) {
    const response = await handler(event(method, {}, method === "POST" ? JSON.stringify({ mode: "default" }) : undefined));
    assert.equal(response.statusCode, 404);
    assert.deepEqual(JSON.parse(response.body), { error: "not_found" });
  }
  assert.equal(authCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("admin poker log control binds Preview and Production contexts to exact WS origins", async () => {
  const seen = [];
  const baseDeps = {
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return { ok: true, status: 200, json: async () => pokerLogSnapshot() };
    },
  };
  const previewHandler = createAdminPokerLogControlHandler({
    ...baseDeps,
    env: {
      CHIPS_ENABLED: "1",
      POKER_WS_INTERNAL_BASE_URL: "https://ws-preview.kcswh.pl",
      POKER_WS_INTERNAL_TOKEN: "preview-token",
    },
    buildStageIdentity: previewStageIdentity,
  });
  const previewResponse = await previewHandler(event("GET"));
  assert.equal(previewResponse.statusCode, 200);
  assert.equal(JSON.parse(previewResponse.body).environment, "preview");
  assert.equal(seen[0].url, "https://ws-preview.kcswh.pl/internal/admin/poker-log-control");

  const productionHandler = createAdminPokerLogControlHandler({
    ...baseDeps,
    env: {
      CHIPS_ENABLED: "1",
      POKER_WS_INTERNAL_BASE_URL: "https://ws.kcswh.pl",
      POKER_WS_INTERNAL_TOKEN: "production-token",
    },
    buildStageIdentity: productionStageIdentity,
  });
  const productionResponse = await productionHandler(event("GET"));
  assert.equal(productionResponse.statusCode, 200);
  assert.equal(JSON.parse(productionResponse.body).environment, "production");
  assert.equal(seen[1].url, "https://ws.kcswh.pl/internal/admin/poker-log-control");
  assert.equal(productionResponse.headers["cache-control"], "no-store");
});

test("admin poker log control fails closed for unverified Production project identity", async () => {
  const invalidIdentities = [
    {
      ...productionStageIdentity(),
      expectedProductionProjectRef: null,
    },
    {
      ...productionStageIdentity(),
      supabaseUrlProductionProjectRefMatches: false,
      databaseProductionProjectRefMatches: false,
      serviceRoleProductionProjectRefMatches: false,
    },
    {
      ...productionStageIdentity(),
      databaseMatchesSupabaseProjectRef: false,
      databaseProductionProjectRefMatches: false,
    },
    {
      ...productionStageIdentity(),
      serviceRoleProductionProjectRefMatches: false,
    },
  ];
  let fetchCalls = 0;
  for (const identity of invalidIdentities) {
    const handler = createAdminPokerLogControlHandler({
      env: {
        CHIPS_ENABLED: "1",
        POKER_WS_INTERNAL_BASE_URL: "https://ws.kcswh.pl",
        POKER_WS_INTERNAL_TOKEN: "production-token",
      },
      requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
      buildStageIdentity: () => identity,
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("unexpected_fetch");
      },
    });
    const response = await handler(event("GET"));
    assert.equal(response.statusCode, 403);
    assert.deepEqual(JSON.parse(response.body), { error: "environment_not_allowed" });
  }
  assert.equal(fetchCalls, 0);
});

test("admin poker log control forwards exact allowlisted scope with trusted admin identity", async () => {
  let forwarded = null;
  const handler = createAdminPokerLogControlHandler({
    env: {
      CHIPS_ENABLED: "1",
      POKER_WS_INTERNAL_BASE_URL: "https://ws-preview.kcswh.pl",
      POKER_WS_INTERNAL_TOKEN: "preview-token",
    },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    buildStageIdentity: previewStageIdentity,
    fetchImpl: async (_url, options) => {
      forwarded = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ...pokerLogSnapshot(),
          overrides: [{
            scope: "table",
            tableId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            expiresAt: "2026-07-28T13:15:00.000Z",
          }],
        }),
      };
    },
  });
  const payload = {
    operation: "enable",
    scope: "table",
    category: null,
    tableId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ttlMs: 900000,
  };
  const response = await handler(event("POST", {}, JSON.stringify(payload)));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(forwarded, {
    ...payload,
    adminUserId: "00000000-0000-4000-8000-000000000010",
  });
});

test("admin poker log control rejects unknown fields, cross-environment origins, and invalid categories", async () => {
  assert.throws(
    () => parsePokerLogControlBody(JSON.stringify({
      operation: "enable", scope: "global", category: null, tableId: null, ttlMs: 900000, wildcard: "*",
    })),
    { code: "invalid_request" },
  );
  assert.throws(
    () => parsePokerLogControlBody(JSON.stringify({
      operation: "enable", scope: "category", category: "anything", tableId: null, ttlMs: 900000,
    })),
    { code: "invalid_request" },
  );
  let fetchCalls = 0;
  const handler = createAdminPokerLogControlHandler({
    env: {
      CHIPS_ENABLED: "1",
      POKER_WS_INTERNAL_BASE_URL: "https://ws.kcswh.pl",
      POKER_WS_INTERNAL_TOKEN: "wrong-context-token",
    },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    buildStageIdentity: previewStageIdentity,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("unexpected_fetch");
    },
  });
  const response = await handler(event("GET"));
  assert.equal(response.statusCode, 503);
  assert.equal(fetchCalls, 0);
});

test("admin WS Preview bot reaction proxy rejects a non-JSON Caddy fallback response", async () => {
  const handler = createAdminWsPreviewBotReactionHandler({
    env: {
      CHIPS_ENABLED: "1",
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

test("admin-user-ledger uses the same runtime ledger-version resolver contract", async () => {
  const versionFor = async (env) => {
    const handler = createAdminUserLedgerHandler({
      env: { CHIPS_ENABLED: "1", ...env },
      requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
      listUserLedger: async () => ({ items: [], nextCursor: null }),
    });
    const response = await handler(event("GET", {
      userId: "00000000-0000-4000-8000-000000000077",
    }));
    return response.headers["x-chips-ledger-version"];
  };

  assert.equal(
    await versionFor({ COMMIT_REF: "  admin-commit  ", DEPLOY_ID: "admin-deploy", BUILD_ID: "admin-build" }),
    "admin-commit",
  );
  assert.equal(
    await versionFor({ COMMIT_REF: " ", DEPLOY_ID: "  admin-deploy  ", BUILD_ID: "admin-build" }),
    "admin-deploy",
  );
  assert.equal(
    await versionFor({ COMMIT_REF: "", DEPLOY_ID: " ", BUILD_ID: "  " }),
    "unavailable",
  );
});

test("Admin can proceed after committed pending recovery when caller already has the current revision", async () => {
  let invalidations = 0;
  let writes = 0;
  let committed = false;
  const handler = createAdminUserPokerAccessHandler({
    env: { CHIPS_ENABLED: "1" }, requireAdminUser: async () => ({ userId: "admin" }),
    loadPokerAccess: async () => ({ revision: 9, override: "FORCE_RESTRICTED" }),
    updatePokerAccess: async ({ expectedRevision, override }) => {
      assert.equal(expectedRevision, 9);
      assert.equal(override, "AUTO");
      writes += 1;
      committed = true;
      return { access: { revision: 10, override: "AUTO" } };
    },
    notifyWsPokerAccessMutation: async ({ phase }) => {
      if (phase === "invalidate") {
        invalidations += 1;
        return invalidations === 1 ? { ok: false, reason: "poker_access_mutation_pending" }
          : { ok: true, invalidated: true, failClosed: true };
      }
      return committed ? { ...exactAccessAck, revision: 10, override: "AUTO", effectiveClass: "NORMAL" } : exactAccessAck;
    }
  });
  const response = await handler(accessPatch("AUTO", 9));
  assert.equal(response.statusCode, 200);
  assert.equal(writes, 1);
  assert.equal(invalidations, 2);
});
