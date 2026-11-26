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
  const [account, page, config, headers, privacyEn, privacyPl, termsEn, termsPl, portalCss, accountJs, profileClient] = await Promise.all([
    read("account.html"), read("profile.html"), read("netlify.toml"), read("_headers"), read("legal/privacy.en.html"), read("legal/privacy.pl.html"), read("legal/terms.en.html"), read("legal/terms.pl.html"), read("css/portal.css"), read("js/account-page.js"), read("js/profile-client.js")
  ]);
  assert.match(account, /id="publicProfileEditor"/);
  assert.match(account, /id="publicProfileForm"/);
  assert.match(account, /id="publicProfileSave"/);
  assert.match(account, /id="arcadeAvatarGallery"/);
  assert.doesNotMatch(account, /id="publicAvatarInput"|id="publicBio"|id="publicAvatarRemove"/);
  assert.doesNotMatch(profileClient, /uploadAvatar|removeAvatar/);
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
  assert.match(headers, /img-src[^;]*https:\/\/\*\.supabase\.co/, "public avatar Storage URLs must be allowed by canonical CSP");
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
  assert.match(source, /ArcadeAvatars\.apply/);
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


test("public profile reads require viewer auth, never put token in URL and discard stale sessions", async()=>{
 let userId=null,requests=0;
 const anon=await loadProfileClient(async()=>{requests++;},()=>userId);
 await assert.rejects(anon.getPublic('target'),{code:'not_authenticated'});assert.equal(requests,0);
 for(const next of [null,'user-b','user-a']){
  userId='user-a';let release;let request;
  const client=await loadProfileClient((url,options)=>{request={url,options};return new Promise(resolve=>{release=resolve;});},()=>userId);
  const pending=client.getPublic('target');await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(request.options.headers.Authorization,'Bearer token-user-a');assert.equal(request.options.cache,'no-store');assert.equal(request.url.includes('token-user-a'),false);
  userId=next;client.clear();release({ok:true,json:async()=>({handle:'target'})});await assert.rejects(pending,{code:'stale_identity'});
 }
});

test("profile page clears on logout, account switch and hiding; visibility return rechecks session", async()=>{
 const source=await read('js/public-profile-page.js');
 for(const mode of ['logout','switch','hidden-return']){
  const nodes=new Map(),listeners={};let authChange,release,user={id:'viewer-a'},reads=0;
  function node(){return {hidden:false,textContent:'',dataset:{},setAttribute(){},removeAttribute(){},classList:{remove(){}}};}
  const document={hidden:false,readyState:'complete',getElementById:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},addEventListener:(name,fn)=>{listeners[name]=fn;}};
  const window={location:{pathname:'/u/target'},SupabaseAuth:{getCurrentUser:async()=>user,onAuthChange:fn=>{authChange=fn;}},ProfileClient:{applyAvatar(){},getPublic:()=>{reads++;return reads===1?new Promise(resolve=>{release=resolve;}):Promise.resolve({handle:'target',displayName:'Fresh identity',xp:2,level:1});}}};
  vm.runInNewContext(source,{window,document,Intl,setTimeout,clearTimeout});await new Promise(resolve=>setTimeout(resolve,0));
  nodes.get('publicProfileName').textContent='old identity';
  if(mode==='hidden-return'){document.hidden=true;listeners.visibilitychange();}
  user=mode==='logout'?null:{id:'viewer-b'};authChange('SIGNED_OUT',null);
  assert.equal(nodes.get('publicProfileCard').hidden,true);assert.equal(nodes.get('publicProfileName').textContent,'');
  release({handle:'target',displayName:'must not reappear',xp:1,level:1});await new Promise(resolve=>setTimeout(resolve,0));
  assert.notEqual(nodes.get('publicProfileName').textContent,'must not reappear');
  if(mode==='logout'){assert.equal(nodes.get('publicProfileCard').hidden,true);assert.equal(nodes.get('publicProfileSignIn').hidden,false);}
  if(mode==='hidden-return'){
   assert.equal(reads,1,'no auth-triggered read or rendering while hidden');assert.equal(nodes.get('publicProfileCard').hidden,true);
   document.hidden=false;listeners.visibilitychange();await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(mode!=='logout'){assert.equal(reads,2);assert.equal(nodes.get('publicProfileName').textContent,'Fresh identity');}
 }
});

