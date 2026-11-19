import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("account auth UI supports validated signup and Supabase password recovery", async () => {
  const [html, page, auth] = await Promise.all([read("account.html"), read("js/account-page.js"), read("js/auth/supabaseClient.js")]);
  const signup=html.slice(html.indexOf('id="signupForm"'),html.indexOf('</form>',html.indexOf('id="signupForm"')));
  assert.match(signup,/data-i18n="publicProfileSignupNotice"/);
  assert.ok(signup.indexOf('data-i18n="publicProfileSignupNotice"')<signup.indexOf('type="submit"'));
  assert.ok(html.indexOf('id="googleProfileNotice"')<html.indexOf('id="googleSignInButton"'));
  assert.match(page,/setBlockVisibility\(nodes.googleProfileNotice, googleEnabled\)/);
  assert.equal((html.match(/data-i18n="publicProfileSignupNotice"/g)||[]).length,2);
  assert.match(html,/Signed-in users can view your profile/);
  const translations=await read('js/i18n.js');
  assert.match(translations,/Zalogowani użytkownicy mogą zobaczyć Twój profil/);
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
  if (clientMode === 'session-throws') window.supabase.createClient = () => ({ auth: { getSession() { throw new Error('private SDK error'); } } });
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
  for (const hash of ['#access_token=secret&refresh_token=secret', '#refresh_token=secret']) {
   for (const clientMode of ['missing', 'throws', 'broken', 'session-throws']) {
    const { auth, calls } = await googleHarness({ clientMode, hash });
    assert.equal(await auth.getCurrentUser(), null);
    assert.equal(calls.history.at(-1), '/account.html');
    assert.doesNotMatch(JSON.stringify(calls.logs), /secret/);
   }
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

async function sessionRaceFixture(deferred = false) {
  let user = { id: 'user-a' }, callback, resolveInitial, reads = 0, clears = 0, profileReads = 0;
  const document = { readyState: 'complete', getElementById: () => null, querySelector: () => null, addEventListener() {}, documentElement: { dataset: {} } };
  const window = { document, location: { origin: 'https://arcade.test', protocol: 'https:', search: '', hash: '' },
    SUPABASE_CONFIG: { SUPABASE_URL: 'https://stage.supabase.co', SUPABASE_ANON_KEY: 'anon' },
    ProfileClient: { clear(){ clears++; }, getMe: async () => { profileReads++; return { displayName: 'Player', avatar: { variant: 'wizard-indigo' } }; } },
    supabase: { createClient: () => ({ auth: {
      getSession(){ if (deferred && reads++ === 0) return new Promise(resolve => { resolveInitial = resolve; }); return Promise.resolve({ data: { session: user ? { user } : null } }); },
      onAuthStateChange(fn){ callback = fn; return { data: { subscription: { unsubscribe(){} } } }; }
    } }) }
  };
  vm.runInNewContext(await read('js/auth/supabaseClient.js'), { window, document, Promise, console });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  return { flush, get clears(){ return clears; }, get profileReads(){ return profileReads; },
    emit(event, next = user){ user = next; callback(event, user ? { user } : null); },
    resolveInitial(){ resolveInitial({ data: { session: { user: { id: 'user-a' } } } }); }
  };
}

test('Auth session refreshes preserve same-user reads and invalidate identity changes', async () => {
  const f = await sessionRaceFixture();
  const baseline = f.clears;
  for (const event of ['INITIAL_SESSION', 'TOKEN_REFRESHED', 'SIGNED_IN']) { f.emit(event); await f.flush(); }
  assert.equal(f.clears, baseline);
  f.emit('SIGNED_IN', { id: 'user-b' }); await f.flush(); assert.equal(f.clears, baseline + 1);
  f.emit('SIGNED_OUT', null); await f.flush(); assert.equal(f.clears, baseline + 2);
});

test('An initial session read cannot overwrite a newer Auth event', async () => {
  const f = await sessionRaceFixture(true);
  f.emit('SIGNED_IN', { id: 'user-b' }); await f.flush(); const reads = f.profileReads;
  f.resolveInitial(); await f.flush(); assert.equal(f.profileReads, reads);
});

async function accountReadFixture(getMe) {
  const source = await read('js/account-page.js');
  // Exercise the actual private async coordinator without a DOM-rendering suite.
  const start = source.indexOf('  function loadPublicProfile(');
  const end = source.indexOf('\n  function handlePublicProfileSave', start);
  const events = { rendered: [], hidden: 0, errors: 0, logs: [] };
  const context = vm.createContext({ currentUser: { id: 'user-a' }, publicProfileGeneration: 1, publicProfileInFlight: null,
    window: { ProfileClient: { getMe } }, nodes: {}, getUserKey: user => user?.id,
    renderPublicProfile: profile => events.rendered.push(profile), renderPokerProjection(){}, clearPokerProjection(){},
    setBlockVisibility(){ events.hidden++; }, setStatus(){ events.errors++; },
    t: (_, fallback) => fallback, klog: (kind, data) => events.logs.push({ kind, data }), Promise
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, events, load: () => vm.runInContext('loadPublicProfile(true)', context) };
}
const cancelledRead = () => Object.assign(new Error('stale_identity'), { code: 'stale_identity' });

test('A cancelled profile read retries once and preserves the saved avatar', async () => {
  let calls = 0;
  const f = await accountReadFixture(async () => { if (++calls === 1) throw cancelledRead(); return { avatar: { type: 'default', variant: 'wizard-indigo' } }; });
  await f.load(); assert.equal(calls, 2); assert.equal(f.events.rendered[0].avatar.variant, 'wizard-indigo');
  assert.equal(f.events.hidden, 0); assert.equal(f.events.errors, 0); assert.equal(f.events.logs.length, 0);
});

test('The cancel retry is bounded and genuine profile failures are not retried', async () => {
  let calls = 0; const f = await accountReadFixture(async () => { calls++; throw cancelledRead(); });
  await f.load(); assert.equal(calls, 2); assert.equal(f.events.errors, 0); assert.equal(f.events.hidden, 0);
  let failures = 0; const g = await accountReadFixture(async () => { failures++; throw new Error('server_error'); });
  await g.load(); assert.equal(failures, 1); assert.equal(g.events.errors, 1); assert.equal(g.events.hidden, 1);
});

test('An identity-changed profile request cannot retry or repaint another account', async () => {
  let reject, calls = 0; const f = await accountReadFixture(() => { calls++; return new Promise((_, fail) => { reject = fail; }); });
  const pending = f.load(); f.context.currentUser = { id: 'user-b' }; f.context.publicProfileGeneration++;
  reject(cancelledRead()); await pending; assert.equal(calls, 1); assert.equal(f.events.rendered.length, 0); assert.equal(f.events.errors, 0);
});

test('Account summary starts with a neutral placeholder, never a bot or saved-user guess', async () => {
  const html = await read('account.html'); const avatar = html.match(/<div[^>]*id="accountSummaryAvatar"[^>]*>[\s\S]*?<\/div>/)[0];
  assert.doesNotMatch(avatar, /background-image|bot-female|wizard-indigo/); assert.match(avatar, />AH<\/div>/);
});

test('ProfileClient rejects old responses even after switching A to B and back to A', async () => {
  let userId = 'user-a', release, calls = 0;
  const window = { SupabaseAuth: { getCurrentUser: async () => ({ id: userId }) }, SupabaseAuthBridge: { getAccessToken: async () => 'token' } };
  const document = { dispatchEvent(){} };
  vm.runInNewContext(await read('js/profile-client.js'), { window, document, Promise, URL, Date, CustomEvent: class {},
    fetch: async () => { if (++calls === 1) await new Promise(resolve => { release = resolve; }); return { ok: true, json: async () => ({ displayName: calls === 1 ? 'Old A' : 'Fresh A' }) }; }
  });
  const pending = window.ProfileClient.getMe();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  userId = 'user-b'; window.ProfileClient.clear(); userId = 'user-a'; window.ProfileClient.clear(); release();
  await assert.rejects(pending, error => error.code === 'stale_identity');
  const profile = await window.ProfileClient.getMe(); assert.equal(profile.displayName, 'Fresh A'); assert.equal(calls, 2);
});
