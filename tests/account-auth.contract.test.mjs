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

async function googleHarness({ enabled = true, hash = '', providerEnabled = true, redirectUrl, protocol = 'https:', clientMode = 'ready', sessionPromise } = {}) {
  const source = await read('js/auth/supabaseClient.js');
  const calls = { oauth: [], navigation: [], history: [], logs: [] };
  const document = { readyState: 'loading', addEventListener() {} };
  const window = {
    location: { origin: 'https://arcade.test', protocol, pathname: '/account.html', search: '?next=https://evil.test', hash,
      assign(url) { calls.navigation.push(url); } },
    history: { replaceState(_state, _title, url) { calls.history.push(url); } },
    SUPABASE_CONFIG: { SUPABASE_URL: 'https://stage.supabase.co', SUPABASE_ANON_KEY: 'anon', AUTH_GOOGLE_ENABLED: enabled },
    KLog: { log(label, payload) { calls.logs.push({ label, payload }); } },
    supabase: { createClient: () => ({ auth: {
      getSession: () => sessionPromise || Promise.resolve({ data: { session: { user: { id: 'private-user', email: 'private@example.com' }, expires_at: 123 } } }),
      signInWithPassword: async () => ({ data: { session: { user: { id: 'password-user' } } }, error: null }),
      signOut: async () => ({ error: null }),
      signInWithOAuth: async (options) => { calls.oauth.push(options); return { data: { url: redirectUrl || 'https://stage.supabase.co/auth/v1/authorize?provider=google' } }; },
    } }) },
  };
  if (clientMode === 'missing') delete window.supabase;
  if (clientMode === 'throws') window.supabase.createClient = () => { throw new Error('SDK failed'); };
  if (clientMode === 'broken') window.supabase.createClient = () => ({ auth: {} });
  const fetch = async () => ({ ok: true, json: async () => ({ external: { google: providerEnabled } }) });
  vm.runInNewContext(source, { window, document, Promise, URL, URLSearchParams, fetch, console });
  document.readyState = 'complete';
  return { auth: window.SupabaseAuth, calls, window, document };
}

test('Google login is default-off and does not call SDK when disabled', async () => {
  const { auth, calls } = await googleHarness({ enabled: false });
  assert.equal(auth.isGoogleEnabled(), false);
  await assert.rejects(auth.signInWithGoogle(), /google_unavailable/);
  assert.equal(calls.oauth.length, 0);
});

test('Google redirects only to fixed same-origin account page with basic identity scopes', async () => {
  const { auth, calls } = await googleHarness();
  await auth.signInWithGoogle('https://evil.test/steal');
  assert.equal(calls.oauth[0].provider, 'google');
  assert.equal(calls.oauth[0].options.redirectTo, 'https://arcade.test/account.html');
  assert.equal(calls.oauth[0].options.scopes, 'openid email profile');
  assert.equal(calls.oauth[0].options.skipBrowserRedirect, true);
  assert.equal(calls.navigation.length, 1);
});

test('Unconfigured Google and unsafe authorize URL fail closed without navigation', async () => {
  for (const config of [{ providerEnabled: false }, { redirectUrl: 'https://evil.test/auth/v1/authorize' }, { protocol: 'file:' }]) {
    const { auth, calls } = await googleHarness(config);
    await assert.rejects(auth.signInWithGoogle());
    assert.equal(calls.navigation.length, 0);
  }
});

test('OAuth callback errors are controlled and scrubbed without logging provider text', async () => {
  const { auth, calls } = await googleHarness({ hash: '#error=access_denied&error_description=secret-provider-text' });
  assert.equal(auth.getAuthCallbackError(), 'auth_cancelled');
  await auth.getCurrentUser();
  assert.equal(calls.history.at(-1), '/account.html');
  assert.doesNotMatch(JSON.stringify(calls.logs), /private-user|example.com|expires_at|secret-provider-text/);
});

test('Token callback history is cleaned after SDK consumption; recovery remains SDK-owned', async () => {
  const { auth, calls } = await googleHarness({ hash: '#access_token=secret&refresh_token=secret&type=recovery' });
  assert.equal(calls.history.length, 0);
  await auth.getCurrentUser();
  assert.equal(calls.history.at(-1), '/account.html');
  assert.doesNotMatch(JSON.stringify(calls.logs), /secret|private-user|example.com/);
});


test('Password recovery callback errors stay generic even with Google disabled', async () => {
  const { auth, calls } = await googleHarness({ enabled: false, hash: '#error=access_denied&error_code=otp_expired&error_description=private-text' });
  assert.equal(auth.getAuthCallbackError(), 'auth_failed');
  await auth.getCurrentUser();
  assert.equal(calls.history.at(-1), '/account.html');
  assert.doesNotMatch(JSON.stringify(calls.logs), /private-text/);
});


test('Unavailable Supabase SDK cleans access/refresh callback without leaking tokens', async () => {
  for (const clientMode of ['missing', 'throws', 'broken']) {
    const { auth, calls } = await googleHarness({ clientMode, hash: '#access_token=secret&refresh_token=secret' });
    assert.equal(await auth.getCurrentUser(), null);
    assert.equal(calls.history.at(-1), '/account.html');
    assert.doesNotMatch(JSON.stringify(calls.logs), /secret/);
  }
});

test('Starting SDK consumes callback before history cleanup', async () => {
  let finish;
  const sessionPromise = new Promise(resolve => { finish = resolve; });
  const { auth, calls } = await googleHarness({ sessionPromise, hash: '#access_token=secret&refresh_token=secret' });
  const userPromise = auth.getCurrentUser();
  await Promise.resolve();
  assert.equal(calls.history.length, 0);
  finish({ data: { session: { user: { id: 'sdk-user' } } } });
  assert.equal((await userPromise).id, 'sdk-user');
  assert.equal(calls.history.at(-1), '/account.html');
});

test('Successful password login clears old callback failure before later sign-out', async () => {
  const { auth } = await googleHarness({ hash: '#error=server_error' });
  assert.equal(auth.getAuthCallbackError(), 'auth_failed');
  await auth.signIn('password@example.test', 'test-password');
  await auth.signOut();
  assert.equal(auth.getAuthCallbackError(), null);
});


test('Missing SDK during page loading waits for deferred SDK before cleaning callback', async () => {
  const { auth, calls, window, document } = await googleHarness({ clientMode: 'missing', hash: '#access_token=secret&refresh_token=secret' });
  document.readyState = 'loading';
  let onReady;
  document.addEventListener = (event, callback) => { if (event === 'DOMContentLoaded') onReady = callback; };
  const pending = auth.getCurrentUser();
  assert.equal(calls.history.length, 0);
  window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'late-sdk-user' } } } }) } }) };
  document.readyState = 'interactive';
  onReady();
  assert.equal((await pending).id, 'late-sdk-user');
  assert.equal(calls.history.at(-1), '/account.html');
});

test('Failed password login preserves callback failure until a successful retry', async () => {
  const { auth } = await googleHarness({ hash: '#error=server_error' });
  auth.getClient().auth.signInWithPassword = async () => ({ error: { message: 'invalid credentials' } });
  await auth.signIn('password@example.test', 'invalid-password');
  assert.equal(auth.getAuthCallbackError(), 'auth_failed');
});
