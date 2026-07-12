import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const [comboSource, scoringSource, coreSource] = await Promise.all([
  fs.readFile(new URL("js/xp/combo.js", root), "utf8"),
  fs.readFile(new URL("js/xp/scoring.js", root), "utf8"),
  fs.readFile(new URL("js/xp/core.js", root), "utf8"),
]);

const storage = new Map([
  ["kcswh:xp:last", JSON.stringify({ totalLifetime: 300, serverTotalXp: 300, badgeShownXp: 300 })],
]);
const label = { textContent: "" };
const badge = {
  classList: { add() {}, remove() {}, toggle() {} },
  contains(node) { return node === label; },
  querySelector() { return label; },
  appendChild() {},
  addEventListener() {},
  setAttribute() {},
};
const body = { dataset: {}, hasAttribute() { return false; } };
const document = {
  body,
  readyState: "complete",
  visibilityState: "visible",
  hidden: false,
  activeElement: null,
  addEventListener() {},
  removeEventListener() {},
  querySelector() { return badge; },
  querySelectorAll() { return [badge]; },
  createElement() {
    return {
      className: "",
      textContent: "",
      appendChild() {},
      setAttribute() {},
      addEventListener() {},
      classList: { add() {}, remove() {}, toggle() {} },
    };
  },
};
const window = {
  document,
  localStorage: {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  },
  XpCombo: {},
  XpScoring: {},
  XPClient: {
    isAuthenticated: () => true,
    isInitialStatusPending: () => true,
    fetchStatus: async () => ({ ok: true, status: "statusOnly", totalLifetime: 0 }),
  },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  setTimeout,
  clearTimeout,
  location: { pathname: "/xp.html", search: "" },
  console: { debug() {}, warn() {}, error() {} },
};
const context = {
  window,
  document,
  console: window.console,
  setTimeout,
  clearTimeout,
  Date,
  navigator: { userAgent: "" },
  location: window.location,
  CustomEvent: class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  },
};

vm.createContext(context);
vm.runInContext(comboSource, context, { filename: "combo.js" });
vm.runInContext(scoringSource, context, { filename: "scoring.js" });
vm.runInContext(coreSource, context, { filename: "core.js" });
window.XpCore.boot(window, document);
window.XP.refreshFromServerStatus(
  { ok: true, status: "statusOnly", totalLifetime: 0 },
  { source: "status", allowServerRegression: true },
);

const cache = JSON.parse(storage.get("kcswh:xp:last"));
assert.equal(label.textContent, "Lvl 1, 0 XP");
assert.equal(window.XP.getSnapshot().totalXp, 0);
assert.equal(cache.totalLifetime, 0);
assert.equal(cache.serverTotalXp, 0);
assert.equal(cache.badgeShownXp, 0);

window.XPClient.isAuthenticated = () => false;
window.XP.refreshFromServerStatus(
  { ok: true, status: "statusOnly", totalLifetime: 120, totalToday: 120, cap: 3000 },
  { source: "status" },
);
const guestCache = JSON.parse(storage.get("kcswh:xp:last"));
assert.equal(label.textContent, "Lvl 2, 120 XP");
assert.equal(window.XP.getSnapshot().totalXp, 120);
assert.equal(guestCache.totalLifetime, 120);
assert.equal(guestCache.serverTotalXp, 120);

console.log("xp core authoritative reset tests passed");
