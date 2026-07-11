import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("account auth UI supports validated signup and Supabase password recovery", async () => {
  const [html, page, auth] = await Promise.all([read("account.html"), read("js/account-page.js"), read("js/auth/supabaseClient.js")]);
  assert.match(html, /id="signupPassword"[^>]*minlength="8"/);
  assert.match(html, /id="signupPasswordConfirm"[^>]*minlength="8"/);
  assert.match(html, /id="forgotPasswordButton"/);
  assert.match(html, /id="passwordResetForm"[^>]*hidden/);
  assert.match(html, /id="passwordRecoveryForm"[^>]*hidden/);
  assert.match(page, /password !== passwordConfirm/);
  assert.match(page, /event === 'PASSWORD_RECOVERY'/);
  assert.match(page, /window\.location\.hash = 'accountPanel'/);
  assert.match(auth, /resetPasswordForEmail/);
  assert.match(auth, /updateUser\(\{ password: password \}\)/);
});

test("Supabase auth replays an early PASSWORD_RECOVERY event to a late page listener", async () => {
  const source = await read("js/auth/supabaseClient.js");
  const user = { id: "recovery-user", email: "recovery@example.com" };
  const session = { user, access_token: "token" };
  const document = { readyState: "complete", getElementById: () => null, querySelector: () => null, addEventListener() {}, documentElement: { dataset: {} } };
  const window = {
    document,
    location: { origin: "https://arcade.test", protocol: "https:", search: "", hash: "" },
    SUPABASE_CONFIG: { SUPABASE_URL: "https://stage.supabase.co", SUPABASE_ANON_KEY: "anon" },
    supabase: { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange(callback) { callback("PASSWORD_RECOVERY", session); return { data: { subscription: { unsubscribe() {} } } }; },
      updateUser: async () => ({ data: { user } }),
    } }) },
  };
  vm.runInNewContext(source, { window, document, Promise, console });
  let replay = null;
  window.SupabaseAuth.onAuthChange((event, replayUser) => { replay = { event, user: replayUser }; });
  await Promise.resolve();
  assert.equal(replay?.event, "PASSWORD_RECOVERY");
  assert.equal(replay?.user?.id, user.id);
  assert.equal(window.SupabaseAuth.isPasswordRecoveryPending(), true);
  await window.SupabaseAuth.updatePassword("new-password-123");
  assert.equal(window.SupabaseAuth.isPasswordRecoveryPending(), false);
});

test("type=recovery URL without a PASSWORD_RECOVERY event does not lock the account UI", async () => {
  const source = await read("js/auth/supabaseClient.js");
  const user = { id: "ordinary-user", email: "ordinary@example.com" };
  const session = { user, access_token: "token" };
  const document = { readyState: "complete", getElementById: () => null, querySelector: () => null, addEventListener() {}, documentElement: { dataset: {} } };
  const window = {
    document,
    location: { origin: "https://arcade.test", protocol: "https:", search: "?type=recovery", hash: "" },
    SUPABASE_CONFIG: { SUPABASE_URL: "https://stage.supabase.co", SUPABASE_ANON_KEY: "anon" },
    supabase: { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange(callback) { callback("INITIAL_SESSION", session); return { data: { subscription: { unsubscribe() {} } } }; },
    } }) },
  };
  vm.runInNewContext(source, { window, document, Promise, console });
  let replayedRecovery = false;
  window.SupabaseAuth.onAuthChange((event) => { if (event === "PASSWORD_RECOVERY") replayedRecovery = true; });
  await Promise.resolve();
  assert.equal(replayedRecovery, false);
  assert.equal(window.SupabaseAuth.isPasswordRecoveryPending(), false);
  assert.equal((await window.SupabaseAuth.getCurrentUser())?.id, user.id);
});
