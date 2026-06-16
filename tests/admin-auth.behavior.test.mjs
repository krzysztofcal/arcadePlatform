import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseJwt } from "./helpers/xp-test-helpers.mjs";

process.env.SUPABASE_JWT_SECRET = "admin_auth_test_secret_12345678901234567890";
process.env.ADMIN_USER_IDS = "00000000-0000-4000-8000-000000000001, 00000000-0000-4000-8000-000000000002";

const { isAdminUser, parseAdminUserIds, requireAdminUser } = await import("../netlify/functions/_shared/admin-auth.mjs");

test("parseAdminUserIds returns unique allowlisted IDs", () => {
  const ids = parseAdminUserIds({ ADMIN_USER_IDS: "a, b\na a,,b,c " });
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("isAdminUser accepts admins and rejects non-admins", () => {
  assert.equal(isAdminUser("00000000-0000-4000-8000-000000000001", process.env), true);
  assert.equal(isAdminUser("00000000-0000-4000-8000-000000000099", process.env), false);
});

test("requireAdminUser accepts allowlisted admin and rejects non-admin", async () => {
  const adminToken = createSupabaseJwt({
    sub: "00000000-0000-4000-8000-000000000001",
    secret: process.env.SUPABASE_JWT_SECRET,
  });
  const admin = await requireAdminUser({
    headers: { Authorization: `Bearer ${adminToken}` },
  }, process.env);
  assert.equal(admin.userId, "00000000-0000-4000-8000-000000000001");

  const userToken = createSupabaseJwt({
    sub: "00000000-0000-4000-8000-000000000099",
    secret: process.env.SUPABASE_JWT_SECRET,
  });
  await assert.rejects(
    () => requireAdminUser({ headers: { Authorization: `Bearer ${userToken}` } }, process.env),
    { status: 403, code: "admin_required" },
  );
});
