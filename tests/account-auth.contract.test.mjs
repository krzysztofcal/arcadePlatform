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
  const start = source.indexOf('  async function recordProfileFailure(');
  const coordinatorStart = source.indexOf('  function loadPublicProfile(');
  const fixtureStart = start === -1 ? coordinatorStart : start;
  const end = source.indexOf('\n  function handlePublicProfileSave', start);
  const events = { rendered: [], hidden: 0, errors: 0, logs: [], states: [], access: [], flushes: [] };
  const statusNode = { dataset: { source: 'profile' } };
  const context = vm.createContext({ currentUser: { id: 'user-a' }, publicProfileGeneration: 1, publicProfileInFlight: null,
    window: { ProfileClient: { getMe }, SupabaseAuthBridge:{getAccessToken:async()=> 'private-token'}, KLog:{syncAdminAccess(active){events.access.push(active);},flush(force){events.flushes.push(force);}} }, auth:{getCurrentUser:async()=>context.currentUser}, fetch:async()=>({ok:true,json:async()=>({isAdmin:true,userId:context.currentUser.id})}), AbortController,setTimeout,clearTimeout, profileLoadState: 'idle', nodes: { status: statusNode }, getUserKey: user => user?.id,
    renderPublicProfile: profile => events.rendered.push(profile), renderPokerProjection(){}, clearPokerProjection(){},
    setBlockVisibility(){ events.hidden++; }, setStatus(message,tone,source){ if(tone==='error')events.errors++;events.states.push(context.profileLoadState);statusNode.dataset.source=source||'auth'; },
    t: (_, fallback) => fallback, klog: (kind, data) => events.logs.push({ kind, data }), Promise
  });
  vm.runInContext(source.slice(fixtureStart, end), context);
  return { context, events, load: async () => {const value=await vm.runInContext('loadPublicProfile(true)', context);await new Promise(resolve=>setImmediate(resolve));return value;} };
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


test('profile read states clear an old error after a new successful read', async () => {
  let fail = true; const f = await accountReadFixture(async()=>{if(fail)throw new Error('server_error');return {avatar:{variant:'wizard-indigo'}};});
  await f.load(); fail=false;await f.load();assert.deepEqual(f.events.states,['loading','error','loading','success']);
});

test('Auth success cannot overwrite a pending or failed profile status', async () => {
  const source=await read('js/account-page.js'),start=source.indexOf('  function setStatus('),end=source.indexOf('\n  function ',start+10);
  const status={textContent:'Profile failed',dataset:{source:'profile',tone:'error'},hidden:false};
  const c=vm.createContext({nodes:{status},currentUser:{id:'user-a'},profileLoadState:'error',deletionReceivedOwnerId:''});vm.runInContext(source.slice(start,end),c);
  vm.runInContext("setStatus('Signed in','success','auth')",c);assert.equal(status.textContent,'Profile failed');
  c.profileLoadState='success';vm.runInContext("setStatus('Signed in','success','profile')",c);assert.equal(status.textContent,'Signed in');
  c.profileLoadState='error';vm.runInContext("setStatus('Other action completed','success')",c);assert.equal(status.textContent,'Other action completed');
});

async function googlePanelFixture() {
  const items = new Map(); const node = id => { if(!items.has(id))items.set(id,{hidden:true,disabled:false,checked:false,textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k];}});return items.get(id); };
  const state={importEnabled:true,googleLinked:true,copyStored:false,photoInUse:false,noticeVersion:'g2'};
  const session={access_token:'fake',user:{id:'user-a'}};
  const server={copyConflict:false,reads:0,posts:0,statusEvents:0,holdPost:null,bodies:[],profileEvents:[]};
  const window={SupabaseAuth:{getCurrentUser:async()=>session.user,getClient:()=>({auth:{getSession:async()=>({data:{session}})}})}};
  const document={readyState:'loading',getElementById:node,addEventListener(){},dispatchEvent(event){if(event.type==='profile:updated')server.profileEvents.push(event.detail);else server.statusEvents++;}};
  const source=(await read('js/profile-google-photo.js')).replace('window.ProfileGooglePhoto = { load: load,','window.ProfileGooglePhoto = { renderForTest: render, runForTest: run, load: load,');
  vm.runInNewContext(source,{window,document,Promise,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options&&options.detail;}},fetch:async(_url,options)=>{
    var getSnapshot=options.method==='GET'?JSON.parse(JSON.stringify(state)):null;
    if(options.method==='POST'){
      server.posts++;server.bodies.push(JSON.parse(options.body));
      if(server.postError)throw server.postError;
      if(server.postResponse)return server.postResponse;
      if(server.bodies.at(-1).action==='select'){state.photoInUse=true;state.avatarRevision=server.bodies.at(-1).expectedRevision+1;}
      if(server.holdPost)await server.holdPost;
      if(server.copyConflict){state.copyStored=true;return {ok:false,status:409,json:async()=>({error:'photo_copy_exists'})};}
    }else {server.reads++;if(server.holdGet)await server.holdGet;if(server.getError)throw server.getError;}
    return {ok:true,json:async()=>getSnapshot||JSON.parse(JSON.stringify(state))};
  }});
  return {api:window.ProfileGooglePhoto,node,state,session,server,window};
}

