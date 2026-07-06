import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");
const source = await readFile(path.join(repoRoot, "js", "admin-page.js"), "utf8");

const flush = () => new Promise((resolve) => setImmediate(resolve));

function createClassList(node) {
  function read() {
    return String(node.className || "").split(/\s+/).filter(Boolean);
  }
  function write(values) {
    node.className = values.join(" ");
  }
  return {
    add(...tokens) {
      const next = new Set(read());
      tokens.forEach((token) => next.add(token));
      write([...next]);
    },
    remove(...tokens) {
      const drop = new Set(tokens);
      write(read().filter((token) => !drop.has(token)));
    },
    contains(token) {
      return read().includes(token);
    },
    toggle(token, force) {
      if (typeof force === "boolean") {
        if (force) {
          this.add(token);
          return true;
        }
        this.remove(token);
        return false;
      }
      if (this.contains(token)) {
        this.remove(token);
        return false;
      }
      this.add(token);
      return true;
    },
  };
}

function matchesSelector(node, selector) {
  if (!node || typeof selector !== "string") return false;
  if (selector[0] === "#") return node.id === selector.slice(1);
  const attrMatch = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (attrMatch) {
    const name = attrMatch[1];
    const value = attrMatch[2];
    const actual = node.getAttribute(name);
    if (value == null) return actual != null;
    return actual === value;
  }
  return false;
}

function createElement(tagName, id = null) {
  const attributes = new Map();
  const listeners = new Map();
  let html = "";
  const node = {
    tagName: String(tagName || "").toUpperCase(),
    id,
    children: [],
    parentNode: null,
    parentElement: null,
    className: "",
    dataset: {},
    style: {},
    textContent: "",
    hidden: false,
    value: "",
    checked: false,
    disabled: false,
    ownerDocument: null,
    elements: [],
    appendChild(child) {
      child.parentNode = node;
      child.parentElement = node;
      child.ownerDocument = node.ownerDocument;
      node.children.push(child);
      return child;
    },
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    dispatchEvent(event) {
      const nextEvent = event || {};
      if (!nextEvent.target) nextEvent.target = node;
      if (!nextEvent.currentTarget) nextEvent.currentTarget = node;
      if (typeof nextEvent.preventDefault !== "function") nextEvent.preventDefault = function(){};
      const list = listeners.get(nextEvent.type) || [];
      list.forEach((handler) => handler(nextEvent));
      if (nextEvent.bubbles && node.parentNode && typeof node.parentNode.dispatchEvent === "function") {
        const bubbled = { ...nextEvent, currentTarget: node.parentNode };
        node.parentNode.dispatchEvent(bubbled);
      }
      return true;
    },
    setAttribute(name, value) {
      const normalizedValue = String(value);
      attributes.set(name, normalizedValue);
      if (name === "id") node.id = normalizedValue;
      if (name.indexOf("data-") === 0) {
        const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        node.dataset[key] = normalizedValue;
      }
    },
    getAttribute(name) {
      if (attributes.has(name)) return attributes.get(name);
      return null;
    },
    closest(selector) {
      let current = node;
      while (current) {
        if (matchesSelector(current, selector)) return current;
        current = current.parentElement || current.parentNode || null;
      }
      return null;
    },
    focus() {
      if (node.ownerDocument) {
        node.ownerDocument.activeElement = node;
      }
    },
    querySelector() {
      return null;
    },
    reset() {
      (node.elements || []).forEach((field) => {
        if (field.type === "checkbox" || field.type === "radio") {
          field.checked = false;
          return;
        }
        field.value = "";
      });
    },
  };
  node.classList = createClassList(node);
  Object.defineProperty(node, "innerHTML", {
    get() {
      return html;
    },
    set(value) {
      html = String(value == null ? "" : value);
      if (value === "") {
        node.children.length = 0;
      }
    },
  });
  if (id) {
    node.setAttribute("id", id);
  }
  return node;
}

