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
