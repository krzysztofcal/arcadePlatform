import assert from "node:assert/strict";
import test from "node:test";

const {
  createGeneratedIdentity,
  normalizeHandle,
  publicProfile,
  updateUserProfile,
} = await import("../netlify/functions/_shared/user-profile.mjs");
const { computeXpLevel } = await import("../netlify/functions/_shared/xp-level.mjs");
const { createProfileMeHandler } = await import("../netlify/functions/profile-me.mjs");
const { createProfilePublicHandler, publicProfilesEnabled } = await import("../netlify/functions/profile-public.mjs");

const USER_ID = "00000000-0000-4000-8000-000000000003";

function event(method, body = null, query = {}) {
  return {
    httpMethod: method,
    headers: { origin: "https://arcade.test", authorization: "Bearer token" },
    body: body == null ? null : JSON.stringify(body),
    queryStringParameters: query,
  };
}

function profile(overrides = {}) {
  return {
    userId: USER_ID,
    handle: "blue-fox-482731",
    displayName: "Blue Fox 482731",
    bio: "",
    avatarKey: "internal/private-key.webp",
    avatarVariant: "fox-blue",
    handleCustomizedAt: null,
    ...overrides,
  };
}

function dbProfile(overrides = {}) {
  const value = profile(overrides);
  return {
    user_id: value.userId,
    handle: value.handle,
    display_name: value.displayName,
    bio: value.bio,
    avatar_key: value.avatarKey,
    avatar_variant: value.avatarVariant,
    handle_customized_at: value.handleCustomizedAt,
  };
}

function transactionForProfile(row, updateError = null) {
  return async (callback) => callback({
    unsafe: async (query) => {
      if (query.includes("insert into public.user_profiles")) return [row];
      if (query.includes("for update")) return [row];
      if (query.includes("update public.user_profiles")) {
        if (updateError) throw updateError;
        return [row];
      }
      throw new Error("unexpected_query");
    },
  });
}

test("generated identities are public-safe and handles reject reserved values", () => {
  const identity = createGeneratedIdentity();
  assert.match(identity.handle, /^[a-z0-9][a-z0-9_-]{2,23}$/);
  assert.equal(identity.displayName.includes(USER_ID), false);
  assert.equal(identity.displayName.includes("@"), false);
  assert.throws(() => normalizeHandle("admin"), { code: "reserved_handle" });
  assert.throws(() => normalizeHandle("not valid"), { code: "invalid_handle" });
});

test("public projection never returns internal identity or avatar storage key", () => {
  const projected = publicProfile(profile());
  assert.deepEqual(projected, {
    handle: "blue-fox-482731",
    displayName: "Blue Fox 482731",
    bio: "",
    avatar: { type: "default", variant: "fox-blue" },
  });
  assert.equal("userId" in projected, false);
  assert.equal(JSON.stringify(projected).includes("internal/private-key.webp"), false);
});

test("public projection exposes only current XP and computed level", () => {
  const projected = publicProfile(profile(), { xp: 235, level: computeXpLevel(235) });
  assert.equal(projected.xp, 235);
  assert.equal(projected.level, 3);
  assert.equal("userId" in projected, false);
  assert.equal("avatarKey" in projected, false);
});

test("server XP level boundaries match the client progression", () => {
  assert.equal(computeXpLevel(0), 1);
  assert.equal(computeXpLevel(99), 1);
  assert.equal(computeXpLevel(100), 2);
  assert.equal(computeXpLevel(234), 2);
  assert.equal(computeXpLevel(235), 3);
});

test("profile-me rejects empty and unknown PATCH fields", async () => {
  const handler = createProfileMeHandler({
    verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
    ensureUserProfile: async () => profile(),
  });
  for (const payload of [{}, { displayNmae: "Typo" }]) {
    const response = await handler(event("PATCH", payload));
    assert.equal(response.statusCode, 400);
    assert.deepEqual(JSON.parse(response.body), { error: "invalid_request" });
  }
});

