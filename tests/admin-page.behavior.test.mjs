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

function formField(form, name) {
  return (form.elements || []).find((field) => field.name === name);
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
    "adminBonusCampaignsBody",
    "adminBonusCampaignsEmpty",
    "adminBonusCampaignsPagination",
    "adminBonusCampaignsRefresh",
    "adminBonusCampaignsReset",
    "adminBonusCampaignClear",
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
  const bonusCampaignsFilters = createForm(document, "adminBonusCampaignsFilters");
  addField(bonusCampaignsFilters, { name: "status", value: "" });
  const bonusCampaignForm = createForm(document, "adminBonusCampaignForm");
  addField(bonusCampaignForm, { name: "campaignId", value: "" });
  addField(bonusCampaignForm, { name: "code", value: "" });
  addField(bonusCampaignForm, { name: "title", value: "" });
  addField(bonusCampaignForm, { name: "description", value: "" });
  addField(bonusCampaignForm, { name: "campaignType", value: "" });
  addField(bonusCampaignForm, { name: "amount", value: "" });
  addField(bonusCampaignForm, { name: "startsAt", value: "" });
  addField(bonusCampaignForm, { name: "endsAt", value: "" });
  addField(bonusCampaignForm, { name: "eligibilityType", value: "all_accounts" });
  addField(bonusCampaignForm, { name: "claimPolicy", value: "once" });
  addField(bonusCampaignForm, { name: "maxTotalClaims", value: "" });
  addField(bonusCampaignForm, { name: "eligibilityConfig", value: "{}" });
  const pokerAuditFilters = createForm(document, "adminPokerAuditFilters");
  addField(pokerAuditFilters, { name: "tableId", value: "" });
  addField(pokerAuditFilters, { name: "handId", value: "" });
  addField(pokerAuditFilters, { name: "limit", value: "20" });

  const tabs = ["users", "tables", "ledger", "bonusCampaigns", "pokerAudit", "ops"].map((tab, index) => {
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

  const panels = ["users", "tables", "ledger", "bonusCampaigns", "pokerAudit", "ops"].map((tab, index) => {
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
    if (text.includes("/.netlify/functions/admin-bonus-campaigns")) {
      return { ok: true, json: async () => ({
        items: [
          {
            id: "campaign-1",
            code: "daily-test",
            title: "Daily Test",
            amount: 50,
            status: "draft",
            startsAt: "2026-07-07T00:00:00.000Z",
            endsAt: null,
            eligibilityType: "all_accounts",
            eligibilityConfig: {},
            claimPolicy: "daily",
            maxTotalClaims: 100,
            claimCount: 0,
          },
          {
            id: "campaign-2",
            code: "active-test",
            title: "Active Test",
            amount: 20,
            status: "active",
            startsAt: "2026-07-08T00:00:00.000Z",
            endsAt: null,
            eligibilityType: "all_accounts",
            eligibilityConfig: {},
            claimPolicy: "once",
            maxTotalClaims: null,
            claimCount: 3,
          },
          {
            id: "campaign-3",
            code: "paused-empty-test",
            title: "Paused Empty Test",
            amount: 20,
            status: "paused",
            startsAt: "2026-07-09T00:00:00.000Z",
            endsAt: null,
            eligibilityType: "all_accounts",
            eligibilityConfig: {},
            claimPolicy: "once",
            maxTotalClaims: null,
            claimCount: 0,
          },
        ],
        pagination: null,
      }) };
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

  tabs[3].dispatchEvent({ type: "click", bubbles: true, target: tabs[3], preventDefault() {} });
  await flush();

  assert.equal(tabs[3].getAttribute("aria-selected"), "true");
  assert.equal(panels[3].hidden, false);
  assert.equal(fetchCalls.includes("/.netlify/functions/admin-bonus-campaigns?page=1&limit=25"), true);
  assert.match(document.getElementById("adminBonusCampaignsBody").innerHTML, /daily-test/);
  assert.match(document.getElementById("adminBonusCampaignsBody").innerHTML, /Daily Test/);
  assert.match(document.getElementById("adminBonusCampaignsBody").innerHTML, /Edit draft/);
  assert.match(document.getElementById("adminBonusCampaignsBody").innerHTML, /Edit safe fields/);
  assert.match(document.getElementById("adminBonusCampaignsBody").innerHTML, /View/);

  const dailyTemplateButton = createElement("button");
  dailyTemplateButton.setAttribute("data-bonus-template", "daily");
  document.dispatchEvent({ type: "click", target: dailyTemplateButton, preventDefault() {} });

  const bonusCampaignForm = document.getElementById("adminBonusCampaignForm");
  assert.equal(formField(bonusCampaignForm, "title").value, "Daily Login Bonus");
  assert.equal(formField(bonusCampaignForm, "campaignType").value, "daily");
  assert.equal(formField(bonusCampaignForm, "amount").value, "20");
  assert.equal(formField(bonusCampaignForm, "claimPolicy").value, "daily");
  assert.equal(formField(bonusCampaignForm, "eligibilityType").value, "all_accounts");
  assert.equal(formField(bonusCampaignForm, "code").value, "daily-login-2026");
  assert.match(formField(bonusCampaignForm, "startsAt").value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.deepEqual(JSON.parse(formField(bonusCampaignForm, "eligibilityConfig").value), {});
  assert.match(document.getElementById("adminStatus").textContent, /template applied/);

  formField(bonusCampaignForm, "code").value = "Arcade-Hub-anniversary";
  formField(bonusCampaignForm, "endsAt").value = "2020-01-01T00:00";
  const anniversaryTemplateButton = createElement("button");
  anniversaryTemplateButton.setAttribute("data-bonus-template", "anniversary");
  document.dispatchEvent({ type: "click", target: anniversaryTemplateButton, preventDefault() {} });
  assert.equal(formField(bonusCampaignForm, "code").value, "anniversary-2026");
  assert.equal(formField(bonusCampaignForm, "endsAt").value, "");

  formField(bonusCampaignForm, "code").value = "custom-campaign_2026";
  document.dispatchEvent({ type: "click", target: dailyTemplateButton, preventDefault() {} });
  assert.equal(formField(bonusCampaignForm, "code").value, "custom-campaign_2026");

  formField(bonusCampaignForm, "startsAt").value = "2026-07-10T12:30";
  formField(bonusCampaignForm, "eligibilityType").value = "created_after";
  formField(bonusCampaignForm, "eligibilityConfig").value = "{}";
  bonusCampaignForm.dispatchEvent({
    type: "change",
    target: formField(bonusCampaignForm, "eligibilityType"),
    preventDefault() {},
  });
  assert.deepEqual(JSON.parse(formField(bonusCampaignForm, "eligibilityConfig").value), {
    created_at_gte: "2026-07-10T12:30",
  });
  formField(bonusCampaignForm, "eligibilityType").value = "created_before";
  bonusCampaignForm.dispatchEvent({
    type: "change",
    target: formField(bonusCampaignForm, "eligibilityType"),
    preventDefault() {},
  });
  assert.deepEqual(JSON.parse(formField(bonusCampaignForm, "eligibilityConfig").value), {
    created_at_lte: "2026-07-10T12:30",
  });
  formField(bonusCampaignForm, "eligibilityType").value = "all_accounts";
  bonusCampaignForm.dispatchEvent({
    type: "change",
    target: formField(bonusCampaignForm, "eligibilityType"),
    preventDefault() {},
  });
  assert.deepEqual(JSON.parse(formField(bonusCampaignForm, "eligibilityConfig").value), {});
  formField(bonusCampaignForm, "eligibilityConfig").value = JSON.stringify({ manual: true });
  formField(bonusCampaignForm, "eligibilityType").value = "created_after";
  bonusCampaignForm.dispatchEvent({
    type: "change",
    target: formField(bonusCampaignForm, "eligibilityType"),
    preventDefault() {},
  });
  assert.deepEqual(JSON.parse(formField(bonusCampaignForm, "eligibilityConfig").value), { manual: true });

  const draftEditButton = createElement("button");
  draftEditButton.setAttribute("data-campaign-action", "edit");
  draftEditButton.setAttribute("data-campaign-id", "campaign-1");
  document.dispatchEvent({ type: "click", target: draftEditButton, preventDefault() {} });

  assert.equal(formField(bonusCampaignForm, "title").value, "Daily Test");
  assert.equal(formField(bonusCampaignForm, "amount").value, "50");
  assert.equal(formField(bonusCampaignForm, "code").disabled, true);
  assert.equal(formField(bonusCampaignForm, "title").disabled, false);
  assert.equal(formField(bonusCampaignForm, "amount").disabled, false);
  assert.match(document.getElementById("adminStatus").textContent, /loaded for editing/);

  const activeViewButton = createElement("button");
  activeViewButton.setAttribute("data-campaign-action", "view");
  activeViewButton.setAttribute("data-campaign-id", "campaign-2");
  document.dispatchEvent({ type: "click", target: activeViewButton, preventDefault() {} });

  assert.equal(formField(bonusCampaignForm, "title").value, "Active Test");
  assert.equal(formField(bonusCampaignForm, "amount").value, "20");
  assert.equal(formField(bonusCampaignForm, "code").disabled, true);
  assert.equal(formField(bonusCampaignForm, "title").disabled, true);
  assert.equal(formField(bonusCampaignForm, "amount").disabled, true);
  assert.match(document.getElementById("adminStatus").textContent, /read-only/);

  const safeEditButton = createElement("button");
  safeEditButton.setAttribute("data-campaign-action", "edit");
  safeEditButton.setAttribute("data-campaign-id", "campaign-3");
  document.dispatchEvent({ type: "click", target: safeEditButton, preventDefault() {} });

  assert.equal(formField(bonusCampaignForm, "title").value, "Paused Empty Test");
  assert.equal(formField(bonusCampaignForm, "code").disabled, true);
  assert.equal(formField(bonusCampaignForm, "title").disabled, false);
  assert.equal(formField(bonusCampaignForm, "description").disabled, false);
  assert.equal(formField(bonusCampaignForm, "startsAt").disabled, false);
  assert.equal(formField(bonusCampaignForm, "endsAt").disabled, false);
  assert.equal(formField(bonusCampaignForm, "maxTotalClaims").disabled, false);
  assert.equal(formField(bonusCampaignForm, "amount").disabled, true);
  assert.equal(formField(bonusCampaignForm, "claimPolicy").disabled, true);
  assert.equal(formField(bonusCampaignForm, "eligibilityType").disabled, true);
  assert.match(document.getElementById("adminStatus").textContent, /Safe fields/);

  document.dispatchEvent({ type: "click", target: dailyTemplateButton, preventDefault() {} });
  assert.equal(formField(bonusCampaignForm, "title").value, "Paused Empty Test");
  assert.equal(formField(bonusCampaignForm, "amount").value, "20");
  assert.match(document.getElementById("adminStatus").textContent, /Templates are available only/);

  tabs[5].dispatchEvent({ type: "click", bubbles: true, target: tabs[5], preventDefault() {} });
  await flush();

  assert.equal(tabs[5].getAttribute("aria-selected"), "true");
  assert.equal(panels[5].hidden, false);
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

  tabs[5].dispatchEvent({ type: "click", bubbles: true, target: tabs[5], preventDefault() {} });
  await flush();
  await flush();

  assert.equal(fetchCalls.includes("/.netlify/functions/admin-stage-identity"), true);
  assert.equal(fetchCalls.includes("/.netlify/functions/admin-ops-summary"), true);
  assert.match(document.getElementById("adminOpsIdentity").innerHTML, /Stage identity unavailable/);
  assert.match(document.getElementById("adminOpsStats").innerHTML, /OPEN tables/);
  assert.match(document.getElementById("adminOpsRuntime").innerHTML, /Runtime health/);
});

test("admin bonus campaign form explains invalid campaign codes before sending a request", async () => {
  const { context, document, fetchCalls } = buildContext();
  vm.runInContext(source, context, { filename: "js/admin-page.js" });

  await flush();
  await flush();

  const form = document.getElementById("adminBonusCampaignForm");
  formField(form, "code").value = "Daily Bonus!";
  formField(form, "title").value = "Daily Bonus";
  formField(form, "campaignType").value = "daily";
  formField(form, "amount").value = "20";
  formField(form, "startsAt").value = "2026-07-10T12:00";
  form.dispatchEvent({ type: "submit", target: form, preventDefault() {} });

  await flush();

  assert.match(document.getElementById("adminStatus").textContent, /invalid_code/);
  assert.match(document.getElementById("adminStatus").textContent, /lowercase letter or digit/);
  assert.match(document.getElementById("adminStatus").textContent, /daily-active-2026/);
  assert.equal(fetchCalls.some((url) => url.includes("/.netlify/functions/admin-bonus-campaigns")), false);
});

test("admin page poker audit search renders hand timeline and settlement summary", async () => {
  const { context, document, tabs, fetchCalls } = buildContext();
  vm.runInContext(source, context, { filename: "js/admin-page.js" });

  await flush();
  await flush();

  tabs[4].dispatchEvent({ type: "click", bubbles: true, target: tabs[4], preventDefault() {} });
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