test('avatar loading and expired photos stay neutral; late photo callbacks cannot repaint a cleared identity',async()=>{
 const images=[],timers=[];let catalog=0,now=Date.now();
 const window={SUPABASE_CONFIG:{SUPABASE_URL:'https://stage.supabase.co'},ArcadeAvatars:{apply(node){catalog++;node.style.backgroundImage='catalog';}}};
 vm.runInNewContext(await read('js/profile-client.js'),{window,URL,atob,Date:{now:()=>now},Image:class{constructor(){images.push(this);}},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}});
 const node={dataset:{},style:{},classList:{add(){},remove(){}},textContent:''};
 window.ProfileClient.applyAvatar(node,null);assert.equal(catalog,0);assert.equal(node.textContent,'AH');
 const url=exp=>'https://stage.supabase.co/storage/v1/object/sign/profile-avatar-uploads/pending/00000000-0000-0000-0000-000000000001?token=x.'+btoa(JSON.stringify({exp}))+'.x';
 const profile={avatar:{type:'uploaded',variant:'wizard-indigo',url:url(Math.floor(Date.now()/1000)+60)}};
 window.ProfileClient.applyAvatar(node,profile);assert.equal(node.textContent,'');assert.equal(node.dataset.avatarLoading,'true');assert.equal(node.style.backgroundImage,'');
 images[0].onload();assert.equal(node.dataset.avatarLoading,undefined);assert.equal(node.style.backgroundImage,'url("'+profile.avatar.url+'")');
 window.ProfileClient.applyAvatar(node,null);images[0].onload();assert.equal(node.dataset.avatarLoading,undefined);assert.equal(node.style.backgroundImage,'');assert.equal(node.textContent,'AH');
 window.ProfileClient.applyAvatar(node,{avatar:{...profile.avatar,url:url(1)}});assert.equal(catalog,0);assert.equal(node.textContent,'AH');
 window.ProfileClient.applyAvatar(node,profile);now+=65000;images.at(-1).onload();assert.equal(node.style.backgroundImage,'');now=Date.now();
 window.ProfileClient.applyAvatar(node,profile);timers.at(-1)();images.at(-1).onload();assert.equal(node.style.backgroundImage,'');assert.equal(node.textContent,'AH');
 window.ProfileClient.applyAvatar(node,profile);window.ProfileClient.applyAvatar(node,{avatar:{type:'default',variant:'default'}});images.at(-1).onload();assert.equal(node.style.backgroundImage,'catalog');
});

test('public profile masking passes only the default avatar when the viewer blocks the handle',async()=>{
 const source=await read('js/public-profile-page.js'),start=source.indexOf('  function applyProfileAvatar('),end=source.indexOf('\n  function render(',start);
 let blocked=false;const seen=[];
 const context={currentProfile:{handle:'target',displayName:'Player',avatar:{type:'uploaded',url:'private-photo-url'}},appliedAvatar:null,avatar:{},window:{ArcadeUgc:{isBlockedHandle:()=>blocked},ProfileClient:{applyAvatar:(_node,profile)=>seen.push(profile)}}};
 vm.runInNewContext(source.slice(start,end)+'\napplyProfileAvatar();',context);
 blocked=true;vm.runInNewContext(source.slice(start,end)+'\napplyProfileAvatar();',context);
 assert.equal(seen[0].avatar.type,'uploaded');assert.equal(seen[1].avatar.type,'default');assert.equal(seen[1].avatar.url,undefined);
});