test('Google photo offers, active photos and pending deletion have exclusive actions', async()=>{
  const f=await googlePanelFixture();f.api.renderForTest(f.state);assert.equal(f.node('googlePhotoOffer').hidden,false);assert.equal(f.node('googlePhotoWithdraw').hidden,true);assert.equal(f.node('googlePhotoReconnect').hidden,true);
  f.api.renderForTest({...f.state,photoInUse:true,consent:{decision:'granted'}});assert.equal(f.node('googlePhotoOffer').hidden,true);assert.equal(f.node('googlePhotoWithdraw').hidden,false);
  f.api.renderForTest({...f.state,copyStored:true,consent:{decision:'withdrawn'}});assert.equal(f.node('googlePhotoOffer').hidden,true);assert.equal(f.node('googlePhotoWithdraw').hidden,false);assert.equal(f.node('googlePhotoReconnect').hidden,true);
});

test('Google reauthentication is offered only after a failed import and hides the import form',async()=>{
  const f=await googlePanelFixture();await f.api.load();assert.equal(f.node('googlePhotoReconnect').hidden,true);
  await f.api.runForTest('import');assert.equal(f.api.isArcadeSelectionLocked('user-a'),false);assert.equal(f.server.posts,0);assert.equal(f.server.reads,1);assert.equal(f.node('googlePhotoReconnect').hidden,false);assert.equal(f.node('googlePhotoOffer').hidden,true);assert.equal(f.node('googlePhotoWithdraw').hidden,true);
});


test('an import copy conflict refreshes status once and offers withdrawal without retrying import', async()=>{
  const f=await googlePanelFixture();await f.api.load();f.session.provider_token='fake-proof';f.server.copyConflict=true;
  await f.api.runForTest('import');assert.equal(f.server.posts,1);assert.equal(f.server.reads,2);
  assert.equal(f.node('googlePhotoWithdraw').hidden,false);assert.equal(f.node('googlePhotoOffer').hidden,true);assert.equal(f.node('googlePhotoReconnect').hidden,true);
});

test('Profile failures identify read versus rendering without logging private exception contents', async () => {
  for (const stage of ['read', 'render_public_profile', 'render_poker_projection']) {
    const failure = Object.assign(new TypeError('private response or account data'), {code:'private-value'});
    let reads = 0;
    const f = await accountReadFixture(async () => { reads++; if(stage==='read')throw failure;return {avatar:{variant:'wizard-indigo'}}; });
    if(stage==='render_public_profile')f.context.renderPublicProfile=()=>{throw failure;};
    if(stage==='render_poker_projection')f.context.renderPokerProjection=()=>{throw failure;};
    await f.load();
    assert.equal(reads,1);
    assert.equal(f.events.errors,1);
    assert.equal(f.events.logs.length,1);
    assert.equal(f.events.logs[0].data.stage,stage);
    assert.equal(f.events.logs[0].data.exceptionType,'TypeError');
    assert.equal(f.events.logs[0].data.code,'request_failed');
    assert.doesNotMatch(JSON.stringify(f.events.logs),/private/);
  }
});

