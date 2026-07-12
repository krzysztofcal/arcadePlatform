import assert from "node:assert/strict";
import vm from "node:vm";
import test from "node:test";

process.env.XP_TEST_MODE = "1";
process.env.XP_KEY_NS = "kcswh:xp:v2";

const { createProfilePublicHandler } = await import("../netlify/functions/profile-public.mjs");
const { computeXpLevel } = await import("../netlify/functions/_shared/xp-level.mjs");
const { store } = await import("../netlify/functions/_shared/store-upstash.mjs");

const USER_ID = "7339c05e-5068-4ad1-a449-5f7b3bb8f2e0";
const ANON_ID = "anon-public-profile-e2e";
const SNAPSHOT = { userId: USER_ID, totalXp: 300, createdAt: "2026-07-10T00:00:00.000Z", updatedAt: "2026-07-10T00:05:00.000Z" };

function profile() {
  return {
    userId: USER_ID,
    handle: "smoke-676-04933930",
    displayName: "Smoke Profile 676",
    bio: "",
    avatarKey: null,
    avatarVariant: "panda-pink",
    handleCustomizedAt: "2026-07-10T00:00:00.000Z",
  };
}

function response(body) {
  return {
    status: 200,
    ok: true,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

test("authenticated badge and public profile use the same canonical XP total", async () => {
  await store.set(`kcswh:xp:v2:total:${USER_ID}`, String(SNAPSHOT.totalXp));
  const publicHandler = createProfilePublicHandler({
    env: { PUBLIC_PROFILES_ENABLED: "1" },
    findPublicProfile: async () => profile(),
    allowPublicRead: async () => true,
  });
  const publicResponse = await publicHandler({
    httpMethod: "GET",
    headers: { origin: "https://arcade.test" },
    queryStringParameters: { handle: "smoke-676-04933930" },
  });
  const publicBody = JSON.parse(publicResponse.body);

  const badge = { textContent: "Lvl 3, 300 XP" };
  const storage = new Map([
    ["kcswh:userId", ANON_ID],
    ["kcswh:sessionId", "session-public-profile-e2e"],
    ["kcswh:xp:last", JSON.stringify({ totalLifetime: 999, serverTotalXp: 999, badgeShownXp: 999 })],
  ]);
  let statusRequest = null;
  const documentStub = { getElementById(id) { return id === "xpBadge" ? badge : null; } };
  const windowStub = {
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    setTimeout,
    clearTimeout,
    document: documentStub,
    SupabaseAuthBridge: { getAccessToken: async () => "authenticated-token" },
    XP: {
      refreshFromServerStatus(payload) {
        const total = Number(payload.totalLifetime) || 0;
        badge.textContent = `Lvl ${computeXpLevel(total)}, ${total.toLocaleString()} XP`;
      },
    },
  };
  const fetchStub = async (_url, options = {}) => {
    const body = JSON.parse(options.body || "{}");
    statusRequest = { body, hasAuthorization: !!options.headers?.Authorization };
    return response({ ok: true, status: "statusOnly", totalLifetime: SNAPSHOT.totalXp, totalToday: 0, cap: 3000 });
  };
  windowStub.fetch = fetchStub;
  vm.runInNewContext(
    await (await import("node:fs/promises")).readFile(new URL("../js/xpClient.js", import.meta.url), "utf8"),
    { window: windowStub, document: documentStub, fetch: fetchStub, setTimeout, clearTimeout, console },
    { filename: "xpClient.js" },
  );

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(publicResponse.statusCode, 200);
  assert.equal(publicBody.xp, SNAPSHOT.totalXp);
  assert.equal(publicBody.level, computeXpLevel(SNAPSHOT.totalXp));
  assert.equal(statusRequest.body.anonId, ANON_ID);
  assert.equal(Object.hasOwn(statusRequest.body, "gameId"), false);
  assert.equal(statusRequest.body.operation, "status");
  assert.equal(Object.hasOwn(statusRequest.body, "statusOnly"), false);
  assert.equal(typeof statusRequest.body.sessionId, "string");
  assert.ok(statusRequest.body.sessionId.length > 0);
  assert.notEqual(statusRequest.body.sessionId, "session-public-profile-e2e");
  assert.equal(statusRequest.hasAuthorization, true);
  assert.equal(badge.textContent, `Lvl ${publicBody.level}, ${publicBody.xp.toLocaleString()} XP`);
});