function createDocument() {
  const nodes = new Map();
  const listeners = new Map();
  const queryMap = new Map();
  const document = {
    readyState: "complete",
    activeElement: null,
    body: createElement("body", "body"),
    getElementById(id) {
      return nodes.get(id) || null;
    },
    querySelectorAll(selector) {
      return queryMap.get(selector) || [];
    },
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    dispatchEvent(event) {
      const nextEvent = event || {};
      if (typeof nextEvent.preventDefault !== "function") nextEvent.preventDefault = function(){};
      const list = listeners.get(nextEvent.type) || [];
      list.forEach((handler) => handler(nextEvent));
      return true;
    },
    __nodes: nodes,
    __queryMap: queryMap,
  };
  document.body.ownerDocument = document;
  return document;
}

function registerNode(document, node) {
  node.ownerDocument = document;
  if (node.id) {
    document.__nodes.set(node.id, node);
  }
  return node;
}

function createForm(document, id) {
  const form = registerNode(document, createElement("form", id));
  form.elements = [];
  form.reset = function resetFormFields() {
    form.elements.forEach((field) => {
      if (field.type === "checkbox" || field.type === "radio") {
        field.checked = false;
        return;
      }
      field.value = "";
    });
  };
  return form;
}

function addField(form, { name, type = "text", value = "" } = {}) {
  const field = createElement("input");
  field.name = name;
  field.type = type;
  field.value = value;
  form.elements.push(field);
  return field;
}

function createAdminDom() {
  const document = createDocument();
  const ids = [
    "adminStatus",
    "adminUnauthorized",
    "adminUnauthorizedText",
    "adminApp",
    "adminUsersBody",
    "adminUsersEmpty",
    "adminUsersPagination",
    "adminUserDetail",
    "adminUsersRefresh",
    "adminUsersReset",
    "adminTablesBody",
    "adminTablesEmpty",
    "adminTablesPagination",
    "adminTableDetail",
    "adminTablesRefresh",
    "adminTablesReset",
    "adminLedgerBody",
    "adminLedgerEmpty",
    "adminLedgerPagination",
    "adminLedgerDetail",
    "adminLedgerReset",
    "adminLedgerRecentAdmin",
    "adminPokerAuditBody",
    "adminPokerAuditEmpty",
    "adminPokerAuditDetail",
    "adminPokerAuditRefresh",
    "adminPokerAuditReset",
    "adminOpsStats",
    "adminOpsIdentity",
    "adminOpsRuntime",
    "adminOpsRefresh",
    "adminOpsRunReconciler",
    "adminOpsRunStaleSweep",
    "adminOpsActionResult",
    "adminOpsRecentActions",
    "adminOpsRecentCleanup",
  ];
  ids.forEach((id) => registerNode(document, createElement("div", id)));

  const app = document.getElementById("adminApp");
  app.hidden = true;

  const usersFilters = createForm(document, "adminUsersFilters");
  addField(usersFilters, { name: "sort", value: "last_activity_desc" });
  const tablesFilters = createForm(document, "adminTablesFilters");
  addField(tablesFilters, { name: "status", value: "OPEN" });
  addField(tablesFilters, { name: "sort", value: "last_activity_desc" });
  const ledgerFilters = createForm(document, "adminLedgerFilters");
  addField(ledgerFilters, { name: "txType", value: "" });
  const pokerAuditFilters = createForm(document, "adminPokerAuditFilters");
  addField(pokerAuditFilters, { name: "tableId", value: "" });
  addField(pokerAuditFilters, { name: "handId", value: "" });
  addField(pokerAuditFilters, { name: "limit", value: "20" });

  const tabs = ["users", "tables", "ledger", "pokerAudit", "ops"].map((tab, index) => {
    const button = registerNode(document, createElement("button", `adminTabButton${tab[0].toUpperCase()}${tab.slice(1)}`));
    button.setAttribute("data-admin-tab", tab);
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", index === 0 ? "true" : "false");
    button.setAttribute("aria-controls", `adminTab${tab[0].toUpperCase()}${tab.slice(1)}`);
    button.setAttribute("tabindex", index === 0 ? "0" : "-1");
    if (index === 0) button.classList.add("is-active");
    button.parentNode = document.body;
    button.parentElement = document.body;
    return button;
  });

  const panels = ["users", "tables", "ledger", "pokerAudit", "ops"].map((tab, index) => {
    const panel = registerNode(document, createElement("section", `adminTab${tab[0].toUpperCase()}${tab.slice(1)}`));
    panel.setAttribute("data-admin-panel", tab);
    panel.setAttribute("role", "tabpanel");
    panel.hidden = index !== 0;
    panel.parentNode = document.body;
    panel.parentElement = document.body;
    return panel;
  });

  document.__queryMap.set("[data-admin-tab]", tabs);
  document.__queryMap.set("[data-admin-panel]", panels);
  document.__queryMap.set("[data-ledger-quick]", []);

  return { document, tabs, panels };
}