test('An older profile success or failure cannot overwrite a newer identity success', async () => {
  for (const fails of [false,true]) {
    let resolveOld,rejectOld,reads=0;
    const f=await accountReadFixture(()=>++reads===1?new Promise((resolve,reject)=>{resolveOld=resolve;rejectOld=reject;}):Promise.resolve({handle:'new-account'}));
    const old=f.load();
    f.context.currentUser={id:'user-b'};f.context.publicProfileGeneration++;f.context.publicProfileInFlight=null;
    await f.load();
    if(fails)rejectOld(new TypeError('private old response'));else resolveOld({handle:'old-account'});
    await old;
    assert.deepEqual(f.events.rendered,[{handle:'new-account'}]);
    assert.equal(f.context.profileLoadState,'success');assert.equal(f.events.errors,0);
    if(fails)assert.equal(f.events.logs.length,0);
  }
});


test('Profile diagnostics verify admin identity, flush one sanitized error and revoke access', async () => {
  const f=await accountReadFixture(async()=>{throw Object.assign(new TypeError('private email/token/response'),{code:'private-code'});});
  let requests=0;
  f.context.fetch=async(url,options)=>{requests++;assert.equal(url,'/.netlify/functions/admin-me');assert.equal(options.headers.Authorization,'Bearer private-token');return {ok:true,json:async()=>({isAdmin:true,userId:'user-a'})};};
  await f.load();
  assert.equal(requests,1);assert.equal(f.events.logs.length,1);assert.deepEqual(f.events.access,[true,false]);assert.deepEqual(f.events.flushes,[true]);
  assert.deepEqual(Object.keys(f.events.logs[0].data).sort(),['code','currentRequest','exceptionType','stage']);
  assert.doesNotMatch(JSON.stringify(f.events.logs),/private|user-a|Bearer|@/);
});

test('Profile diagnostics fail closed for denied, malformed or mismatched admin responses', async () => {
  for(const response of [
    {ok:false,json:async()=>({isAdmin:false})},
    {ok:true,json:async()=>({isAdmin:false,userId:'user-a'})},
    {ok:true,json:async()=>({isAdmin:'true',userId:'user-a'})},
    {ok:true,json:async()=>({isAdmin:true,userId:'user-b'})},
    {ok:true,json:async()=>null},
    {ok:true,json:async()=>{throw new SyntaxError('private invalid body');}},
    null
  ]){
    const f=await accountReadFixture(async()=>{throw new Error('private failure');});
    let requests=0;f.context.fetch=async()=>{requests++;if(!response)throw new Error('private fetch failure');return response;};
    await f.load();assert.equal(requests,1);assert.equal(f.events.logs.length,0);assert.equal(f.events.access.length,0);assert.equal(f.events.flushes.length,0);
  }
});

test('Profile diagnostics discard verification after switching identities, including switching back', async()=>{
  for(const switchBack of [false,true]){
    let release;const f=await accountReadFixture(async()=>{throw new Error('private failure');});
    f.context.fetch=()=>new Promise(resolve=>{release=resolve;});
    await f.load();assert.equal(typeof release,'function');
    f.context.currentUser={id:'user-b'};f.context.publicProfileGeneration++;
    if(switchBack){f.context.currentUser={id:'user-a'};f.context.publicProfileGeneration++;}
    release({ok:true,json:async()=>({isAdmin:true,userId:'user-a'})});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.events.logs.length,0);assert.equal(f.events.access.length,0);assert.equal(f.events.flushes.length,0);
  }
});

test('A single verified profile failure survives recorder access revocation in existing storage', async()=>{
  const f=await accountReadFixture(async()=>{throw new TypeError('private profile response');});
  const storage=new Map();
  f.context.window.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  f.context.window.location={search:''};f.context.window.dispatchEvent=()=>{};
  vm.runInContext(await read('js/debug.js'),f.context);
  f.context.klog=(kind,data)=>{f.events.logs.push({kind,data});f.context.window.KLog.log(kind,data);};
  await f.load();
  const persisted=JSON.parse(storage.get('kcswh:debug:log'));
  assert.equal(persisted.length,1);assert.match(persisted[0],/profile:account_load_failed/);assert.match(persisted[0],/render|read/);
  assert.doesNotMatch(persisted[0],/private|user-a|Bearer|@/);
  assert.equal(f.context.window.KLog.isAdmin(),false);assert.equal(f.context.window.KLog.getText(),'');
  // A new page restores only the buffer, never administrator authority.
  vm.runInContext(await read('js/debug.js'),f.context);
  assert.equal(f.context.window.KLog.isAdmin(),false);assert.equal(f.context.window.KLog.getText(),'');
});


