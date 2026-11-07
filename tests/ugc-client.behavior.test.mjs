import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// #1140 UGC phase B client: request shapes, the per-device block filter, hidden UI when off, text-only names.
const source = await readFile(new URL("../js/ugc-client.js", import.meta.url), "utf8");

class Node {
  constructor(tag, text = "") { this.tagName = tag; this.children = []; this.parentNode = null; this.text = text; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.checked = false; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.children.forEach((child) => { child.parentNode = null; }); this.children = []; this.text = String(value); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === "open") this.open = true; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  async fire(type, event = {}) { for (const listener of this.listeners[type] || []) await listener({ preventDefault() {}, ...event }); }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  querySelector(selector) {
    if (selector.startsWith(".")) return this.all().find((node) => String(node.className).split(" ").includes(selector.slice(1))) || null;
    if (selector === 'input[name="ugcReason"]:checked') return this.all().find((node) => node.name === "ugcReason" && node.checked) || null;
    throw new Error(`selector ${selector}`);
  }
  querySelectorAll(selector) { return this.all().filter((node) => selector === "input" ? node.tagName === "input" : String(node.className).split(" ").includes(selector.slice(1))); }
  closest(selector) { for (let node = this; node; node = node.parentNode) if (selector === "[data-ugc-section]" && "ugcSection" in node.dataset) return node; return null; }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function setup({ user = "00000000-0000-4000-8000-0000000000aa", responses = [], elements = ["pokerSafetyPlayers", "publicProfileSafety"] } = {}) {
  const byId = {};
  const body = new Node("body");
  const section = new Node("section"); section.dataset.ugcSection = ""; body.appendChild(section);
  const blockedList = section.appendChild(new Node("div")); byId.ugcBlockedList = blockedList;
  for (const id of elements) byId[id] = body.appendChild(new Node("div"));
  const calls = [];
  const auth = { user };
  const document = { readyState: "complete", body, getElementById: (id) => byId[id] || null, createElement: (tag) => new Node(tag), createTextNode: (text) => new Node("#text", text), addEventListener() {} };
  const window = {
    document,
    SupabaseAuth: { getCurrentUser: async () => (auth.user ? { id: auth.user } : null), onAuthChange() {} },
    SupabaseAuthBridge: { getAccessToken: async () => (auth.user ? "token-" + auth.user : null) },
    ArcadeApi: { url: (url) => "https://api.example" + url },
    I18N: { t: () => "" },
  };
  window.fetch = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null, auth: options.headers.Authorization });
    const next = responses.length ? responses.shift() : { status: 200, body: { blocks: [] } };
    if (typeof next.before === "function") await next.before();
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
  };
  const context = vm.createContext({ window, document, fetch: window.fetch, setTimeout, Promise, JSON, String, Array, Object, Number, encodeURIComponent });
  vm.runInContext(source, context);
  return { ugc: window.ArcadeUgc, calls, byId, body, section, auth };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("loads the caller's blocks once with the bearer token and filters ids case-insensitively", async () => {
  const blocked = "ABCDEF00-0000-4000-8000-000000000001";
  const { ugc, calls } = setup({ responses: [{ status: 200, body: { blocks: [{ userId: blocked.toLowerCase(), handle: "rough-wolf-1", displayName: "Rough Wolf" }] } }] });
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example/.netlify/functions/user-blocks");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].auth, "Bearer token-00000000-0000-4000-8000-0000000000aa");
  assert.equal(ugc.isBlocked(blocked), true);
  assert.equal(ugc.isBlocked("00000000-0000-4000-8000-000000000999"), false);
  await ugc.loadBlocks(false);
  assert.equal(calls.length, 1, "cached for the same user");
});

test("report and block send exactly the server contract, and a block reloads the list", async () => {
  const { ugc, calls } = setup();
  await flush();
  calls.length = 0;
  await ugc.report({ handle: "rough-wolf-1", context: "profile", displayName: "x" }, "spam");
  await ugc.report({ userId: "00000000-0000-4000-8000-000000000002", context: "table", tableId: "00000000-0000-4000-8000-0000000000f1" }, "cheating");
  await ugc.block({ userId: "00000000-0000-4000-8000-000000000002" });
  await ugc.unblock("00000000-0000-4000-8000-000000000002");
  assert.deepEqual(calls.map((call) => [call.method, call.url.replace("https://api.example/.netlify/functions/", ""), call.body]), [
    ["POST", "ugc-report", { targetHandle: "rough-wolf-1", reason: "spam", context: "profile" }],
    ["POST", "ugc-report", { targetUserId: "00000000-0000-4000-8000-000000000002", reason: "cheating", context: "table", tableId: "00000000-0000-4000-8000-0000000000f1" }],
    ["POST", "user-blocks", { targetUserId: "00000000-0000-4000-8000-000000000002" }],
    ["GET", "user-blocks", null],
    ["DELETE", "user-blocks?userId=00000000-0000-4000-8000-000000000002", null],
    ["GET", "user-blocks", null],
  ]);
});

