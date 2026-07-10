import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("public profile route, editor, and legal release gate are present", async () => {
  const [account, page, config, privacyEn, privacyPl, termsEn, termsPl] = await Promise.all([
    read("account.html"), read("profile.html"), read("netlify.toml"), read("legal/privacy.en.html"), read("legal/privacy.pl.html"), read("legal/terms.en.html"), read("legal/terms.pl.html")
  ]);
  assert.match(account, /id="publicProfileEditor"/);
  assert.match(account, /id="publicProfileForm"/);
  assert.match(page, /id="publicProfileCard"/);
  assert.match(page, /src="\/js\/public-profile-page\.js"/);
  assert.match(config, /from = "\/u\/:handle"\s+to = "\/profile\.html"/);
  assert.match(config, /\[context\.deploy-preview\.environment\][\s\S]*?PUBLIC_PROFILES_ENABLED = "1"/);
  assert.match(config, /\[context\.production\.environment\][\s\S]*?PUBLIC_PROFILES_ENABLED = "0"/);
  for (const document of [privacyEn, privacyPl, termsEn, termsPl]) assert.match(document, /profil|profile/i);
});

test("every backend avatar variant has frontend styles", async () => {
  const [backend, portalCss, profileCss] = await Promise.all([
    read("netlify/functions/_shared/user-profile.mjs"), read("css/portal.css"), read("css/public-profile.css")
  ]);
  const variants = Array.from(backend.match(/AVATAR_VARIANTS = Object\.freeze\(\[([^\]]+)\]\)/)[1].matchAll(/"([^"]+)"/g), (match) => match[1]);
  assert.deepEqual(variants, ["comet-blue", "falcon-orange", "fox-blue", "nova-purple", "orbit-green", "panda-pink"]);
  for (const variant of variants){
    assert.match(portalCss, new RegExp(`data-avatar-variant="${variant}"`));
    assert.match(profileCss, new RegExp(`data-avatar-variant="${variant}"`));
  }
});

async function loadProfileClient(fetchImpl, getUserId){
  const source = await read("js/profile-client.js");
  const window = {
    SupabaseAuth: { getCurrentUser: async () => getUserId() ? { id: getUserId() } : null },
    SupabaseAuthBridge: { getAccessToken: async () => getUserId() ? `token-${getUserId()}` : null }
  };
  vm.runInNewContext(source, { window, fetch: fetchImpl, console, setTimeout, clearTimeout });
  return window.ProfileClient;
}

test("profile cache is user-scoped and stale responses are discarded", async () => {
  let userId = "user-a";
  const requests = [];
  const client = await loadProfileClient(async (_url, options) => {
    const token = options.headers.Authorization;
    requests.push(token);
    return { ok: true, status: 200, json: async () => ({ handle: token, displayName: token, bio: "", avatar: { type: "default", variant: "fox-blue" } }) };
  }, () => userId);
  const profileA = await client.getMe();
  userId = "user-b";
  const profileB = await client.getMe();
  assert.equal(profileA.handle, "Bearer token-user-a");
  assert.equal(profileB.handle, "Bearer token-user-b");
  assert.deepEqual(requests, ["Bearer token-user-a", "Bearer token-user-b"]);

  let resolveResponse;
  userId = "user-a";
  const staleClient = await loadProfileClient(() => new Promise((resolve) => { resolveResponse = resolve; }), () => userId);
  const stale = staleClient.getMe();
  await new Promise((resolve) => setTimeout(resolve, 0));
  userId = "user-b";
  resolveResponse({ ok: true, status: 200, json: async () => ({ handle: "old", displayName: "Old", bio: "", avatar: { type: "default", variant: "fox-blue" } }) });
  await assert.rejects(stale, { code: "stale_identity" });
});

test("topbar derives its visible signed-in identity from the public profile", async () => {
  const [source, accountSource] = await Promise.all([read("js/auth/supabaseClient.js"), read("js/account-page.js")]);
  assert.match(source, /name = profile && profile\.displayName \? profile\.displayName : t\('player'/);
  assert.match(source, /email = t\('profileAccountSynced'/);
  assert.match(source, /refreshProfile\(user\)/);
  assert.match(accountSource, /publicProfileGeneration \+= 1/);
  assert.match(accountSource, /requestedUserKey !== getUserKey\(currentUser\)/);
});
