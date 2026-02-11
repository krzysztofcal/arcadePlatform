import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(path.join(process.cwd(), "poker", "poker.js"), "utf8");

const flush = () => new Promise(resolve => setImmediate(resolve));

function createElement(tagName, id) {
  const listeners = new Map();
  const classTokens = new Set();
  const node = {
    tagName: String(tagName || "").toUpperCase(),
    id: id || null,
    textContent: "",
    hidden: false,
    className: "",
    dataset: {},
    value: "",
    disabled: false,
    children: [],
    parentNode: null,
    style: {},
    appendChild(child) {
      if (!child) return child;
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    insertBefore(child) {
      if (!child) return child;
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
      const list = listeners.get(event && event.type) || [];
      list.forEach(handler => handler(event));
    },
    setAttribute(name, value) {
      node[name] = String(value);
    },
    removeAttribute(name) {
      delete node[name];
    },
    focus() {},
    classList: {
      add(...tokens) {
        tokens.forEach(token => classTokens.add(token));
        node.className = Array.from(classTokens).join(" ");
      },
      remove(...tokens) {
        tokens.forEach(token => classTokens.delete(token));
        node.className = Array.from(classTokens).join(" ");
      },
    },
  };
  Object.defineProperty(node, "innerHTML", {
    get() {
      return "";
    },
    set(value) {
      if (value === "") node.children = [];
    },
  });
  return node;
}

function createDocument(ids) {
  const nodes = new Map();
  ids.forEach(id => nodes.set(id, createElement("div", id)));
  const listeners = new Map();
  const document = {
    readyState: "complete",
    visibilityState: "visible",
    body: createElement("body", "body"),
    getElementById(id) {
      return nodes.get(id) || null;
    },
    createElement(tagName) {
      return createElement(tagName, null);
    },
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    dispatchEvent(event) {
      const list = listeners.get(event && event.type) || [];
      list.forEach(handler => handler(event));
    },
    __nodes: nodes,
  };
  return document;
}

function makeJwt(sub) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub })).toString("base64url");
  return `${header}.${payload}.sig`;
}

test("table init survives realtime subscribe errors and logs once", async () => {
  const fetchCalls = [];
  const logs = [];
  let timeoutId = 0;

  const ids = [
    "pokerError", "pokerAuthMsg", "pokerTableContent", "pokerTableId", "pokerStakes", "pokerStatus", "pokerSeatsGrid",
    "pokerTurnTimer", "pokerJoin", "pokerLeave", "pokerJoinStatus", "pokerLeaveStatus", "pokerSeatNo", "pokerBuyIn",
    "pokerYourStack", "pokerPot", "pokerPhase", "pokerVersion", "pokerMyCards", "pokerMyCardsStatus", "pokerJsonToggle",
    "pokerJsonBox", "pokerSignIn", "pokerStartHandBtn", "pokerStartHandStatus", "pokerActionsRow", "pokerActAmountWrap",
    "pokerActAmount", "pokerActCheckBtn", "pokerActCallBtn", "pokerActFoldBtn", "pokerActBetBtn", "pokerActRaiseBtn",
    "pokerActStatus", "pokerCopyLogBtn", "pokerCopyLogStatus", "pokerCommunityCards", "pokerShowdown", "pokerShowdownSummary",
    "pokerShowdownWinners", "pokerShowdownPots", "pokerShowdownMeta"
  ];
  const document = createDocument(ids);
  const parentWrap = createElement("div", "parentWrap");
  parentWrap.appendChild(document.getElementById("pokerActAmountWrap"));

  const windowObj = {
    location: { pathname: "/poker/table.html", search: "?tableId=11111111-1111-4111-8111-111111111111" },
    document,
    navigator: { userAgent: "Firefox Android Test" },
    addEventListener() {},
    removeEventListener() {},
    SupabaseAuthBridge: { getAccessToken: async () => makeJwt("user-1") },
    PokerRealtime: {
      subscribeToTableActions() {
        const err = new Error("WebSocket not available");
        err.code = "realtime_ws_missing";
        throw err;
      },
    },
    KLog: {
      log(kind, data) {
        logs.push({ kind, data });
      },
    },
    fetch: async (url) => {
      fetchCalls.push(url);
      return {
        ok: true,
        json: async () => ({
          table: { id: "11111111-1111-4111-8111-111111111111", status: "OPEN", maxPlayers: 6, stakes: { sb: 1, bb: 2 } },
          seats: [{ seatNo: 0, userId: "user-1", status: "ACTIVE" }],
          state: { version: 1, state: { phase: "PREFLOP", stacks: { "user-1": 1000 }, pot: 0 } },
          myHoleCards: null,
        }),
      };
    },
    setTimeout(fn) {
      timeoutId += 1;
      return timeoutId;
    },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
  };

  const context = vm.createContext({
    window: windowObj,
    document,
    navigator: windowObj.navigator,
    location: windowObj.location,
    URLSearchParams,
    fetch: windowObj.fetch,
    setTimeout: windowObj.setTimeout,
    clearTimeout: windowObj.clearTimeout,
    setInterval: windowObj.setInterval,
    clearInterval: windowObj.clearInterval,
    atob: (value) => Buffer.from(String(value), "base64").toString("binary"),
  });
  context.globalThis = context;

  vm.runInContext(source, context);
  await flush();
  await flush();

  assert.ok(fetchCalls.some(url => String(url).includes("/.netlify/functions/poker-get-table")), "loadTable should still run");
  const unavailableLogs = logs.filter(entry => entry.kind === "poker_realtime_unavailable");
  assert.equal(unavailableLogs.length, 1, "realtime unavailable should log only once");

  document.dispatchEvent({ type: "visibilitychange" });
  await flush();

  assert.equal(logs.filter(entry => entry.kind === "poker_realtime_unavailable").length, 1, "visibility changes should not spam realtime logs");
});