function buildContext(options = {}) {
  const opts = options || {};
  const { document, tabs, panels } = createAdminDom();
  const fetchCalls = [];
  const fetch = async (url) => {
    fetchCalls.push(String(url || ""));
    const text = String(url || "");
    if (text.includes("/.netlify/functions/admin-me")) {
      return { ok: true, json: async () => ({ userId: "admin-1" }) };
    }
    if (text.includes("/.netlify/functions/admin-users-list")) {
      return { ok: true, json: async () => ({ items: [], pagination: null }) };
    }
    if (text.includes("/.netlify/functions/admin-tables-list")) {
      return { ok: true, json: async () => ({ items: [], pagination: null }) };
    }
    if (text.includes("/.netlify/functions/admin-ledger-list")) {
      return { ok: true, json: async () => ({ items: [], pagination: null }) };
    }
    if (text.includes("/.netlify/functions/admin-ops-summary")) {
      return { ok: true, json: async () => ({
        summary: {},
        janitor: { openTableCount: 0, staleHumanSeatCount: 0, staleOpenTableCount: 0, flaggedTableCount: 0 },
        runtime: { buildId: "test-build", chipsEnabled: true, adminUserIdsConfigured: true, janitorConfig: {}, healthy: true },
        recentJanitorActivity: { adminActions: [], cleanupTransactions: [] },
      }) };
    }
    if (text.includes("/.netlify/functions/admin-stage-identity")) {
      if (opts.identityFails){
        return { ok: false, status: 500, json: async () => ({ error: "server_error" }) };
      }
      return { ok: true, json: async () => ({
        environmentContext: "deploy-preview",
        supabaseProjectRef: "stageabc",
        expectedStageProjectRef: "stageabc",
        databaseTarget: "stage",
        chipsEnabled: true,
        stageProjectRefConfigured: true,
        stageProjectRefMatches: true,
        serviceRoleProjectRef: "stageabc",
        serviceRoleStageProjectRefMatches: true,
        config: {
          hasSupabaseUrl: true,
          hasSupabaseDbUrl: true,
          hasSupabaseJwtSecret: true,
          hasSupabaseAnonKey: true
        }
      }) };
    }
    if (text.includes("/.netlify/functions/admin-poker-audit")) {
      const reveal = text.includes("revealPrivateCards=1");
      return { ok: true, json: async () => ({
        ok: true,
        hands: [{
          tableId: "table-audit",
          handId: "hand-audit",
          startedAt: "2026-07-01T10:00:00.000Z",
          settledAt: "2026-07-01T10:02:00.000Z",
          actionCount: 3,
          winnerUserIds: ["user-a"],
          potTotal: 44,
          hasSettlement: true
        }],
        selectedHand: {
          tableId: "table-audit",
          handId: "hand-audit",
          startedAt: "2026-07-01T10:00:00.000Z",
          settledAt: "2026-07-01T10:02:00.000Z",
          actionCount: 3,
          hasSettlement: true,
          actions: [
            { version: 6, phaseFrom: "TURN", phaseTo: "TURN", source: "bot_autoplay", userId: "user-b", actionType: "CHECK", amount: null, potTotalBefore: 120, potTotalAfter: 120, actorStackBefore: 80, actorStackAfter: 80 },
            { version: 7, phaseFrom: "RIVER", phaseTo: "RIVER", source: "timeout", userId: "user-c", actionType: "FOLD", amount: null, potTotalBefore: 136, potTotalAfter: 136, actorStackBefore: 41, actorStackAfter: 41 },
            { version: 8, phaseFrom: "RIVER", phaseTo: "SETTLED", source: "human", userId: "user-a", actionType: "CALL", amount: 0, potTotalBefore: 136, potTotalAfter: 0, actorStackBefore: 41, actorStackAfter: 176 }
          ],
          timeline: [
            { version: 6, phaseFrom: "TURN", phaseTo: "TURN", source: "bot_autoplay", userId: "user-b", actionType: "CHECK", amount: null, potTotalBefore: 120, potTotalAfter: 120, actorStackBefore: 80, actorStackAfter: 80 },
            { version: 7, phaseFrom: "RIVER", phaseTo: "RIVER", source: "timeout", userId: "user-c", actionType: "FOLD", amount: null, potTotalBefore: 136, potTotalAfter: 136, actorStackBefore: 41, actorStackAfter: 41 },
            { version: 8, phaseFrom: "RIVER", phaseTo: "SETTLED", source: "human", userId: "user-a", actionType: "CALL", amount: 0, potTotalBefore: 136, potTotalAfter: 0, actorStackBefore: 41, actorStackAfter: 176 },
            { version: 9, phaseFrom: null, phaseTo: "SETTLED", source: "system", userId: null, actionType: "HAND_SETTLED", amount: 152, payoutTotal: 152, winnerUserIds: ["user-a"], reason: "computed" }
          ],
          settlement: { reason: "computed", settledAt: "2026-07-01T10:02:00.000Z", communityCards: ["AD", "JD", "3C", "KD", "6S"], winners: ["user-a"], payoutByUserId: { "user-a": 152 }, payoutTotal: 152, potsAwarded: [{ amount: 152, eligibleUserIds: ["user-a"], winners: ["user-a"] }], evaluatedHands: [{ userId: "user-a", name: "TWO_PAIR", category: 3, ranks: [10], bestFiveCards: ["AD", "JD", "3C", "KD", "6S"] }] },
          ...(reveal ? { privateCardsByUserId: { "user-a": ["AS", "KD"] }, privateCardsAvailable: true } : {})
        }
      }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  const windowObj = {
    document,
    fetch,
    KLog: { log() {} },
    I18N: { t() { return ""; } },
    SupabaseAuthBridge: { getAccessToken: async () => "token" },
    SupabaseAuth: { onAuthChange() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    confirm() { return true; },
    prompt() { return "FORCE CLOSE"; },
  };
  const context = vm.createContext({
    window: windowObj,
    document,
    navigator: windowObj.navigator,
    fetch,
    setTimeout,
    clearTimeout,
    Math,
    Date,
  });
  return { context, document, tabs, panels, fetchCalls };
}

test("admin page tabs switch panels on click and keep ARIA state in sync", async () => {
  const { context, document, tabs, panels, fetchCalls } = buildContext();
  vm.runInContext(source, context, { filename: "js/admin-page.js" });

  await flush();
  await flush();

  assert.equal(document.getElementById("adminApp").hidden, false);
  assert.equal(fetchCalls.includes("/.netlify/functions/admin-users-list?sort=last_activity_desc&page=1&limit=20"), true);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.equal(panels[0].hidden, false);
  assert.equal(panels[1].hidden, true);

  tabs[1].dispatchEvent({ type: "click", bubbles: true, target: tabs[1], preventDefault() {} });
  await flush();

  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  assert.equal(tabs[1].getAttribute("tabindex"), "0");
  assert.equal(tabs[1].classList.contains("is-active"), true);
  assert.equal(tabs[0].getAttribute("aria-selected"), "false");
  assert.equal(tabs[0].getAttribute("tabindex"), "-1");
  assert.equal(panels[0].hidden, true);
  assert.equal(panels[1].hidden, false);
  assert.equal(panels[1].getAttribute("aria-hidden"), "false");
  assert.equal(fetchCalls.includes("/.netlify/functions/admin-tables-list?status=OPEN&sort=last_activity_desc&page=1&limit=20"), true);

  tabs[4].dispatchEvent({ type: "click", bubbles: true, target: tabs[4], preventDefault() {} });
  await flush();

  assert.equal(tabs[4].getAttribute("aria-selected"), "true");
  assert.equal(panels[4].hidden, false);
  assert.equal(fetchCalls.includes("/.netlify/functions/admin-stage-identity"), true);
  assert.equal(fetchCalls.includes("/.netlify/functions/admin-ops-summary"), true);
  assert.match(document.getElementById("adminOpsIdentity").innerHTML, /Database target/);
  assert.match(document.getElementById("adminOpsIdentity").innerHTML, /stageabc/);
  assert.match(document.getElementById("adminOpsIdentity").innerHTML, /Service role stage match/);
  assert.match(document.getElementById("adminOpsIdentity").innerHTML, /stage/);
});

test("admin page still renders ops summary when stage identity request fails", async () => {
  const { context, document, tabs, fetchCalls } = buildContext({ identityFails: true });
  vm.runInContext(source, context, { filename: "js/admin-page.js" });

  await flush();
  await flush();

  tabs[4].dispatchEvent({ type: "click", bubbles: true, target: tabs[4], preventDefault() {} });
  await flush();
  await flush();

  assert.equal(fetchCalls.includes("/.netlify/functions/admin-stage-identity"), true);
  assert.equal(fetchCalls.includes("/.netlify/functions/admin-ops-summary"), true);
  assert.match(document.getElementById("adminOpsIdentity").innerHTML, /Stage identity unavailable/);
  assert.match(document.getElementById("adminOpsStats").innerHTML, /OPEN tables/);
  assert.match(document.getElementById("adminOpsRuntime").innerHTML, /Runtime health/);
});

test("admin page poker audit search renders hand timeline and settlement summary", async () => {
  const { context, document, tabs, fetchCalls } = buildContext();
  vm.runInContext(source, context, { filename: "js/admin-page.js" });

  await flush();
  await flush();

  tabs[3].dispatchEvent({ type: "click", bubbles: true, target: tabs[3], preventDefault() {} });
  await flush();

  const filters = document.getElementById("adminPokerAuditFilters");
  filters.elements.find((field) => field.name === "handId").value = "hand-audit";
  filters.dispatchEvent({ type: "submit", bubbles: true, target: filters, preventDefault() {} });
  await flush();
  await flush();

  assert.equal(fetchCalls.includes("/.netlify/functions/admin-poker-audit?handId=hand-audit&limit=20"), true);
  assert.match(document.getElementById("adminPokerAuditBody").innerHTML, /hand-audit/);
  assert.match(document.getElementById("adminPokerAuditBody").innerHTML, /View details/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /Action timeline/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /CALL/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /HAND_SETTLED/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /see HAND_SETTLED/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /settled separately/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /human/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /bot_autoplay/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /timeout/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /system/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /A♦/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /J♦/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /6♠/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /TWO_PAIR \(category 3\)/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /Hidden by default/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /computed/);
  assert.doesNotMatch(document.getElementById("adminPokerAuditDetail").innerHTML, /holeCardsByUserId|deck/);

  const revealButton = createElement("button");
  revealButton.setAttribute("data-audit-action", "reveal-private");
  revealButton.setAttribute("data-audit-table-id", "table-audit");
  revealButton.setAttribute("data-audit-hand-id", "hand-audit");
  revealButton.parentNode = document.body;
  revealButton.parentElement = document.body;
  document.dispatchEvent({ type: "click", bubbles: true, target: revealButton, preventDefault() {} });
  await flush();
  await flush();

  assert.equal(fetchCalls.includes("/.netlify/functions/admin-poker-audit?tableId=table-audit&handId=hand-audit&limit=20&revealPrivateCards=1"), true);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /A♠/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /K♦/);
  assert.match(document.getElementById("adminPokerAuditDetail").innerHTML, /admin-card-symbol--red/);
});
