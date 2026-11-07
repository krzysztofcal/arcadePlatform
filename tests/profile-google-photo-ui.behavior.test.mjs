import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

// #1140 UGC phase D: Account page Google photo panel and the WWW photo renderer, against a minimal DOM.
const source = await readFile(new URL("../js/profile-google-photo.js", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../js/profile-client.js", import.meta.url), "utf8");
const html = await readFile(new URL("../account.html", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const USER = "11111111-1111-4111-8111-111111111111";

function element(id) {
  return { id, hidden: false, disabled: false, checked: false, textContent: "", listeners: {}, dataset: {}, style: {}, classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); } },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, fire(type) { (this.listeners[type] || []).forEach((fn) => fn({ target: this })); } };
}

function setup({ session, confirm = true, responses = {} } = {}) {
  const ids = ["googlePhotoPanel", "googlePhotoState", "googlePhotoOffer", "googlePhotoConsent", "googlePhotoImport", "googlePhotoReconnect", "googlePhotoWithdraw", "publicProfileAvatar"];
  const byId = Object.fromEntries(ids.map((id) => [id, element(id)]));
  const calls = [];
  let current = session === undefined ? { access_token: "access", provider_token: "provider", user: { id: USER } } : session;
  const window = {
    confirm: () => confirm,
    SupabaseAuth: {
      getClient: () => ({ auth: { getSession: async () => ({ data: { session: current } }) } }),
      getCurrentUser: async () => ({ id: USER }),
      onAuthChange: () => {},
      signInWithGoogle: async () => { calls.push({ reconnect: true }); },
    },
  };
  const fetch = async (url, options) => {
    calls.push({ url, method: options.method, headers: options.headers, body: options.body ? JSON.parse(options.body) : null });
    const key = options.method === "GET" ? "GET" : JSON.parse(options.body).action;
    const [status, body] = responses[key] || [200, { googleLinked: true, noticeVersion: "n1", consent: null, photoInUse: false }];
    return { ok: status < 400, status, json: async () => body };
  };
  const document = { readyState: "complete", getElementById: (id) => byId[id] || null, addEventListener() {} };
  vm.runInNewContext(source, { window, document, fetch, Object, JSON, String });
  return { byId, calls, setSession: (s) => { current = s; } };
}

test("the panel is wired into account.html and the consent box is never pre-ticked", () => {
  assert.match(html, /id="googlePhotoPanel"[^>]*hidden/);
  assert.match(html, /<input id="googlePhotoConsent" type="checkbox">/);
  assert.doesNotMatch(html, /id="googlePhotoConsent"[^>]*checked/);
  assert.match(html, /id="googlePhotoImport"[^>]*disabled/);
  assert.match(html, /js\/profile-google-photo\.js/);
  assert.doesNotMatch(source, /innerHTML|setInterval|setTimeout|localStorage|console\./);
});

test("an import needs a fresh tick and sends the provider token of the same signed-in session", async () => {
  const env = setup({ responses: { import: [200, { googleLinked: true, noticeVersion: "n1", consent: { decision: "granted" }, photoInUse: true, copyStored: true }] } });
  await flush();
  assert.equal(env.byId.googlePhotoPanel.hidden, false);
  assert.equal(env.byId.googlePhotoImport.disabled, true);
  env.byId.googlePhotoImport.fire("click");
  await flush();
  assert.equal(env.calls.filter((c) => c.method === "POST").length, 0, "no import without the tick");
  env.byId.googlePhotoConsent.checked = true;
  env.byId.googlePhotoConsent.fire("change");
  assert.equal(env.byId.googlePhotoImport.disabled, false);
  env.byId.googlePhotoImport.fire("click");
  await flush();
  const post = env.calls.find((c) => c.method === "POST");
  assert.deepEqual(post.body, { action: "import", consent: true, noticeVersion: "n1", providerToken: "provider" });
  assert.equal(post.headers.Authorization, "Bearer access");
  assert.equal(env.byId.googlePhotoConsent.checked, false, "the box is reset after every render");
  assert.equal(env.byId.googlePhotoWithdraw.hidden, false);
  assert.equal(env.byId.googlePhotoOffer.hidden, true);
});

test("without a provider token or for another account nothing is sent; Google reconnect is offered", async () => {
  const noToken = setup({ session: { access_token: "access", user: { id: USER } } });
  await flush();
  noToken.byId.googlePhotoConsent.checked = true;
  noToken.byId.googlePhotoImport.fire("click");
  await flush();
  assert.equal(noToken.calls.filter((c) => c.method === "POST").length, 0);
  assert.equal(noToken.byId.googlePhotoReconnect.hidden, false);
  noToken.byId.googlePhotoReconnect.fire("click");
  await flush();
  assert.ok(noToken.calls.some((c) => c.reconnect));

  const switched = setup();
  await flush();
  switched.setSession({ access_token: "other", provider_token: "other-provider", user: { id: "22222222-2222-4222-8222-222222222222" } });
  switched.byId.googlePhotoConsent.checked = true;
  switched.byId.googlePhotoImport.fire("click");
  await flush();
  assert.equal(switched.calls.filter((c) => c.method === "POST").length, 0, "a token of another account is never sent");
});

test("the panel stays hidden when the feature is off or the account has no Google identity; withdrawal needs confirmation", async () => {
  const dark = setup({ responses: { GET: [404, { error: "not_found" }] } });
  await flush();
  assert.equal(dark.byId.googlePhotoPanel.hidden, true);
  const noGoogle = setup({ responses: { GET: [200, { googleLinked: false, consent: null, photoInUse: false }] } });
  await flush();
  assert.equal(noGoogle.byId.googlePhotoPanel.hidden, true);

  const granted = { googleLinked: true, noticeVersion: "n1", consent: { decision: "granted" }, photoInUse: true, copyStored: true };
  const declined = setup({ confirm: false, responses: { GET: [200, granted] } });
  await flush();
  declined.byId.googlePhotoWithdraw.fire("click");
  await flush();
  assert.equal(declined.calls.filter((c) => c.method === "POST").length, 0);
  const confirmed = setup({ responses: { GET: [200, granted], withdraw: [200, { googleLinked: true, consent: { decision: "withdrawn" }, photoInUse: false }] } });
  await flush();
  confirmed.byId.googlePhotoWithdraw.fire("click");
  await flush();
  assert.deepEqual(confirmed.calls.find((c) => c.method === "POST").body, { action: "withdraw" });
  assert.equal(confirmed.byId.googlePhotoWithdraw.hidden, true);
});

test("WWW renders a photo only from our own avatar bucket", () => {
  const window = {};
  const document = { dispatchEvent() {} };
  const images = [];
  class Image { set src(value) { images.push(value); this.onload && this.onload(); } }
  vm.runInNewContext(clientSource, { window, document, Image, CustomEvent: class {}, Object, JSON, String, Promise });
  const good = "https://abc.supabase.co/storage/v1/object/public/profile-avatars/11111111-1111-4111-8111-111111111111.webp";
  const node = element("a");
  window.ProfileClient.applyAvatar(node, { avatar: { type: "uploaded", url: good } });
  assert.equal(node.style.backgroundImage, `url("${good}")`);
  for (const bad of ["https://lh3.googleusercontent.com/a/x", "https://abc.supabase.co/storage/v1/object/public/other/x.webp", "javascript:alert(1)"]) {
    const other = element("b");
    window.ProfileClient.applyAvatar(other, { displayName: "Ann Lee", avatar: { type: "uploaded", url: bad } });
    assert.equal(other.style.backgroundImage, undefined, bad);
    assert.equal(other.textContent, "AL");
  }
});

test("withdrawal stays available without a linked Google identity and a failed copy deletion is reported", async () => {
  const unlinked = setup({ responses: { GET: [200, { googleLinked: false, noticeVersion: "n1", consent: { decision: "granted" }, photoInUse: true, copyStored: true }],
    withdraw: [200, { googleLinked: false, consent: { decision: "withdrawn" }, photoInUse: false, copyStored: true, copyDeleted: false }] } });
  await flush();
  assert.equal(unlinked.byId.googlePhotoPanel.hidden, false);
  assert.equal(unlinked.byId.googlePhotoOffer.hidden, true, "no new import without a Google identity");
  assert.equal(unlinked.byId.googlePhotoWithdraw.hidden, false);
  unlinked.byId.googlePhotoWithdraw.fire("click");
  await flush();
  assert.match(unlinked.byId.googlePhotoState.textContent, /deleting our copy failed/);
  assert.equal(unlinked.byId.googlePhotoWithdraw.hidden, false, "the deletion can be retried");
});