test('Verified Google consent and copy do not lock Arcade selection; unresolved identity still does',async()=>{
 const f=await googlePanelFixture();assert.equal(f.api.isArcadeSelectionLocked('user-a'),true);
 await f.api.load();assert.equal(f.api.isArcadeSelectionLocked('user-a'),false);
 f.state.copyStored=true;f.state.photoInUse=true;f.state.consent={decision:'granted'};await f.api.load();assert.equal(f.api.isArcadeSelectionLocked('user-a'),false);
 f.state.photoInUse=false;f.state.consent={decision:'withdrawn'};await f.api.load();assert.equal(f.api.isArcadeSelectionLocked('user-a'),false);
 f.state.copyStored=false;await f.api.load();assert.equal(f.api.isArcadeSelectionLocked('user-a'),false);
 f.session.user={id:'user-b'};assert.equal(f.api.isArcadeSelectionLocked('user-b'),true);
});


test('Google import and withdrawal lock Arcade selection and notify on both busy transitions',async()=>{
 for(const action of ['import','withdraw']){
  const f=await googlePanelFixture();f.session.provider_token='synthetic-proof';await f.api.load();
  assert.equal(f.api.isArcadeSelectionLocked('user-a'),false);
  let release;f.server.holdPost=new Promise(resolve=>{release=resolve;});
  const before=f.server.statusEvents,pending=f.api.runForTest(action);
  assert.equal(f.api.isArcadeSelectionLocked('user-a'),true);assert.equal(f.server.statusEvents,before+1);
  while(!f.server.posts)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.api.isArcadeSelectionLocked('user-a'),true);release();await pending;
  assert.equal(f.api.isArcadeSelectionLocked('user-a'),false);assert.equal(f.server.statusEvents,before+4);
 }
});

test('Verified Google selection prevents an Arcade saved marker even when its signed URL is unavailable',async()=>{
 const source=await read('js/account-page.js'),start=source.indexOf('  function syncAvatarSelection('),end=source.indexOf('  function renderAvatarGallery(',start);
 const button={dataset:{variant:'wizard-indigo'},lastChild:{hidden:false},attributes:{},setAttribute(k,v){this.attributes[k]=v;}};
 const gallery={children:[button],setAttribute(){}};let locked=true;
 const context={doc:{getElementById:id=>id==='arcadeAvatarGallery'?gallery:null},publicProfile:{avatarVariant:'wizard-indigo',avatar:{type:'default',variant:'wizard-indigo'}},avatarSelection:'google',avatarMessage:'',avatarSaving:null,nodes:{publicAvatarSave:{setAttribute(){}}},savedAvatarSelection:()=> 'google',googleAvatarChoice:()=>null,hasGoogleAvatar:()=>false,avatarSelectionLocked:()=>locked,allowedAvatarVariants:()=>['wizard-indigo'],t:(_,fallback)=>fallback};
 vm.runInNewContext(source.slice(start,end)+'syncAvatarSelection();',context);
 assert.equal(button.attributes['aria-pressed'],'false');assert.equal(button.attributes['data-saved'],'false');assert.equal(button.lastChild.hidden,true);assert.equal(button.disabled,true);assert.equal(context.nodes.publicAvatarSave.disabled,true);
 locked=false;context.avatarSelection='wizard-indigo';context.savedAvatarSelection=()=> 'wizard-indigo';vm.runInNewContext('syncAvatarSelection();',context);
 assert.equal(button.attributes['aria-pressed'],'true');assert.equal(button.attributes['data-saved'],'true');assert.equal(button.lastChild.hidden,false);
});