test("profile-client own-photo cache, expiry prevention, and fallbacks", async () => {
  const source = await read("js/profile-client.js");
  const url = (uuid = "00000000-0000-0000-0000-000000000001", exp = Math.floor(Date.now() / 1000) + 60) =>
    `https://stage.supabase.co/storage/v1/object/sign/profile-avatar-uploads/pending/${uuid}?token=x.${btoa(JSON.stringify({ exp }))}.x`;
  const makeWebpDataUrl = () => 'data:image/webp;base64,' + Buffer.concat([Buffer.from('RIFF\x00\x00\x00\x00WEBP'), Buffer.alloc(20)]).toString('base64');
  const storedDataUrl = makeWebpDataUrl();

  // 1. A loaded photo is still shown after its expiry timer; the same path on re-render issues no new request; onload after deadline falls back
  {
    const images = [], timers = [];
    let now = Date.now();
    const window = {
      SUPABASE_CONFIG: { SUPABASE_URL: "https://stage.supabase.co" },
      ArcadeAvatars: { apply(node) { node.style.backgroundImage = "catalog"; } }
    };
    vm.runInNewContext(source, {
      window,
      URL,
      atob,
      btoa,
      Date: { now: () => now },
      Image: class { constructor() { images.push(this); } },
      setTimeout: (fn) => { timers.push(fn); return timers.length; },
      clearTimeout(id) { if (timers[id - 1]) timers[id - 1] = () => {}; }
    });
    const node = { dataset: {}, style: {}, classList: { add() {}, remove() {} }, textContent: "" };
    const profile = { avatar: { type: "uploaded", url: url("00000000-0000-0000-0000-000000000001") } };

    // Apply photo and load before deadline
    window.ProfileClient.applyAvatar(node, profile);
    assert.equal(images.length, 1);
    images[0].onload();
    assert.equal(node.style.backgroundImage, `url("${profile.avatar.url}")`);
    assert.equal(node.dataset.avatarShownPath, "pending/00000000-0000-0000-0000-000000000001");

    // After expiry timer would have fired, photo is still shown
    now += 65000;
    if (timers[0]) timers[0]();
    assert.equal(node.style.backgroundImage, `url("${profile.avatar.url}")`);

    // Re-rendering with same path issues no new image request
    window.ProfileClient.applyAvatar(node, profile);
    assert.equal(images.length, 1, "no new image request for same path");

    // Onload after deadline falls back
    const node2 = { dataset: {}, style: {}, classList: { add() {}, remove() {} }, textContent: "" };
    now = Date.now();
    window.ProfileClient.applyAvatar(node2, profile);
    assert.equal(images.length, 2);
    now += 65000;
    images[1].onload();
    assert.equal(node2.style.backgroundImage, "", "onload after deadline falls back");
    assert.equal(node2.textContent, "AH");
  }

  // 2. Own photo: same path -> no fetch; URL-less uploaded marker -> stored record; catalog removes record; name-only does not
  {
    const fetchCalls = [];
    let clearedUserId = null;
    let userId = "user-own-1";
    const path1 = "pending/00000000-0000-0000-0000-000000000001";
    let storedRecord = { path: path1, dataUrl: storedDataUrl };
    const window = {
      SUPABASE_CONFIG: { SUPABASE_URL: "https://stage.supabase.co" },
      SupabaseAuth: { getCurrentUser: async () => ({ id: userId }) },
      SupabaseAuthBridge: { getAccessToken: async () => "token" },
      UserUiState: {
        readPhoto: (uid) => ({ available: true, record: uid === userId ? storedRecord : null }),
        writePhoto: (uid, rec) => { storedRecord = rec; return true; },
        clearPhoto: (uid) => { clearedUserId = uid; storedRecord = null; }
      },
      ArcadeAvatars: { apply(node) { node.style.backgroundImage = "catalog"; } }
    };
    vm.runInNewContext(source, {
      window,
      URL,
      atob,
      btoa,
      fetch: async (fetchUrl, opts) => { fetchCalls.push({ url: fetchUrl, opts }); },
      Date,
      Image: class {},
      setTimeout,
      clearTimeout
    });

    const node = { dataset: {}, style: {}, classList: { add() {}, remove() {} }, textContent: "" };
    const profileSame = { avatar: { type: "uploaded", url: url("00000000-0000-0000-0000-000000000001") } };

    // Same path: shows stored record without fetch
    window.ProfileClient.applyAvatar(node, profileSame, { ownUserId: userId });
    assert.equal(fetchCalls.length, 0, "no fetch for same path");
    assert.equal(node.style.backgroundImage, `url("${storedDataUrl}")`);
    assert.equal(node.dataset.avatarShownPath, path1);

    // URL-less uploaded marker shows stored record
    const nodeHydrated = { dataset: {}, style: {}, classList: { add() {}, remove() {} }, textContent: "" };
    window.ProfileClient.applyAvatar(nodeHydrated, { avatar: { type: "uploaded" } }, { ownUserId: userId });
    assert.equal(nodeHydrated.style.backgroundImage, `url("${storedDataUrl}")`);

    // Name-only render removes nothing
    clearedUserId = null;
    window.ProfileClient.applyAvatar(node, { displayName: "Just Name" }, { ownUserId: userId });
    assert.equal(clearedUserId, null, "name-only render removes nothing");
    assert.ok(storedRecord !== null);

    // Catalog avatar removes record
    window.ProfileClient.applyAvatar(node, { avatar: { type: "default", variant: "fox-blue" } }, { ownUserId: userId });
    assert.equal(clearedUserId, userId, "catalog avatar removes stored record");
    assert.equal(storedRecord, null);

    // URL-less marker without stored record falls back to AH
    const nodeNoRecord = { dataset: {}, style: {}, classList: { add() {}, remove() {} }, textContent: "" };
    window.ProfileClient.applyAvatar(nodeNoRecord, { avatar: { type: "uploaded" } }, { ownUserId: userId });
    assert.equal(nodeNoRecord.textContent, "AH");
  }

  // 3. Own photo: new path, two nodes share one fetch, both shown, record saved
  {
    const fetchCalls = [];
    let resolveBlob;
    let userId = "user-own-2";
    let savedRecord = null;
    const window = {
      SUPABASE_CONFIG: { SUPABASE_URL: "https://stage.supabase.co" },
      SupabaseAuth: { getCurrentUser: async () => ({ id: userId }) },
      SupabaseAuthBridge: { getAccessToken: async () => "token" },
      UserUiState: {
        readPhoto: () => ({ available: true, record: savedRecord }),
        writePhoto: (_uid, rec) => { savedRecord = rec; return true; }
      }
    };
    vm.runInNewContext(source, {
      window,
      URL,
      atob,
      btoa,
      fetch: async (fetchUrl) => {
        fetchCalls.push(fetchUrl);
        return {
          ok: true,
          status: 200,
          headers: { get: (h) => (h && h.toLowerCase() === "content-type" ? "image/webp" : "") },
          blob: async () => new Promise((resolve) => { resolveBlob = resolve; })
        };
      },
      Date,
      Image: class {},
      setTimeout,
      clearTimeout
    });

    const nodeA = { dataset: {}, style: {}, classList: { add() {}, remove() {} }, textContent: "" };
    const nodeB = { dataset: {}, style: {}, classList: { add() {}, remove() {} }, textContent: "" };
    const profileNew = { avatar: { type: "uploaded", url: url("00000000-0000-0000-0000-000000000002") } };

    window.ProfileClient.applyAvatar(nodeA, profileNew, { ownUserId: userId });
    window.ProfileClient.applyAvatar(nodeB, profileNew, { ownUserId: userId });
    assert.equal(fetchCalls.length, 1, "two nodes share one in-flight fetch");

    await new Promise((r) => setTimeout(r, 10));
    const webpBuffer = Buffer.concat([Buffer.from("RIFF\x00\x00\x00\x00WEBP"), Buffer.alloc(24)]);
    resolveBlob({
      size: webpBuffer.length,
      type: "image/webp",
      arrayBuffer: async () => webpBuffer.buffer.slice(webpBuffer.byteOffset, webpBuffer.byteOffset + webpBuffer.byteLength)
    });
    // A render while the shared entry is still checking the session and saving joins it: no second download.
    const nodeD = { dataset: {}, style: {}, classList: { add() {}, remove() {} }, textContent: "" };
    window.ProfileClient.applyAvatar(nodeD, profileNew, { ownUserId: userId });
    assert.equal(fetchCalls.length, 1, "render during the session check joins the shared entry");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(nodeD.style.backgroundImage, nodeA.style.backgroundImage);
    // An already expired link is not fetched.
    const nodeE = { dataset: {}, style: {}, classList: { add() {}, remove() {} }, textContent: "" };
    window.ProfileClient.applyAvatar(nodeE, { avatar: { type: "uploaded", url: url("00000000-0000-0000-0000-000000000009", Math.floor(Date.now() / 1000) - 5) } }, { ownUserId: userId });
    assert.equal(fetchCalls.length, 1, "expired link is not fetched");

    assert.ok(nodeA.style.backgroundImage.includes("data:image/webp;base64,"));
    assert.ok(nodeB.style.backgroundImage.includes("data:image/webp;base64,"));
    assert.equal(nodeA.style.backgroundImage, nodeB.style.backgroundImage);
    assert.equal(savedRecord && savedRecord.path, "pending/00000000-0000-0000-0000-000000000002");
    // The saved data URL holds exactly the downloaded bytes, so the real UserUiState validation can accept it.
    assert.equal(savedRecord.dataUrl, "data:image/webp;base64," + webpBuffer.toString("base64"));
    // A later node with the same path reuses the saved record: no new download.
    const nodeC = { dataset: {}, style: {}, classList: { add() {}, remove() {} }, textContent: "" };
    window.ProfileClient.applyAvatar(nodeC, profileNew, { ownUserId: userId });
    assert.equal(fetchCalls.length, 1, "saved record is reused without a new fetch");
    assert.equal(nodeC.style.backgroundImage, 'url("' + savedRecord.dataUrl + '")');
  }

  // 4. Download finishing after clear() or account switch writes nothing and changes no node
  {
    let resolveBlob;
    let userId = "user-own-3";
    let wrotePhoto = false;
    const window = {
      SUPABASE_CONFIG: { SUPABASE_URL: "https://stage.supabase.co" },
      SupabaseAuth: { getCurrentUser: async () => ({ id: userId }) },
      SupabaseAuthBridge: { getAccessToken: async () => "token" },
      UserUiState: {
        readPhoto: () => ({ available: true, record: null }),
        writePhoto: () => { wrotePhoto = true; return true; }
      }
    };
    vm.runInNewContext(source, {
      window,
      URL,
      atob,
      btoa,
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "image/webp" },
        blob: async () => new Promise((resolve) => { resolveBlob = resolve; })
      }),
      Date,
      Image: class {},
      setTimeout,
      clearTimeout
    });

    const node = { dataset: {}, style: {}, classList: { add() {}, remove() {} }, textContent: "" };
    const profile = { avatar: { type: "uploaded", url: url("00000000-0000-0000-0000-000000000003") } };
    window.ProfileClient.applyAvatar(node, profile, { ownUserId: userId });
    await new Promise((r) => setTimeout(r, 10));

    // Client clear() before download settles
    window.ProfileClient.clear();
    const webpBuffer = Buffer.concat([Buffer.from("RIFF\x00\x00\x00\x00WEBP"), Buffer.alloc(16)]);
    resolveBlob({ size: webpBuffer.length, type: "image/webp", arrayBuffer: async () => webpBuffer.buffer.slice(webpBuffer.byteOffset, webpBuffer.byteOffset + webpBuffer.byteLength) });
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(wrotePhoto, false, "download finishing after clear() writes nothing");
    assert.equal(node.style.backgroundImage, "", "node background not updated after clear()");
  }

  // 5. localStorage throwing -> plain applyPhoto; getItem works but setItem throws -> first shown, second uses plain applyPhoto
  {
    const images = [];
    let userId = "user-throw";
    let setItemThrew = false;
    const window = {
      SUPABASE_CONFIG: { SUPABASE_URL: "https://stage.supabase.co" },
      SupabaseAuth: { getCurrentUser: async () => ({ id: userId }) },
      SupabaseAuthBridge: { getAccessToken: async () => "token" },
      UserUiState: {
        readPhoto: () => ({ available: true, record: null }),
        writePhoto: () => { setItemThrew = true; return false; }
      }
    };
    const webpBuffer = Buffer.concat([Buffer.from("RIFF\x00\x00\x00\x00WEBP"), Buffer.alloc(16)]);
    vm.runInNewContext(source, {
      window,
      URL,
      atob,
      btoa,
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "image/webp" },
        blob: async () => ({ size: webpBuffer.length, type: "image/webp", arrayBuffer: async () => webpBuffer.buffer.slice(webpBuffer.byteOffset, webpBuffer.byteOffset + webpBuffer.byteLength) })
      }),
      Date,
      Image: class { constructor() { images.push(this); } },
      setTimeout,
      clearTimeout
    });

    const node1 = { dataset: {}, style: {}, classList: { add() {}, remove() {} }, textContent: "" };
    const profile = { avatar: { type: "uploaded", url: url("00000000-0000-0000-0000-000000000004") } };

    // First node downloads and displays, but writePhoto returns false
    window.ProfileClient.applyAvatar(node1, profile, { ownUserId: userId });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(setItemThrew, true);
    assert.ok(node1.style.backgroundImage.includes("data:image/webp;base64,"));

    // Second node on same page detects storageUsable = false and falls back to plain applyPhoto (uses Image)
    const node2 = { dataset: {}, style: {}, classList: { add() {}, remove() {} }, textContent: "" };
    const profile2 = { avatar: { type: "uploaded", url: url("00000000-0000-0000-0000-000000000005") } };
    window.ProfileClient.applyAvatar(node2, profile2, { ownUserId: userId });
    assert.equal(images.length, 1, "second node uses plain applyPhoto (Image created)");
    if (node2.profileAvatarExpiry) clearTimeout(node2.profileAvatarExpiry);
  }
});
