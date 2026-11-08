import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

// #1140 UGC phase C: the admin "Reports" tab, against a minimal DOM.
const source = await readFile(new URL("../js/admin-ugc-reports.js", import.meta.url), "utf8");
const html = await readFile(new URL("../admin.html", import.meta.url), "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));

function element(tag, id) {
  const node = {
    tagName: tag.toUpperCase(), id, className: "", hidden: false, disabled: false, value: "", type: "", childNodes: [], listeners: {}, _text: "",
    get textContent() { return this._text + this.childNodes.map((c) => c.textContent).join(""); },
    set textContent(value) { this._text = String(value); this.childNodes = []; },
    get firstChild() { return this.childNodes[0] || null; },
    appendChild(child) { this.childNodes.push(child); return child; },
    removeChild(child) { this.childNodes = this.childNodes.filter((c) => c !== child); return child; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    fire(type) { (this.listeners[type] || []).forEach((fn) => fn({ target: this })); },
    set innerHTML(_value) { throw new Error("innerHTML must not be used"); },
  };
  return node;
}

function all(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  node.childNodes.forEach((c) => all(c, predicate, out));
  return out;
}

function setup({ confirm = true } = {}) {
  const ids = ["adminUgcPendingCount", "adminUgcReportsMessage", "adminUgcReportsList", "adminUgcReportsMore", "adminUgcReportsStatus", "adminUgcReportsRefresh", "adminUgcReportsRemoved"];
  const byId = Object.fromEntries(ids.map((id) => [id, element("div", id)]));
  byId.adminUgcReportsStatus.value = "pending";
  const document = { getElementById: (id) => byId[id] || null, createElement: (tag) => element(tag) };
  const window = { confirm: () => confirm };
  vm.runInNewContext(source, { window, document, Number, Date, Array, String, encodeURIComponent, JSON });
  const calls = [];
  let responder = async () => ({ pendingCount: 0, reports: [], next: null });
  const apiFetch = (path, options) => { calls.push({ path, options }); return responder(path, options); };
  window.AdminUgcReports.attach({ apiFetch });
  return { api: window.AdminUgcReports, byId, calls, respond: (fn) => { responder = fn; } };
}

const sample = (over = {}) => ({
  id: "7", createdAt: "2026-11-07T10:00:00.000Z", reason: "inappropriate_name", context: "table", tableId: "t-1", status: "pending", resolution: null, resolvedAt: null,
  evidence: { handle: "bad", displayName: "<img src=x onerror=alert(1)>", avatarKey: null },
  target: { userId: "u-1", handle: "bad", displayName: "<b>now</b>", hasUploadedAvatar: true, avatarHeld: false, openReports: 2 }, ...over,
});

test("the tab is wired into admin.html and the module never polls or renders HTML", () => {
  assert.match(html, /data-admin-tab="ugcReports"/);
  assert.match(html, /data-admin-panel="ugcReports"/);
  assert.match(html, /id="adminUgcPendingCount"[^>]*hidden/);
  assert.match(html, /id="adminUgcReportsRemoved"[^>]*hidden/);
  assert.ok(html.indexOf("js/admin-ugc-reports.js") < html.indexOf("js/admin-page.js"), "loaded before admin-page.js");
  assert.doesNotMatch(source, /setInterval|setTimeout|innerHTML|insertAdjacentHTML|console\./);
});

test("the counter comes from one read when the panel opens and player text stays text", async () => {
  const env = setup();
  env.respond(async () => ({ pendingCount: 3, reports: [], next: null }));
  await env.api.refreshCount();
  assert.equal(env.calls[0].path, "/.netlify/functions/admin-ugc-reports?status=pending&limit=1");
  assert.deepEqual([env.byId.adminUgcPendingCount.hidden, env.byId.adminUgcPendingCount.textContent], [false, "3"]);
  env.respond(async () => ({ pendingCount: 140, reports: [sample()], next: null }));
  await env.api.load();
  assert.equal(env.byId.adminUgcPendingCount.textContent, "99+");
  const text = env.byId.adminUgcReportsList.textContent;
  assert.match(text, /<img src=x onerror=alert\(1\)> \(@bad\)/);
  assert.match(text, /open reports: 2/);
  assert.equal(all(env.byId.adminUgcReportsList, (n) => n.tagName === "BUTTON").length, 4);
  env.respond(async () => ({ pendingCount: 0, reports: [], next: null }));
  await env.api.load();
  assert.equal(env.byId.adminUgcPendingCount.hidden, true, "no badge without pending reports");
  assert.equal(env.byId.adminUgcReportsMessage.textContent, "No reports with this status.");
});

test("a decision asks for confirmation, posts once and re-reads the queue", async () => {
  const env = setup();
  env.respond(async (path, options) => (options.method === "POST" ? { reportId: "7", status: "dismissed", action: "none" } : { pendingCount: 1, reports: [sample()], next: null }));
  await env.api.load();
  const dismiss = all(env.byId.adminUgcReportsList, (n) => n.tagName === "BUTTON" && n.textContent === "Dismiss")[0];
  dismiss.fire("click");
  dismiss.fire("click");
  await flush(); await flush();
  const posts = env.calls.filter((c) => c.options.method === "POST");
  assert.equal(posts.length, 1, "a double click sends one decision");
  assert.deepEqual(JSON.parse(posts[0].options.body), { reportId: "7", decision: "dismissed" });
  assert.equal(env.calls.at(-1).options.method, "GET", "the queue is read again after the decision");

  const declined = setup({ confirm: false });
  declined.respond(async () => ({ pendingCount: 1, reports: [sample()], next: null }));
  await declined.api.load();
  all(declined.byId.adminUgcReportsList, (n) => n.textContent === "Hide avatar" && n.tagName === "BUTTON")[0].fire("click");
  await flush();
  assert.equal(declined.calls.filter((c) => c.options.method === "POST").length, 0, "no decision without confirmation");
});

test("a conflict is explained, a dark environment hides the badge and stale responses are ignored", async () => {
  const env = setup();
  env.respond(async (path, options) => {
    if (options.method === "POST") throw Object.assign(new Error("x"), { code: "report_already_decided", status: 409 });
    return { pendingCount: 1, reports: [sample()], next: null };
  });
  await env.api.load();
  all(env.byId.adminUgcReportsList, (n) => n.textContent === "Resolve, no action" && n.tagName === "BUTTON")[0].fire("click");
  await flush(); await flush();
  assert.match(env.byId.adminUgcReportsMessage.textContent, /already decided/);

  const dark = setup();
  dark.respond(async () => { throw Object.assign(new Error("x"), { code: "not_found", status: 404 }); });
  await dark.api.load();
  assert.equal(dark.byId.adminUgcPendingCount.hidden, true);
  assert.match(dark.byId.adminUgcReportsMessage.textContent, /not enabled/);

  const race = setup();
  let release;
  race.respond(() => new Promise((resolve) => { release = resolve; }));
  const slow = race.api.load();
  const first = release;
  race.respond(async () => ({ pendingCount: 0, reports: [], next: null }));
  await race.api.load();
  first({ pendingCount: 5, reports: [sample()], next: null });
  await slow;
  assert.equal(race.byId.adminUgcReportsList.childNodes.length, 0, "an older response does not overwrite a newer one");

  const restricted = setup();
  restricted.respond(async () => ({ pendingCount: 0, reports: [sample({ status: "resolved", resolution: "profile_restricted", resolvedAt: "2026-11-07T11:00:00.000Z" })], next: null }));
  await restricted.api.load();
  const buttons = all(restricted.byId.adminUgcReportsList, (n) => n.tagName === "BUTTON").map((n) => n.textContent);
  assert.deepEqual(buttons, ["Restore profile"]);
});

test("the removed-with-deleted-account total is shown as reported by the server and hidden when unknown", async () => {
  const env = setup();
  env.respond(async () => ({ pendingCount: 1, removedWithDeletedAccount: 0, reports: [], next: null }));
  await env.api.refreshCount();
  assert.deepEqual([env.byId.adminUgcReportsRemoved.hidden, env.byId.adminUgcReportsRemoved.textContent], [false, "Pending reports removed because the reported account was deleted: 0"]);
  env.respond(async () => ({ pendingCount: 1, removedWithDeletedAccount: 4, reports: [sample()], next: null }));
  await env.api.load();
  assert.equal(env.byId.adminUgcReportsRemoved.textContent, "Pending reports removed because the reported account was deleted: 4");
  env.respond(async (path, options) => {
    if (options.method === "POST") throw Object.assign(new Error("x"), { code: "account_deleting", status: 409 });
    return { pendingCount: 1, removedWithDeletedAccount: 4, reports: [sample()], next: null };
  });
  all(env.byId.adminUgcReportsList, (n) => n.textContent === "Hide avatar" && n.tagName === "BUTTON")[0].fire("click");
  await flush(); await flush();
  assert.match(env.byId.adminUgcReportsMessage.textContent, /account is being deleted/);
  env.respond(async () => { throw Object.assign(new Error("x"), { code: "server_error", status: 500 }); });
  await env.api.load();
  assert.equal(env.byId.adminUgcReportsRemoved.hidden, true, "no stale total after a failed read");
  env.api.reset();
  assert.equal(env.byId.adminUgcReportsRemoved.textContent, "");
});