test('Google gallery choice uses existing consent and CAS, refreshes confirmed profile and rejects switched accounts',async()=>{
 for(const switched of [false,true]){
  const f=await googlePanelFixture();Object.assign(f.state,{copyStored:true,consent:{decision:'granted'},photoInUse:false,avatarRevision:2,previewAvatar:{type:'uploaded',url:'synthetic-preview'}});
  await f.api.load();assert.equal(f.api.getChoice('user-a').type,'uploaded');assert.equal(f.api.getChoice('other'),null);assert.equal(f.api.isArcadeSelectionLocked('user-a'),false);
  f.window.ProfileClient={getMe:async()=>({avatar:{type:'uploaded'},avatarRevision:3})};
  let release;f.server.holdPost=new Promise(resolve=>{release=resolve;});
  const selecting=f.api.select(2,{userId:'user-a',isCurrent:()=>true});
  while(!f.server.posts)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.api.isArcadeSelectionLocked('user-a'),true);assert.deepEqual(f.server.bodies,[{action:'select',expectedRevision:2}]);
  if(switched)f.session.user={id:'user-b'};release();
  if(switched){await assert.rejects(selecting,{code:'stale_identity'});assert.equal(f.server.profileEvents.length,0);}
  else{const result=await selecting;assert.equal(result.avatarRevision,3);assert.equal(f.server.profileEvents.length,1);assert.equal(f.api.isSelected('user-a',3),true);}
 }
});


test('Failed Google select reconciles once, unlocks Arcade and preserves withdrawal without retrying POST',async()=>{
 for(const denied of [false,true]){
  const f=await googlePanelFixture();Object.assign(f.state,{copyStored:true,consent:{decision:'granted'},photoInUse:false,avatarRevision:2,previewAvatar:{type:'uploaded',url:'synthetic-preview'}});await f.api.load();
  if(denied)f.server.postResponse={ok:false,status:409,json:async()=>({error:'photo_copy_unavailable'})};else f.server.postError=new TypeError('synthetic offline');
  await assert.rejects(f.api.select(2,{userId:'user-a',isCurrent:()=>true}));
  assert.equal(f.server.posts,1);assert.equal(f.server.reads,2);assert.equal(f.api.isArcadeSelectionLocked('user-a'),false);
  assert.equal(f.node('googlePhotoPanel').hidden,false);assert.equal(f.node('googlePhotoWithdraw').hidden,false);
  if(denied)assert.match(f.node('googlePhotoState').textContent,/unavailable/);
 }
});

test('Failed reconciliation keeps only withdrawal available, not an unverified photo choice',async()=>{
 const f=await googlePanelFixture();Object.assign(f.state,{copyStored:true,consent:{decision:'granted'},photoInUse:false,avatarRevision:2,previewAvatar:{type:'uploaded',url:'synthetic-preview'}});await f.api.load();
 f.server.postError=new TypeError('synthetic offline');f.server.getError=new TypeError('synthetic offline');
 await assert.rejects(f.api.select(2,{userId:'user-a',isCurrent:()=>true}));
 assert.equal(f.server.posts,1);assert.equal(f.server.reads,2);assert.equal(f.api.isArcadeSelectionLocked('user-a'),true);assert.equal(f.api.getChoice('user-a'),null);
 assert.equal(f.node('googlePhotoWithdraw').hidden,false);assert.equal(f.node('googlePhotoOffer').hidden,true);
});

test('Confirmed withdrawal is not reported as failed when the subsequent profile refresh fails',async()=>{
 const f=await googlePanelFixture();Object.assign(f.state,{copyStored:true,consent:{decision:'granted'}});await f.api.load();
 Object.assign(f.state,{copyStored:false,consent:{decision:'withdrawn'},copyDeleted:true});f.window.ProfileClient={clear(){},getMe:async()=>{throw new TypeError('synthetic read failed');}};
 await f.api.runForTest('withdraw');assert.equal(f.server.posts,1);assert.equal(f.server.reads,2);assert.equal(f.api.isArcadeSelectionLocked('user-a'),false);
 assert.match(f.node('googlePhotoState').textContent,/copy was deleted/);assert.equal(f.api.getChoice('user-a'),null);
});


