import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");
const source = await readFile(path.join(repoRoot, "js", "account-page.js"), "utf8");
const portalCss = await readFile(path.join(repoRoot, "css", "portal.css"), "utf8");

const flush = () => new Promise(resolve => setImmediate(resolve));

function createElement(tagName, id, isFragment = false) {
  const listeners = new Map();
  const node = {
    tagName: String(tagName || "").toUpperCase(),
    id: id || null,
    className: "",
    children: [],
    parentNode: null,
    textContent: "",
    hidden: false,
    dataset: {},
    style: {},
    scrollTop: 0,
    clientHeight: 320,
    isFragment,
    appendChild(child) {
      if (child && child.isFragment && Array.isArray(child.children)) {
        child.children.forEach(fragmentChild => {
          fragmentChild.parentNode = node;
          node.children.push(fragmentChild);
        });
        return child;
      }
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    dispatchEvent(event) {
      const list = listeners.get(event?.type) || [];
      list.forEach(handler => handler(event));
    },
    focus() {},
  };
  Object.defineProperty(node, "innerHTML", {
    get() {
      return "";
    },
    set(value) {
      if (value === "") node.children.length = 0;
    },
  });
  return node;
}

function createDocument() {
  const nodes = new Map();
  const document = {
    readyState: "complete",
    getElementById(id) {
      return nodes.get(id) || null;
    },
    createElement(tag) {
      return createElement(tag);
    },
    createDocumentFragment() {
      return createElement("#fragment", null, true);
    },
    addEventListener() {},
    dispatchEvent() {},
  };
  document.__nodes = nodes;
  return document;
}

function seedNodes(document) {
  const ids = [
    "accountStatus",
    "authForms",
    "accountPanel",
    "accountEmail",
    "accountName",
    "signOutButton",
    "deleteAccountButton",
    "deleteAccountNote",
    "signinForm",
    "signupForm",
    "signinEmail",
    "signinPassword",
    "signupEmail",
    "signupPassword",
    "chipPanel",
    "chipStatus",
    "chipBalanceValue",
    "chipLedgerScroll",
    "chipLedgerSpacer",
    "chipLedgerList",
    "chipLedgerEmpty",
  ];
  ids.forEach(id => {
    document.__nodes.set(id, createElement("div", id));
  });
}

function buildContext(chipsClient) {
  const document = createDocument();
  seedNodes(document);
  const logs = [];
  const windowObj = {
    document,
    addEventListener() {},
    requestAnimationFrame(cb) {
      cb();
    },
    KLog: {
      log(kind, data) {
        logs.push({ kind, data });
      },
    },
    SupabaseAuth: {
      getCurrentUser() {
        return Promise.resolve({ user_metadata: { name: "Tester" }, email: "tester@example.com" });
      },
      onAuthChange() {},
    },
    ChipsClient: chipsClient,
  };
  return { windowObj, document, logs };
}

function findByClass(node, className) {
  if (!node) return null;
  if (node.className === className) return node;
  for (const child of node.children || []) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

function findByClassToken(node, className) {
  if (!node) return null;
  if (typeof node.className === "string" && node.className.split(" ").includes(className)) {
    return node;
  }
  for (const child of node.children || []) {
    const found = findByClassToken(child, className);
    if (found) return found;
  }
  return null;
}

test("renders formatted chip ledger dates", async () => {
  const chipsClient = {
    fetchBalance() {
      return Promise.resolve({ balance: 1200 });
    },
    fetchLedger() {
      return Promise.resolve({
        items: [
          {
            id: 9,
            tx_type: "BUY_IN",
            amount: 25,
            display_created_at: "2026-02-06T19:15:23.123Z",
            sort_id: "9",
          },
        ],
        nextCursor: null,
      });
    },
  };
  const { windowObj, document } = buildContext(chipsClient);
  const context = vm.createContext({
    window: windowObj,
    document,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    CustomEvent: function() {},
  });
  vm.runInContext(source, context);

  await flush();
  await flush();
  await flush();

  const list = document.getElementById("chipLedgerList");
  assert.ok(list.children.length > 0, "ledger should render at least one row");
  const timeNode = findByClass(list.children[0], "chip-ledger__time");
  assert.ok(timeNode, "time element should be present");
  assert.match(timeNode.textContent, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.notEqual(timeNode.textContent, "", "time element should not be empty");
});

test("renders display_created_at when present", async () => {
  const chipsClient = {
    fetchBalance() {
      return Promise.resolve({ balance: 1200 });
    },
    fetchLedger() {
      return Promise.resolve({
        items: [
          {
            id: 10,
            tx_type: "BUY_IN",
            amount: 50,
            display_created_at: "2026-02-06T20:45:11.000Z",
            sort_id: "10",
          },
        ],
        nextCursor: null,
      });
    },
  };
  const { windowObj, document } = buildContext(chipsClient);
  const context = vm.createContext({
    window: windowObj,
    document,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    CustomEvent: function() {},
  });
  vm.runInContext(source, context);

  await flush();
  await flush();
  await flush();

  const list = document.getElementById("chipLedgerList");
  const timeNode = findByClass(list.children[0], "chip-ledger__time");
  assert.ok(timeNode, "time element should be present");
  assert.match(timeNode.textContent, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("renders ledger when API returns entries instead of items", async () => {
  const chipsClient = {
    fetchBalance() {
      return Promise.resolve({ balance: 1200 });
    },
    fetchLedger() {
      return Promise.resolve({
        entries: [
          {
            id: 9,
            tx_type: "BUY_IN",
            amount: 25,
            display_created_at: "2026-02-06T19:15:23.123Z",
            sort_id: "9",
          },
        ],
        nextCursor: null,
      });
    },
  };
  const { windowObj, document } = buildContext(chipsClient);
  const context = vm.createContext({
    window: windowObj,
    document,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    CustomEvent: function() {},
  });
  vm.runInContext(source, context);

  await flush();
  await flush();
  await flush();

  const list = document.getElementById("chipLedgerList");
  assert.ok(list.children.length > 0, "ledger should render at least one row");
  const timeNode = findByClass(list.children[0], "chip-ledger__time");
  assert.ok(timeNode, "time element should be present");
  assert.match(timeNode.textContent, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("falls back to created_at when display_created_at is missing", async () => {
  const chipsClient = {
    fetchBalance() {
      return Promise.resolve({ balance: 1200 });
    },
    fetchLedger() {
      return Promise.resolve({
        items: [
          {
            id: 12,
            tx_type: "BUY_IN",
            amount: 50,
            created_at: "2026-02-06T20:45:11.000Z",
            sort_id: "12",
          },
        ],
        nextCursor: null,
      });
    },
  };
  const { windowObj, document } = buildContext(chipsClient);
  const context = vm.createContext({
    window: windowObj,
    document,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    CustomEvent: function() {},
  });
  vm.runInContext(source, context);

  await flush();
  await flush();
  await flush();

  const list = document.getElementById("chipLedgerList");
  const timeNode = findByClass(list.children[0], "chip-ledger__time");
  assert.ok(timeNode, "time element should be present");
  assert.match(timeNode.textContent, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("falls back to tx_created_at when display_created_at is missing", async () => {
  const chipsClient = {
    fetchBalance() {
      return Promise.resolve({ balance: 1200 });
    },
    fetchLedger() {
      return Promise.resolve({
        items: [
          {
            id: 13,
            tx_type: "BUY_IN",
            amount: 50,
            tx_created_at: "2026-02-06T20:45:11.000Z",
            sort_id: "13",
          },
        ],
        nextCursor: null,
      });
    },
  };
  const { windowObj, document } = buildContext(chipsClient);
  const context = vm.createContext({
    window: windowObj,
    document,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    CustomEvent: function() {},
  });
  vm.runInContext(source, context);

  await flush();
  await flush();
  await flush();

  const list = document.getElementById("chipLedgerList");
  const timeNode = findByClass(list.children[0], "chip-ledger__time");
  assert.ok(timeNode, "time element should be present");
  assert.match(timeNode.textContent, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("renders placeholder when no valid timestamp exists", async () => {
  const chipsClient = {
    fetchBalance() {
      return Promise.resolve({ balance: 1200 });
    },
    fetchLedger() {
      return Promise.resolve({
        items: [
          {
            id: 11,
            tx_type: "CASH_OUT",
            amount: -20,
            display_created_at: null,
            sort_id: "11",
          },
        ],
        nextCursor: null,
      });
    },
  };
  const { windowObj, document, logs } = buildContext(chipsClient);
  const context = vm.createContext({
    window: windowObj,
    document,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    CustomEvent: function() {},
  });
  vm.runInContext(source, context);

  await flush();
  await flush();
  await flush();

  const list = document.getElementById("chipLedgerList");
  const timeNode = findByClass(list.children[0], "chip-ledger__time");
  assert.ok(timeNode, "time element should be present");
  assert.equal(timeNode.textContent, "—");
  assert.ok(logs.some(entry => entry.kind === "chips:ledger_invalid_display_timestamp"));
});

test("loads more ledger entries on scroll", async () => {
  const calls = [];
  const firstPage = Array.from({ length: 10 }, (_value, index) => ({
    id: index + 1,
    entry_seq: index + 1,
    tx_type: "BUY_IN",
    amount: 1,
    display_created_at: "2026-02-06T19:00:00.000Z",
    sort_id: String(100 + index),
  }));
  const chipsClient = {
    fetchBalance() {
      return Promise.resolve({ balance: 1200 });
    },
    fetchLedger(options) {
      calls.push(options);
      if (!options || !options.cursor) {
        return Promise.resolve({ items: firstPage, nextCursor: "cursor-1" });
      }
      return Promise.resolve({
        items: [
          {
            id: 99,
            entry_seq: 99,
            tx_type: "CASH_OUT",
            amount: -5,
            display_created_at: "2026-02-05T18:40:00.000Z",
            sort_id: "200",
          },
        ],
        nextCursor: null,
      });
    },
  };
  const { windowObj, document } = buildContext(chipsClient);
  const context = vm.createContext({
    window: windowObj,
    document,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    CustomEvent: function() {},
  });
  vm.runInContext(source, context);

  await flush();
  await flush();
  await flush();

  const scroll = document.getElementById("chipLedgerScroll");
  scroll.clientHeight = 200;
  scroll.scrollTop = 400;
  scroll.dispatchEvent({ type: "scroll" });

  await flush();
  await flush();
  await flush();

  assert.equal(calls.length, 2, "fetchLedger should be called twice");
  assert.equal(calls[0] && calls[0].after, undefined, "first page should not use legacy after");
  assert.equal(calls[1].cursor, "cursor-1", "second page should include cursor");
  const spacer = document.getElementById("chipLedgerSpacer");
  assert.ok(Number.parseInt(spacer.style.height, 10) > firstPage.length * 80, "spacer height should grow");
});

test("shows error tail row and retries on scroll", async () => {
  const realNow = Date.now;
  let now = 0;
  Date.now = () => now;
  const calls = [];
  const firstPage = Array.from({ length: 3 }, (_value, index) => ({
    id: index + 1,
    entry_seq: index + 1,
    tx_type: "BUY_IN",
    amount: 1,
    display_created_at: "2026-02-06T19:00:00.000Z",
    sort_id: String(300 + index),
  }));
  const chipsClient = {
    fetchBalance() {
      return Promise.resolve({ balance: 1200 });
    },
    fetchLedger(options) {
      calls.push(options);
      if (calls.length === 1) {
        return Promise.resolve({ items: firstPage, nextCursor: "cursor-1" });
      }
      if (calls.length === 2) {
        return Promise.reject(new Error("network_error"));
      }
      return Promise.resolve({
        items: [
          {
            id: 99,
            entry_seq: 99,
            tx_type: "CASH_OUT",
            amount: -5,
            display_created_at: "2026-02-05T18:40:00.000Z",
            sort_id: "400",
          },
        ],
        nextCursor: null,
      });
    },
  };
  const { windowObj, document } = buildContext(chipsClient);
  const context = vm.createContext({
    window: windowObj,
    document,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    CustomEvent: function() {},
  });
  vm.runInContext(source, context);

  await flush();
  await flush();
  await flush();

  const scroll = document.getElementById("chipLedgerScroll");
  scroll.clientHeight = 200;
  scroll.scrollTop = 400;
  scroll.dispatchEvent({ type: "scroll" });

  await flush();
  await flush();
  await flush();

  const list = document.getElementById("chipLedgerList");
  const errorRow = findByClassToken(list, "chip-ledger__item--status");
  assert.ok(errorRow, "error status row should render");
  assert.match(errorRow.textContent, /Could not load more activity/i);

  now = 1000;
  errorRow.dispatchEvent({ type: "click" });

  await flush();
  await flush();
  await flush();

  const newErrorRow = findByClassToken(list, "chip-ledger__item--status");
  assert.ok(!newErrorRow || !/Could not load more activity/i.test(newErrorRow.textContent), "error row should clear");
  assert.ok(calls.length >= 3, "fetchLedger should retry after error");
  assert.equal(calls[0] && calls[0].after, undefined, "should not use legacy after");
  Date.now = realNow;
});

test("dedupes overlapping items by created_at and entry_seq", async () => {
  const calls = [];
  const firstPage = [
    { id: 1, entry_seq: 10, tx_type: "BUY_IN", amount: 1, display_created_at: "2026-02-06T19:00:00.000Z", sort_id: "500" },
    { id: 2, entry_seq: 9, tx_type: "BUY_IN", amount: 1, display_created_at: "2026-02-06T18:59:00.000Z", sort_id: "499" },
  ];
  const chipsClient = {
    fetchBalance() {
      return Promise.resolve({ balance: 1200 });
    },
    fetchLedger(options) {
      calls.push(options);
      if (!options || !options.cursor) {
        return Promise.resolve({ items: firstPage, nextCursor: "cursor-1" });
      }
      return Promise.resolve({
        items: [
          { id: 2, entry_seq: 9, tx_type: "BUY_IN", amount: 1, display_created_at: "2026-02-06T18:59:00.000Z", sort_id: "499" },
          { id: 3, entry_seq: 8, tx_type: "BUY_IN", amount: 1, display_created_at: "2026-02-06T18:58:00.000Z", sort_id: "498" },
        ],
        nextCursor: null,
      });
    },
  };
  const { windowObj, document } = buildContext(chipsClient);
  const context = vm.createContext({
    window: windowObj,
    document,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    CustomEvent: function() {},
  });
  vm.runInContext(source, context);

  await flush();
  await flush();
  await flush();

  const scroll = document.getElementById("chipLedgerScroll");
  scroll.clientHeight = 200;
  scroll.scrollTop = 400;
  scroll.dispatchEvent({ type: "scroll" });

  await flush();
  await flush();
  await flush();

  const spacer = document.getElementById("chipLedgerSpacer");
  assert.equal(Number.parseInt(spacer.style.height, 10), 4 * 80, "spacer height should match unique items");
  assert.equal(calls.length, 2, "should fetch two pages");
  assert.equal(calls[0] && calls[0].after, undefined, "should not use legacy after");
});

test("sorts by display_created_at then sort_id", async () => {
  const chipsClient = {
    fetchBalance() {
      return Promise.resolve({ balance: 1200 });
    },
    fetchLedger() {
      return Promise.resolve({
        items: [
          { id: 1, entry_seq: 1, tx_type: "BUY_IN", amount: 1, description: "Row 10", display_created_at: "2026-02-06T19:00:00.000Z", sort_id: "10" },
          { id: 2, entry_seq: 2, tx_type: "BUY_IN", amount: 1, description: "Row 12", display_created_at: "2026-02-06T19:00:00.000Z", sort_id: "12" },
        ],
        nextCursor: null,
      });
    },
  };
  const { windowObj, document } = buildContext(chipsClient);
  const context = vm.createContext({
    window: windowObj,
    document,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    CustomEvent: function() {},
  });
  vm.runInContext(source, context);

  await flush();
  await flush();
  await flush();

  const spacer = document.getElementById("chipLedgerSpacer");
  assert.ok(
    Number.parseInt(spacer.style.height, 10) >= 2 * 80,
    "spacer height should cover at least all items",
  );
  const list = document.getElementById("chipLedgerList");
  assert.ok(list.children.length > 0, "ledger should render rows");
  var rowHigh = null;
  var rowLow = null;
  for (var i = 0; i < list.children.length; i += 1) {
    var descNode = findByClass(list.children[i], "chip-ledger__desc");
    var text = descNode && descNode.textContent ? descNode.textContent : "";
    if (text.indexOf("Row 12") >= 0) { rowHigh = list.children[i]; }
    if (text.indexOf("Row 10") >= 0) { rowLow = list.children[i]; }
  }
  assert.ok(rowHigh && rowLow, "rows should render");
  var highTop = Number.parseInt(rowHigh.style.top, 10);
  var lowTop = Number.parseInt(rowLow.style.top, 10);
  assert.ok(highTop < lowTop, "higher sort_id should render first");
});

test("sort falls back to created_at and tx_created_at for ordering", async () => {
  const chipsClient = {
    fetchBalance() {
      return Promise.resolve({ balance: 1200 });
    },
    fetchLedger() {
      return Promise.resolve({
        items: [
          { id: 1, entry_seq: 1, tx_type: "BUY_IN", amount: 1, description: "Row A", created_at: "2026-02-06T19:00:00.000Z", sort_id: "10" },
          { id: 2, entry_seq: 2, tx_type: "BUY_IN", amount: 1, description: "Row B", tx_created_at: "2026-02-06T20:00:00.000Z", sort_id: "12" },
        ],
        nextCursor: null,
      });
    },
  };
  const { windowObj, document } = buildContext(chipsClient);
  const context = vm.createContext({
    window: windowObj,
    document,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    CustomEvent: function() {},
  });
  vm.runInContext(source, context);

  await flush();
  await flush();
  await flush();

  const list = document.getElementById("chipLedgerList");
  var rowHigh = null;
  var rowLow = null;
  for (var i = 0; i < list.children.length; i += 1) {
    var descNode = findByClass(list.children[i], "chip-ledger__desc");
    var text = descNode && descNode.textContent ? descNode.textContent : "";
    if (text.indexOf("Row B") >= 0) { rowHigh = list.children[i]; }
    if (text.indexOf("Row A") >= 0) { rowLow = list.children[i]; }
  }
  if (!rowHigh || !rowLow) {
    rowHigh = list.children[0];
    rowLow = list.children[1];
  }
  var highTop = Number.parseInt(rowHigh.style.top, 10);
  var lowTop = Number.parseInt(rowLow.style.top, 10);
  assert.ok(highTop < lowTop, "entry with later fallback timestamp should render first");
});

test("sort_id tie-breaker works when timestamps missing", async () => {
  const chipsClient = {
    fetchBalance() {
      return Promise.resolve({ balance: 1200 });
    },
    fetchLedger() {
      return Promise.resolve({
        items: [
          { id: 1, entry_seq: 1, tx_type: "BUY_IN", amount: 1, created_at: "2026-02-06T19:00:00.000Z", sort_id: "10" },
          { id: 2, entry_seq: 2, tx_type: "BUY_IN", amount: 1, created_at: "2026-02-06T19:00:00.000Z", sort_id: "12" },
        ],
        nextCursor: null,
      });
    },
  };
  const { windowObj, document } = buildContext(chipsClient);
  const context = vm.createContext({
    window: windowObj,
    document,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    CustomEvent: function() {},
  });
  vm.runInContext(source, context);

  await flush();
  await flush();
  await flush();

  const list = document.getElementById("chipLedgerList");
  var highTop = Number.parseInt(list.children[0].style.top, 10);
  var lowTop = Number.parseInt(list.children[1].style.top, 10);
  assert.ok(highTop < lowTop, "higher sort_id should render first on tie");
});

test("dedupes items with null entry_seq using idempotency_key", async () => {
  const calls = [];
  const firstPage = [
    { id: 1, entry_seq: null, idempotency_key: "idem-1", tx_type: "BUY_IN", amount: 1, display_created_at: "2026-02-06T19:00:00.000Z", sort_id: "700" },
    { id: 2, entry_seq: null, idempotency_key: "idem-2", tx_type: "BUY_IN", amount: 1, display_created_at: "2026-02-06T18:59:00.000Z", sort_id: "699" },
  ];
  const chipsClient = {
    fetchBalance() {
      return Promise.resolve({ balance: 1200 });
    },
    fetchLedger(options) {
      calls.push(options);
      if (!options || !options.cursor) {
        return Promise.resolve({ items: firstPage, nextCursor: "cursor-1" });
      }
      return Promise.resolve({
        items: [
          { id: 3, entry_seq: null, idempotency_key: "idem-2", tx_type: "BUY_IN", amount: 1, display_created_at: "2026-02-06T18:59:00.000Z", sort_id: "699" },
          { id: 4, entry_seq: null, idempotency_key: "idem-3", tx_type: "BUY_IN", amount: 1, display_created_at: "2026-02-06T18:58:00.000Z", sort_id: "698" },
        ],
        nextCursor: null,
      });
    },
  };
  const { windowObj, document } = buildContext(chipsClient);
  const context = vm.createContext({
    window: windowObj,
    document,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    CustomEvent: function() {},
  });
  vm.runInContext(source, context);

  await flush();
  await flush();
  await flush();

  const scroll = document.getElementById("chipLedgerScroll");
  scroll.clientHeight = 200;
  scroll.scrollTop = 400;
  scroll.dispatchEvent({ type: "scroll" });

  await flush();
  await flush();
  await flush();

  const spacer = document.getElementById("chipLedgerSpacer");
  assert.equal(Number.parseInt(spacer.style.height, 10), 4 * 80, "spacer height should match unique items");
  assert.equal(calls.length, 2, "should fetch two pages");
});

test("ledger scroll does not enforce a fixed max-height", () => {
  const normalized = portalCss.replace(/\s+/g, " ");
  assert.ok(!/chip-ledger__scroll\{[^}]*max-height/.test(normalized), "ledger scroll should not cap max-height");
});

test("chip-panel min-height is scoped to page-account", () => {
  const normalized = portalCss.replace(/\s+/g, " ");
  const globalChipPanel = normalized.match(/\.chip-panel\{[^}]*\}/);
  if (globalChipPanel) {
    assert.ok(!/min-height/.test(globalChipPanel[0]), "chip-panel min-height should not be global");
  }
  assert.ok(/\.page-account\s+\.chip-panel\{[^}]*min-height\s*:\s*0/.test(normalized), "chip-panel min-height must be scoped");
});
