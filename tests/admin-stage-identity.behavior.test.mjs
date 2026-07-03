import assert from "node:assert/strict";
import test from "node:test";

const {
  buildStageIdentity,
  createAdminStageIdentityHandler,
  parseProjectRefFromDbUrl,
  parseProjectRefFromSupabaseUrl,
} = await import("../netlify/functions/admin-stage-identity.mjs");

function createEvent() {
  return {
    httpMethod: "GET",
    headers: { origin: "https://arcade.test" },
    queryStringParameters: {},
  };
}

test("admin-stage-identity derives stage target without exposing secrets", async () => {
  const env = {
    CONTEXT: "deploy-preview",
    CHIPS_ENABLED: "1",
    SUPABASE_URL: "https://stageabc.supabase.co",
    SUPABASE_DB_URL: "postgresql://postgres.stageabc:secret@aws-0-eu.pooler.supabase.com:6543/postgres?sslmode=require",
    SUPABASE_JWT_SECRET: "jwt-secret-value",
    SUPABASE_ANON_KEY: "anon-key-value",
    SUPABASE_STAGE_PROJECT_REF: "stageabc",
  };
  const identity = buildStageIdentity(env);

  assert.equal(identity.environmentContext, "deploy-preview");
  assert.equal(identity.supabaseProjectRef, "stageabc");
  assert.equal(identity.expectedStageProjectRef, "stageabc");
  assert.equal(identity.databaseTarget, "stage");
  assert.equal(identity.stageProjectRefMatches, true);
  assert.equal(identity.config.hasSupabaseDbUrl, true);
  assert.equal(JSON.stringify(identity).includes("secret"), false);
  assert.equal(JSON.stringify(identity).includes("anon-key-value"), false);
  assert.equal(JSON.stringify(identity).includes("pooler.supabase.com"), false);
});

test("admin-stage-identity marks production context as production when stage ref does not match", () => {
  const identity = buildStageIdentity({
    CONTEXT: "production",
    CHIPS_ENABLED: "1",
    SUPABASE_URL: "https://prodabc.supabase.co",
    SUPABASE_STAGE_PROJECT_REF: "stageabc",
  });

  assert.equal(identity.databaseTarget, "production");
  assert.equal(identity.stageProjectRefMatches, false);
});

test("admin-stage-identity parses project refs from supported Supabase URLs", () => {
  assert.equal(parseProjectRefFromSupabaseUrl("https://stageabc.supabase.co"), "stageabc");
  assert.equal(parseProjectRefFromDbUrl("postgresql://postgres.stageabc:pw@aws-0-us.pooler.supabase.com:6543/postgres"), "stageabc");
  assert.equal(parseProjectRefFromDbUrl("postgresql://postgres:pw@db.stageabc.supabase.co:5432/postgres"), "stageabc");
});

test("admin-stage-identity rejects postgres project-ref usernames on non-Supabase hosts", () => {
  assert.equal(parseProjectRefFromDbUrl("postgresql://postgres.stageabc:pw@evil.example.com:6543/postgres"), null);
  assert.equal(parseProjectRefFromDbUrl("postgresql://postgres.stageabc:pw@pooler.supabase.invalid:6543/postgres"), null);
});

test("admin-stage-identity endpoint requires admin and returns sanitized payload", async () => {
  const handler = createAdminStageIdentityHandler({
    env: {
      CONTEXT: "deploy-preview",
      CHIPS_ENABLED: "1",
      SUPABASE_URL: "https://stageabc.supabase.co",
      SUPABASE_STAGE_PROJECT_REF: "stageabc",
    },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
  });
  const response = await handler(createEvent());
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.databaseTarget, "stage");
  assert.equal(body.supabaseProjectRef, "stageabc");
});