test('Same-owner background GET preserves display choice but never authorizes it before verification',async()=>{
 for(const fails of [false,true]){
  const f=await googlePanelFixture();Object.assign(f.state,{copyStored:true,consent:{decision:'granted'},photoInUse:true,avatarRevision:2,previewAvatar:{type:'uploaded',url:'synthetic-preview'}});await f.api.load();
  const choice=f.api.getChoice('user-a');let release;f.server.holdGet=new Promise(resolve=>{release=resolve;});if(fails)f.server.getError=new TypeError('synthetic offline');
  const pending=f.api.load();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.api.getChoice('user-a',true),choice);assert.equal(f.api.getChoice('user-a'),null);assert.equal(f.api.isArcadeSelectionLocked('user-a'),true);
  release();await pending;assert.equal(f.api.getChoice('user-a',true).url,choice.url);
  assert.equal(f.api.isArcadeSelectionLocked('user-a'),fails);
  f.session.user=null;await f.api.load();assert.equal(f.api.getChoice('user-a',true),null);
 }
});

test('Verified missing or withdrawn copy removes the display choice after a background refresh',async()=>{
 for(const withdrawn of [false,true]){
  const f=await googlePanelFixture();Object.assign(f.state,{copyStored:true,consent:{decision:'granted'},previewAvatar:{type:'uploaded',url:'synthetic-preview'}});await f.api.load();
  delete f.state.previewAvatar;if(withdrawn){f.state.consent={decision:'withdrawn'};f.state.copyStored=false;}
  await f.api.load();assert.equal(f.api.getChoice('user-a',true),null);assert.equal(f.api.getChoice('user-a'),null);
 }
});


test('Background status never retains a previous account photo after identity change or access denial',async()=>{
 for(const denied of [false,true]){
  const f=await googlePanelFixture();Object.assign(f.state,{copyStored:true,consent:{decision:'granted'},previewAvatar:{type:'uploaded',url:'synthetic-preview'}});await f.api.load();
  let release;f.server.holdGet=new Promise(resolve=>{release=resolve;});const pending=f.api.load();while(f.server.reads<2)await new Promise(resolve=>setImmediate(resolve));
  if(denied)f.server.getError={status:403};else f.session.user={id:'user-b'};release();await pending;
  assert.equal(f.api.getChoice('user-a',true),null);assert.equal(f.api.getChoice('user-b',true),null);
 }
});


test('Withdrawal invalidates an older pending status GET so it cannot restore the deleted photo',async()=>{
 const f=await googlePanelFixture();Object.assign(f.state,{copyStored:true,consent:{decision:'granted'},photoInUse:true,previewAvatar:{type:'uploaded',url:'synthetic-preview'}});await f.api.load();
 let release;f.server.holdGet=new Promise(resolve=>{release=resolve;});const old=f.api.load();while(f.server.reads<2)await new Promise(resolve=>setImmediate(resolve));
 f.server.holdGet=null;Object.assign(f.state,{copyStored:false,photoInUse:false,consent:{decision:'withdrawn'},copyDeleted:true});delete f.state.previewAvatar;
 await f.api.runForTest('withdraw');release();await old;
 assert.equal(f.api.getChoice('user-a',true),null);assert.equal(f.node('googlePhotoWithdraw').hidden,true);assert.equal(f.node('googlePhotoOffer').hidden,false);
 assert.equal(f.server.posts,1);assert.equal(f.server.reads,3);assert.equal(f.node('googlePhotoPanel').getAttribute('aria-busy'),'false');
});


test('Initial delayed photo status is explicitly loading and never offers an unverified photo',async()=>{
 const f=await googlePanelFixture();let release;f.server.holdGet=new Promise(resolve=>{release=resolve;});const loading=f.api.load();while(!f.server.reads)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.node('googlePhotoPanel').hidden,true);assert.equal(f.node('googlePhotoPanel').getAttribute('aria-busy'),'true');assert.equal(f.api.getChoice('user-a'),null);assert.equal(f.api.isArcadeSelectionLocked('user-a'),true);
 release();await loading;assert.equal(f.api.isArcadeSelectionLocked('user-a'),false);
});


test('Failed or OFF initial photo GET never reveals an unverified Google panel or stale loading state',async()=>{
 for(const failure of [new TypeError('synthetic offline'),{status:404},{status:503},null]){
  const f=await googlePanelFixture();if(failure)f.server.getError=failure;else f.state.googleLinked=false;
  await f.api.load();assert.equal(f.node('googlePhotoPanel').hidden,true);assert.equal(f.node('googlePhotoPanel').getAttribute('aria-busy'),'false');assert.equal(f.api.getChoice('user-a'),null);
 }
});