test("the UI stays hidden for guests and while the endpoints are off", async () => {
  const guest = setup({ user: null });
  await flush();
  assert.equal(guest.calls.length, 0, "a guest makes no request");
  guest.ugc.tablePlayers("00000000-0000-4000-8000-0000000000f1", [{ userId: "00000000-0000-4000-8000-000000000002", displayName: "P" }]);
  assert.equal(guest.byId.pokerSafetyPlayers.hidden, true);
  assert.equal(guest.section.hidden, true);
  const off = setup({ responses: [{ status: 404, body: { error: "not_found" } }] });
  await flush();
  off.ugc.tablePlayers("00000000-0000-4000-8000-0000000000f1", [{ userId: "00000000-0000-4000-8000-000000000002", displayName: "P" }]);
  assert.equal(off.byId.pokerSafetyPlayers.hidden, true, "feature off: no table controls");
  assert.equal(off.section.hidden, true, "feature off: no blocked list");
});

test("an account switch during loading never applies the previous user's blocks", async () => {
  let env;
  env = setup({ responses: [{ status: 200, body: { blocks: [{ userId: "00000000-0000-4000-8000-000000000002" }] }, before: async () => { env.auth.user = "00000000-0000-4000-8000-0000000000bb"; } }] });
  await flush(); await flush();
  assert.equal(env.ugc.isBlocked("00000000-0000-4000-8000-000000000002"), false);
});

test("table controls list human opponents as text and report through the reason dialog", async () => {
  const { ugc, calls, byId, body } = setup();
  await flush();
  const name = '<img src=x onerror="alert(1)">';
  ugc.tablePlayers("00000000-0000-4000-8000-0000000000f1", [
    { userId: "00000000-0000-4000-8000-000000000002", displayName: name },
    { userId: "00000000-0000-4000-8000-000000000003", displayName: "Bot", isBot: true },
  ]);
  const container = byId.pokerSafetyPlayers;
  assert.equal(container.hidden, false);
  const names = container.all().filter((node) => node.className === "ugc-table__name");
  assert.deepEqual(names.map((node) => node.textContent), [name], "one human row, the name kept as plain text");
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/);
  calls.length = 0;
  const reportButton = container.querySelector(".ugc-actions__report");
  const clicked = reportButton.fire("click");
  await flush();
  const dialog = body.children.find((node) => node.tagName === "dialog");
  assert.ok(dialog && dialog.open, "the reason dialog opens");
  assert.equal(dialog.querySelectorAll("input").length, 6, "six fixed reasons");
  await dialog.children[0].fire("submit");
  await clicked;
  assert.deepEqual(calls[0].body, { targetUserId: "00000000-0000-4000-8000-000000000002", reason: "inappropriate_avatar", context: "table", tableId: "00000000-0000-4000-8000-0000000000f1" });
  assert.equal(body.children.includes(dialog), false, "the dialog is removed");
});

test("poker table filters only presentation of blocked players", async () => {
  const poker = await readFile(new URL("../poker/poker-v2.js", import.meta.url), "utf8");
  assert.match(poker, /if \(ugcBlocked\(ownerUserId\)\) return;/, "reactions of a blocked sender are not shown");
  assert.match(poker, /if \(ugcBlocked\(currentSeatOwnerUserId\(event\.senderSeatNo\)\)\) return;/, "live gifts of a blocked sender are not shown");
  assert.match(poker, /if \(ugcBlocked\(seat\.userId\)\) return 'blocked';/, "the avatar source changes so a shown avatar is replaced");
  assert.match(poker, /var profileAvatar = !seat\.isBot && !ugcBlocked\(seat\.userId\) && seat\.profile && seat\.profile\.avatar;/);
  assert.equal((poker.match(/ugcBlocked\(/g) || []).length, 5, "no other code path consults blocks (no seat, turn or chips logic)");
});