test("profile-me maps locked and taken handle errors", async () => {
  for (const [code, status] of [["handle_locked", 400], ["handle_taken", 409]]) {
    const handler = createProfileMeHandler({
      verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
      updateUserProfile: async () => {
        const error = new Error(code);
        error.code = code;
        error.status = status;
        throw error;
      },
    });
    const response = await handler(event("PATCH", { handle: "custom-player" }));
    assert.equal(response.statusCode, status);
    assert.deepEqual(JSON.parse(response.body), { error: code });
  }
});

test("one-time handle lock and unique conflicts are enforced by profile updates", async () => {
  await assert.rejects(
    () => updateUserProfile(USER_ID, { handle: "second-handle" }, {
      beginSql: transactionForProfile(dbProfile({ handleCustomizedAt: "2026-07-10T00:00:00.000Z" })),
    }),
    { code: "handle_locked" },
  );

  const conflict = new Error("duplicate_handle");
  conflict.code = "23505";
  conflict.constraint = "user_profiles_handle_lower_unique";
  await assert.rejects(
    () => updateUserProfile(USER_ID, { handle: "taken-handle" }, {
      beginSql: transactionForProfile(dbProfile(), conflict),
    }),
    { code: "handle_taken", status: 409 },
  );
});

test("profile-public is disabled by default and uses generic not found responses", async () => {
  let reads = 0;
  const disabled = createProfilePublicHandler({
    env: { PUBLIC_PROFILES_ENABLED: "0" },
    findPublicProfile: async () => { reads += 1; return profile(); },
    allowPublicRead: async () => true,
  });
  const disabledResponse = await disabled(event("GET", null, { handle: "blue-fox-482731" }));
  assert.equal(disabledResponse.statusCode, 404);
  assert.deepEqual(JSON.parse(disabledResponse.body), { error: "not_found" });
  assert.equal(reads, 0);

  const enabled = createProfilePublicHandler({
    env: { PUBLIC_PROFILES_ENABLED: "1" },
    findPublicProfile: async () => null,
    allowPublicRead: async () => true,
  });
  const unknown = await enabled(event("GET", null, { handle: "unknown-player" }));
  const invalid = await enabled(event("GET", null, { handle: "not valid" }));
  assert.equal(unknown.statusCode, 404);
  assert.deepEqual(JSON.parse(unknown.body), JSON.parse(invalid.body));
});

test("profile-public returns current XP and level without internal fields", async () => {
  const handler = createProfilePublicHandler({
    env: { PUBLIC_PROFILES_ENABLED: "1" },
    findPublicProfile: async () => profile(),
    getUserProfile: async () => ({ userId: USER_ID, totalXp: 235, updatedAt: Date.now() }),
    allowPublicRead: async () => true,
  });
  const response = await handler(event("GET", null, { handle: "blue-fox-482731" }));
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(body, {
    handle: "blue-fox-482731",
    displayName: "Blue Fox 482731",
    bio: "",
    avatar: { type: "default", variant: "fox-blue" },
    xp: 235,
    level: 3,
  });
  assert.equal("userId" in body, false);
  assert.equal("email" in body, false);
  assert.equal("avatarKey" in body, false);
  assert.equal("totalXp" in body, false);
});

test("profile-public fails closed when the XP store read fails", async () => {
  const handler = createProfilePublicHandler({
    env: { PUBLIC_PROFILES_ENABLED: "1" },
    findPublicProfile: async () => profile(),
    getUserProfile: async () => { throw new Error("upstash_unavailable"); },
    allowPublicRead: async () => true,
  });
  const response = await handler(event("GET", null, { handle: "blue-fox-482731" }));
  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), { error: "server_error" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body.includes('"xp"'), false);
});

test("profile-public enables deploy previews when the function scope lacks the flag", () => {
  assert.equal(publicProfilesEnabled({ CONTEXT: "deploy-preview" }), true);
  assert.equal(publicProfilesEnabled({ CONTEXT: "deploy-preview", PUBLIC_PROFILES_ENABLED: "0" }), false);
  assert.equal(publicProfilesEnabled({ CONTEXT: "production" }), false);
  assert.equal(publicProfilesEnabled({}, { headers: { host: "deploy-preview-677--playkcswh.netlify.app" } }), true);
  assert.equal(publicProfilesEnabled({}, { headers: { host: "play.kcswh.pl" } }), false);
});
