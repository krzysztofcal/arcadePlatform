import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createSupabaseJwt, withEnv } from "./helpers/xp-test-helpers.mjs";

const secret = "test_supabase_jwt_secret_12345678901234567890";
const moduleUrl = pathToFileURL(path.resolve("netlify/functions/_shared/supabase-admin.mjs")).href;

const loadVerify = async () => {
  const mod = await import(`${moduleUrl}?cache=${Date.now()}`);
  return mod.verifySupabaseJwt;
};

const run = async () => {
  await withEnv({ SUPABASE_JWT_SECRET: secret }, async () => {
    const verifySupabaseJwt = await loadVerify();
    const result = await verifySupabaseJwt("");
    assert.equal(result.provided, false);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "missing_token");
  });

  await withEnv({ SUPABASE_JWT_SECRET: secret }, async () => {
    const verifySupabaseJwt = await loadVerify();
    const result = await verifySupabaseJwt("abc");
    assert.equal(result.provided, true);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "malformed_token");
  });

  await withEnv({ SUPABASE_JWT_SECRET: secret }, async () => {
    const verifySupabaseJwt = await loadVerify();
    const token = createSupabaseJwt({ sub: "user-1", secret, alg: "none" });
    const result = await verifySupabaseJwt(token);
    assert.equal(result.provided, true);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "unsupported_alg");
  });

  await withEnv({ SUPABASE_JWT_SECRET: secret, SUPABASE_URL: "https://stageabc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" }, async () => {
    const previousFetch = globalThis.fetch;
    let receivedAuthorization = null;
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://stageabc.supabase.co/auth/v1/user");
      assert.equal(options.headers.apikey, "service-role");
      receivedAuthorization = options.headers.authorization;
      return { ok: true, json: async () => ({ id: "remote-user-1", email: "remote.test" }) };
    };
    try {
      const verifySupabaseJwt = await loadVerify();
      const token = createSupabaseJwt({ sub: "ignored-local-sub", secret, alg: "ES256" });
      const result = await verifySupabaseJwt(token);
      assert.equal(result.valid, true);
      assert.equal(result.userId, "remote-user-1");
      assert.equal(result.user?.email, "remote.test");
      assert.equal(receivedAuthorization, "Bearer " + token);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  await withEnv({ SUPABASE_JWT_SECRET: secret }, async () => {
    const verifySupabaseJwt = await loadVerify();
    const token = createSupabaseJwt({ sub: "user-abc", secret });
    const result = await verifySupabaseJwt(token);
    assert.equal(result.valid, true);
    assert.equal(result.userId, "user-abc");
    assert.equal(result.user?.id, "user-abc");
    assert.equal(result.user?.sub, "user-abc");
  });
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
