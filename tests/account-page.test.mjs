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
  const windowObj = {
    document,
    addEventListener() {},
    requestAnimationFrame(cb) {
      cb();
    },
    SupabaseAuth: {
      getCurrentUser() {
        return Promise.resolve({ user_metadata: { name: "Tester" }, email: "tester@example.com" });
      },
      onAuthChange() {},
    },
    ChipsClient: chipsClient,
  };
  return { windowObj, document };
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
            created_at: "2026-02-06T19:15:23.123Z",
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

test("loads more ledger entries on scroll", async () => {
  const calls = [];
  const firstPage = Array.from({ length: 10 }, (_value, index) => ({
    id: index + 1,
    tx_type: "BUY_IN",
    amount: 1,
    created_at: "2026-02-06T19:00:00.000Z",
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
            tx_type: "CASH_OUT",
            amount: -5,
            created_at: "2026-02-05T18:40:00.000Z",
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
  assert.equal(calls[1].cursor, "cursor-1", "second page should include cursor");
  const spacer = document.getElementById("chipLedgerSpacer");
  assert.ok(Number.parseInt(spacer.style.height, 10) > firstPage.length * 72, "spacer height should grow");
});

test("shows error tail row and retries on scroll", async () => {
  const calls = [];
  const firstPage = Array.from({ length: 3 }, (_value, index) => ({
    id: index + 1,
    tx_type: "BUY_IN",
    amount: 1,
    created_at: "2026-02-06T19:00:00.000Z",
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
            tx_type: "CASH_OUT",
            amount: -5,
            created_at: "2026-02-05T18:40:00.000Z",
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

  scroll.scrollTop = 400;
  scroll.dispatchEvent({ type: "scroll" });

  await flush();
  await flush();
  await flush();

  const newErrorRow = findByClassToken(list, "chip-ledger__item--status");
  assert.ok(!newErrorRow || !/Could not load more activity/i.test(newErrorRow.textContent), "error row should clear");
  assert.ok(calls.length >= 3, "fetchLedger should retry after error");
});
