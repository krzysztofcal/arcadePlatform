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

const fakeJwt = (sub) => "h." + Buffer.from(JSON.stringify({ sub })).toString("base64url") + ".s";

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
    SupabaseAuth: { getCurrentUser: async () => { const user = auth.user; if (auth.holdUser) await auth.holdUser(); return user ? { id: user } : null; }, onAuthChange(listener) { auth.listener = listener; } },
    SupabaseAuthBridge: { getAccessToken: async () => { if (auth.beforeToken) await auth.beforeToken(); return auth.user ? fakeJwt(auth.user) : null; } },
    ArcadeApi: { url: (url) => "https://api.example" + url },
    I18N: { t: () => "" },
    ProfileClient: { getMe: async () => ({ handle: "own-handle-1" }) },
  };
  window.fetch = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null, auth: options.headers.Authorization });
    const next = responses.length ? responses.shift() : { status: 200, body: { blocks: [] } };
    if (typeof next.before === "function") await next.before();
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
  };
  const context = vm.createContext({ window, document, fetch: window.fetch, setTimeout, Promise, JSON, String, Array, Object, Number, encodeURIComponent, atob });
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
  assert.equal(calls[0].auth, "Bearer " + fakeJwt("00000000-0000-4000-8000-0000000000aa"));
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
  assert.equal((poker.match(/ugcBlocked\(/g) || []).length, 6, "no other code path consults blocks (no seat, turn or chips logic)");
});

test("gift badges received live from a player disappear once that player is blocked", async () => {
  const poker = await readFile(new URL("../poker/poker-v2.js", import.meta.url), "utf8");
  assert.match(poker, /\{ eventId: event\.eventId, giftKey: event\.giftKey, senderUserId: currentSeatOwnerUserId\(event\.senderSeatNo\) \|\| null \}/, "live gifts remember their sender");
  assert.match(poker, /: visibleGifts\(giftsBySeat\[seat\.seatNo\] \|\| \[\]\);/, "badges are filtered at render time");
  const helper = poker.match(/function visibleGifts\(gifts\)\{[\s\S]*?\n  \}/)[0];
  const blocked = new Set();
  const visibleGifts = vm.runInNewContext(`(function(){ function ugcBlocked(id){ return blocked.has(id); } ${helper} return visibleGifts; })()`, { blocked });
  const stored = [{ eventId: "e1", giftKey: "beer", senderUserId: OTHER }, { eventId: "e2", giftKey: "pizza", senderUserId: B }, { eventId: "e3", giftKey: "whisky" }];
  assert.deepEqual(visibleGifts(stored).map((g) => g.eventId), ["e1", "e2", "e3"]);
  blocked.add(OTHER);
  assert.deepEqual(visibleGifts(stored).map((g) => g.eventId), ["e2", "e3"], "the blocked sender's earlier gift is hidden; a snapshot gift without sender stays");
  blocked.delete(OTHER);
  assert.deepEqual(visibleGifts(stored).map((g) => g.eventId), ["e1", "e2", "e3"], "unblocking shows it again");
});

const A = "00000000-0000-4000-8000-0000000000aa";
const B = "00000000-0000-4000-8000-0000000000bb";
const OTHER = "00000000-0000-4000-8000-000000000002";

test("an account switch forgets the previous list at once, even if the new load fails", async () => {
  const env = setup({ responses: [{ status: 200, body: { blocks: [{ userId: OTHER }] } }, { status: 500, body: { error: "server_error" } }] });
  await flush();
  assert.equal(env.ugc.isBlocked(OTHER), true);
  env.auth.user = B;
  env.auth.listener();
  assert.equal(env.ugc.isBlocked(OTHER), false, "cleared synchronously, before any new response");
  await flush(); await flush();
  assert.equal(env.ugc.isBlocked(OTHER), false, "a failed load for B never restores A's list");
  assert.equal(env.section.hidden, true);
});

test("a dialog opened by one account is closed and sends nothing after a switch", async () => {
  const env = setup();
  await flush();
  env.ugc.tablePlayers("00000000-0000-4000-8000-0000000000f1", [{ userId: OTHER, displayName: "P" }]);
  env.calls.length = 0;
  const clicked = env.byId.pokerSafetyPlayers.querySelector(".ugc-actions__report").fire("click");
  await flush();
  const dialog = env.body.children.find((node) => node.tagName === "dialog");
  assert.ok(dialog && dialog.open);
  env.auth.user = B;
  env.auth.listener();
  await clicked;
  assert.equal(env.body.children.includes(dialog), false, "the switch closes A's dialog");
  await flush();
  assert.deepEqual(env.calls.filter((call) => call.method !== "GET"), [], "no report is sent as B");
});

