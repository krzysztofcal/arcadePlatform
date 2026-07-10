import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.equal((config.match(/PUBLIC_PROFILES_ENABLED = "1"/g) || []).length, 2);
  for (const document of [privacyEn, privacyPl, termsEn, termsPl]) assert.match(document, /profil|profile/i);
});

test("topbar derives its visible signed-in identity from the public profile", async () => {
  const source = await read("js/auth/supabaseClient.js");
  assert.match(source, /name = profile && profile\.displayName \? profile\.displayName : t\('player'/);
  assert.match(source, /email = t\('profileAccountSynced'/);
  assert.match(source, /refreshProfile\(user\)/);
});
