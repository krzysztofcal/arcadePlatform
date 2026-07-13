import assert from "node:assert/strict";
import test from "node:test";

const {
  ensureUserProfile,
  normalizeHandle,
  ownerProfile,
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
    leaderboardVisible: true,
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
    leaderboard_visible: value.leaderboardVisible,
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

test("profile handles reject reserved and invalid values", () => {
  assert.throws(() => normalizeHandle("admin"), { code: "reserved_handle" });
  assert.throws(() => normalizeHandle("not valid"), { code: "invalid_handle" });
});

test("profile helper delegates idempotent creation to the database function", async () => {
  let called = null;
  const result = await ensureUserProfile(USER_ID, {
    executeSql: async (query, params) => { called = { query, params }; return [dbProfile()]; },
  });
  assert.match(called.query, /from public\.ensure_user_profile\(\$1::uuid\)/);
  assert.deepEqual(called.params, [USER_ID]);
  assert.equal(result.leaderboardVisible, true);
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
  assert.equal("leaderboardVisible" in projected, false);
});

test("owner projection exposes leaderboard visibility without leaking it publicly", () => {
  const owner = ownerProfile(profile({ leaderboardVisible: false }));
  assert.equal(owner.leaderboardVisible, false);
  assert.equal("leaderboardVisible" in publicProfile(profile({ leaderboardVisible: false })), false);
});

test("uploaded avatar projection exposes only an opaque stable public URL", () => {
  const previous = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://stageabc.supabase.co";
  try {
    const key = "10000000-0000-4000-8000-000000000001.webp";
    const projected = publicProfile(profile({ avatarKey: key }));
    assert.deepEqual(projected.avatar, {
      type: "uploaded",
      url: `https://stageabc.supabase.co/storage/v1/object/public/profile-avatars/${key}`,
    });
    assert.equal("avatarKey" in projected, false);
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous;
  }
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

test("profile-me rejects non-boolean leaderboard visibility", async () => {
  const handler = createProfileMeHandler({
    verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
    updateUserProfile: async () => { const error = new Error("invalid_leaderboard_visibility"); error.code = "invalid_leaderboard_visibility"; error.status = 400; throw error; },
  });
  const response = await handler(event("PATCH", { leaderboardVisible: "false" }));
  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "invalid_leaderboard_visibility" });
});

test("profile helper rejects non-boolean leaderboard visibility before a database write", async () => {
  let writes = 0;
  await assert.rejects(
    () => updateUserProfile(USER_ID, { leaderboardVisible: "false" }, {
      executeSql: async () => [dbProfile()],
      beginSql: async () => { writes += 1; },
    }),
    { code: "invalid_leaderboard_visibility", status: 400 },
  );
  assert.equal(writes, 0);
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
      executeSql: async () => [dbProfile({ handleCustomizedAt: "2026-07-10T00:00:00.000Z" })],
    }),
    { code: "handle_locked" },
  );

  const conflict = new Error("duplicate_handle");
  conflict.code = "23505";
  conflict.constraint = "user_profiles_handle_lower_unique";
  await assert.rejects(
    () => updateUserProfile(USER_ID, { handle: "taken-handle" }, {
      beginSql: transactionForProfile(dbProfile(), conflict),
      executeSql: async () => [dbProfile()],
    }),
    { code: "handle_taken", status: 409 },
  );
});

test("leaderboard opt-out synchronizes Redis before the database write", async () => {
  const updatedRow = dbProfile({ leaderboardVisible: false });
  const effects = [];
  const result = await updateUserProfile(USER_ID, { leaderboardVisible: false }, {
    executeSql: async () => [dbProfile()],
    beginSql: async (callback) => { effects.push("db"); return transactionForProfile(updatedRow)(callback); },
    syncLeaderboardVisibility: async (userId, visible) => { effects.push("redis"); assert.deepEqual({ userId, visible }, { userId: USER_ID, visible: false }); },
  });
  assert.equal(result.leaderboardVisible, false);
  assert.deepEqual(effects, ["redis", "db"]);
});

test("leaderboard opt-out leaves the database visible when Redis synchronization fails", async () => {
  let databaseWrites = 0;
  await assert.rejects(
    () => updateUserProfile(USER_ID, { leaderboardVisible: false }, {
      executeSql: async () => [dbProfile()],
      beginSql: async () => { databaseWrites += 1; },
      syncLeaderboardVisibility: async () => { throw new Error("redis_unavailable"); },
    }),
    /redis_unavailable/,
  );
  assert.equal(databaseWrites, 0);
});

test("leaderboard opt-in commits the database before Redis and an identical retry repairs projections", async () => {
  const effects = [];
  const deps = {
    executeSql: async () => [dbProfile({ leaderboardVisible: true })],
    beginSql: async (callback) => { effects.push("db"); return transactionForProfile(dbProfile({ leaderboardVisible: true }))(callback); },
    syncLeaderboardVisibility: async () => { effects.push("redis"); throw new Error("redis_unavailable"); },
  };
  await assert.rejects(() => updateUserProfile(USER_ID, { leaderboardVisible: true }, deps), /redis_unavailable/);
  assert.deepEqual(effects, ["db", "redis"]);

  effects.length = 0;
  deps.syncLeaderboardVisibility = async (userId, visible) => { effects.push("redis"); assert.deepEqual({ userId, visible }, { userId: USER_ID, visible: true }); };
  const repaired = await updateUserProfile(USER_ID, { leaderboardVisible: true }, deps);
  assert.equal(repaired.leaderboardVisible, true);
  assert.deepEqual(effects, ["db", "redis"]);
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
    getUserXpTotal: async (userId) => {
      assert.equal(userId, USER_ID);
      return 235;
    },
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
    getUserXpTotal: async () => { throw new Error("upstash_unavailable"); },
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