test("profile controls hide when the feature turns out to be off", async () => {
  const env = setup({ responses: [{ status: 200, body: { blocks: [] } }, { status: 404, body: { error: "not_found" } }] });
  await flush();
  await env.ugc.profileRendered({ handle: "rough-wolf-1", displayName: "Rough Wolf" });
  assert.equal(env.byId.publicProfileSafety.hidden, false, "shown for another player's profile");
  await env.ugc.profileRendered({ handle: "own-handle-1", displayName: "Me" });
  assert.equal(env.byId.publicProfileSafety.hidden, true, "never on the own profile, while the feature is on");
  await env.ugc.profileRendered({ handle: "rough-wolf-1", displayName: "Rough Wolf" });
  assert.equal(env.byId.publicProfileSafety.hidden, false);
  await env.ugc.loadBlocks(true);
  assert.equal(env.byId.publicProfileSafety.hidden, true, "a later 404 hides them");
});

test("an account switch while the token is being fetched sends nothing (report, block, unblock)", async () => {
  for (const action of ["report", "block", "unblock"]) {
    const env = setup({ responses: [{ status: 200, body: { blocks: action === "unblock" ? [{ userId: OTHER }] : [] } }] });
    await flush();
    env.ugc.tablePlayers("00000000-0000-4000-8000-0000000000f1", [{ userId: OTHER, displayName: "P" }]);
    env.calls.length = 0;
    const container = env.byId.pokerSafetyPlayers;
    const button = container.querySelector(action === "report" ? ".ugc-actions__report" : ".ugc-actions__block");
    // The switch happens while the action's token is fetched (after the confirmation, if there is one).
    const switchDuringToken = () => { env.auth.beforeToken = async () => { env.auth.user = B; env.auth.beforeToken = null; env.auth.listener(); }; };
    if (action === "unblock") switchDuringToken();
    const clicked = button.fire("click");
    await flush();
    const dialog = env.body.children.find((node) => node.tagName === "dialog");
    if (dialog) { switchDuringToken(); await dialog.children[0].fire("submit"); }
    await clicked;
    await flush();
    assert.deepEqual(env.calls.filter((call) => call.method !== "GET"), [], `${action}: nothing is sent with B's token`);
  }
});

test("a session switch while the user is being read never restores the previous list", async () => {
  let release;
  let env;
  // The reload for A gets its answer; the user read that follows is held, the session switches to B, then A returns.
  let releaseB;
  const bGate = new Promise((resolve) => { releaseB = resolve; });
  env = setup({ responses: [{ status: 200, body: { blocks: [] } }, { status: 200, body: { blocks: [{ userId: OTHER }] }, before: async () => { env.auth.holdUser = () => new Promise((resolve) => { release = resolve; }); } }, { status: 200, body: { blocks: [] }, before: () => bGate }] });
  await flush();
  const pending = env.ugc.loadBlocks(true);
  for (let i = 0; i < 5 && !release; i += 1) await flush();
  assert.ok(release, "the post-response user read is pending");
  env.auth.holdUser = null;
  env.auth.user = B;
  env.auth.listener();
  release();
  await pending; await flush(); await flush();
  assert.equal(env.ugc.isBlocked(OTHER), false, "A's late answer is not applied while B's list is still loading");
  releaseB();
  await flush(); await flush();
  assert.equal(env.ugc.isBlocked(OTHER), false);
});

test("a late 'feature off' answer to the previous account's request never hides the new account's controls", async () => {
  let releaseA;
  const aGate = new Promise((resolve) => { releaseA = resolve; });
  const env = setup({ responses: [{ status: 200, body: { blocks: [] } }, { status: 404, body: { error: "not_found" }, before: () => aGate }, { status: 200, body: { blocks: [] } }] });
  await flush();
  assert.equal(env.section.hidden, false, "A: feature on");
  const pending = env.ugc.loadBlocks(true).catch(() => {});
  await flush();
  env.auth.user = B;
  env.auth.listener();
  await flush(); await flush();
  assert.equal(env.section.hidden, false, "B: loaded, feature on");
  releaseA();
  await pending; await flush(); await flush();
  assert.equal(env.section.hidden, false, "A's late 404 does not switch the feature off for B");
  assert.equal(env.calls.length, 3);
});
