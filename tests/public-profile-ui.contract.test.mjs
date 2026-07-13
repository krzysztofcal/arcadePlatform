import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const { DEFAULT_BASE_XP, DEFAULT_MULTIPLIER } = await import("../netlify/functions/_shared/xp-level.mjs");

async function listHtmlFiles(directory = new URL("../", import.meta.url), prefix = ""){
  const ignored = new Set([".git", ".copilot-worktrees", "node_modules"]);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries){
    if (entry.isDirectory()){
      if (ignored.has(entry.name)) continue;
      files.push(...await listHtmlFiles(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`));
    } else if (entry.isFile() && entry.name.endsWith(".html")){
      files.push(`${prefix}${entry.name}`);
    }
  }
  return files;
}

test("public profile route, editor, and legal release gate are present", async () => {
  const [account, page, config, privacyEn, privacyPl, termsEn, termsPl, portalCss, accountJs, profileClient] = await Promise.all([
    read("account.html"), read("profile.html"), read("netlify.toml"), read("legal/privacy.en.html"), read("legal/privacy.pl.html"), read("legal/terms.en.html"), read("legal/terms.pl.html"), read("css/portal.css"), read("js/account-page.js"), read("js/profile-client.js")
  ]);
  assert.match(account, /id="publicProfileEditor"/);
  assert.match(account, /id="publicProfileForm"/);
  assert.match(account, /id="publicProfileSave"[^>]*data-state="idle"/);
  assert.match(account, /id="publicAvatarInput"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(account, /id="publicAvatarChoose"/);
  assert.match(account, /id="publicAvatarRemove"/);
  assert.match(account, /public-profile-save__spinner/);
  assert.match(accountJs, /setPublicProfileSaveState\('saving'/);
  assert.match(accountJs, /setPublicProfileSaveState\('saved'/);
  assert.match(accountJs, /ProfileClient\.uploadAvatar/);
  assert.match(accountJs, /publicAvatarValidating/);
  assert.match(accountJs, /publicAvatarProcessing/);
  assert.match(accountJs, /confirm\(t\('publicAvatarRemoveConfirm'/);
  assert.match(account, /data-upload-state="idle"/);
  assert.match(account, /@keyframes public-avatar-spin/);
  assert.match(accountJs, /readAsDataURL\(file\)/);
  assert.match(profileClient, /readAsDataURL\(file\)/);
  assert.doesNotMatch(accountJs + profileClient, /createObjectURL\(file\)/, "avatar validation and preview must not depend on CSP-blocked blob URLs");
  assert.match(accountJs, /ProfileClient\.removeAvatar/);
  assert.match(portalCss, /\.avatar-menu__user\{[^}]*background:transparent/);
  assert.match(page, /id="publicProfileCard"/);
  assert.match(page, /id="sbToggle"/);
  assert.match(page, /id="sidebar"/);
  assert.match(page, /src="\/js\/core\/sidebar-model\.js"/);
  assert.match(page, /src="\/js\/sidebar\.js"/);
  assert.match(page, /id="publicProfileXp"/);
  assert.match(page, /id="publicProfileLevel"/);
  assert.doesNotMatch(page, /id="publicProfileXp">0</);
  assert.doesNotMatch(page, /id="publicProfileLevel">1</);
  assert.match(page, /public-profile__stat-loading/);
  assert.match(page, /src="\/js\/public-profile-page\.js"/);
  assert.match(page, /src="\/js\/chips\/client\.js"/);
  assert.match(page, /src="\/js\/core\/number-format\.js"/);
  assert.ok(page.indexOf('/js/chips/client.js') < page.indexOf('/js/topbar.js'), 'chips client must load before topbar');
  assert.equal((page.match(/(?:href|src)="(?:css|js)\//g) || []).length, 0, "profile page assets must be root-absolute under /u/:handle");
  assert.match(config, /from = "\/u\/:handle"\s+to = "\/profile\.html"/);
  assert.match(config, /\[context\.deploy-preview\.environment\][\s\S]*?PUBLIC_PROFILES_ENABLED = "1"/);
  assert.match(config, /\[context\.production\.environment\][\s\S]*?PUBLIC_PROFILES_ENABLED = "0"/);
  assert.match(config, /img-src[^;]*https:\/\/\*\.supabase\.co/, "public avatar Storage URLs must be allowed by CSP");
  for (const document of [privacyEn, privacyPl, termsEn, termsPl]) assert.match(document, /profil|profile/i);
});

test("public profile page renders the server-provided XP and level", async () => {
  const source = await read("js/public-profile-page.js");
  assert.match(source, /profile\.xp/);
  assert.match(source, /profile\.level/);
  assert.match(source, /publicProfileXp/);
  assert.match(source, /publicProfileLevel/);
});

test("public XP level contract is fixed consistently across server and client", async () => {
  const core = await read("js/xp/core.js");
  assert.ok(core.includes(`const LEVEL_BASE_XP = ${DEFAULT_BASE_XP};`));
  assert.ok(core.includes(`const LEVEL_MULTIPLIER = ${DEFAULT_MULTIPLIER};`));
  assert.equal(core.includes("window.XP_LEVEL_BASE_XP"), false);
  assert.equal(core.includes("window.XP_LEVEL_MULTIPLIER"), false);
});

test("every backend avatar variant has frontend styles", async () => {
  const [migration, portalCss, profileCss] = await Promise.all([
    read("supabase/migrations/20260713090000_user_profile_provisioning_visibility.sql"), read("css/portal.css"), read("css/public-profile.css")
  ]);
  const variants = Array.from(migration.match(/avatar_variants constant text\[\] := array\[([^\]]+)\]/i)[1].matchAll(/'([^']+)'/g), (match) => match[1]);
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
  assert.match(source, /refreshProfile\(user, hydrated\.generation/);
  assert.match(source, /avatar\.type === 'uploaded'/);
  assert.match(source, /classList\.toggle\('profile-avatar--uploaded', !!uploaded\)/);
  assert.match(source, /style\.backgroundImage = uploaded/);
  assert.match(accountSource, /publicProfileGeneration \+= 1/);
  assert.match(accountSource, /requestedUserKey !== getUserKey\(currentUser\)/);
});

test("every HTML page with a topbar loads the shared auth avatar bridge first", async () => {
  const htmlFiles = await listHtmlFiles();
  const sources = await Promise.all(htmlFiles.map(async (file) => ({ file, source: await read(file) })));
  const files = sources.filter(({ source }) => /(?:\/|\b)js\/topbar\.js/.test(source));
  assert.ok(files.length > 30, "expected the full topbar page inventory");
  for (const { file, source } of files){
    const authIndex = source.indexOf("/js/auth/supabaseClient.js");
    const userUiIndex = source.indexOf("/js/user-ui-state.js");
    const chipsIndex = Math.max(source.indexOf("/js/chips/client.js"), source.indexOf('src="js/chips/client.js"'));
    const topbarIndex = Math.max(source.indexOf("/js/topbar.js"), source.indexOf('src="js/topbar.js"'));
    assert.match(source, /(?:\/|\b)css\/portal\.css/, `${file} must load uploaded-avatar styles`);
    assert.match(source, /class="topbar"[^>]*data-user-ui-state="pending"/, `${file} must start pending before first paint`);
    assert.match(source, /class="topbar"[^>]*data-user-ui-profile-state="pending"[^>]*data-user-ui-xp-state="pending"[^>]*data-user-ui-chips-state="pending"/, `${file} must start every user UI slice pending`);
    assert.ok(userUiIndex >= 0, `${file} must load user UI state`);
    assert.ok(authIndex > userUiIndex, `${file} must load user UI state before auth`);
    assert.ok(chipsIndex > authIndex, `${file} must load the chips client after auth`);
    assert.ok(topbarIndex > chipsIndex, `${file} must load the chips client before topbar`);
  }
});
