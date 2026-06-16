import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");
const sidebarModelSource = await readFile(path.join(repoRoot, "js", "core", "sidebar-model.js"), "utf8");
const sidebarSource = await readFile(path.join(repoRoot, "js", "sidebar.js"), "utf8");

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
    toggle(token) {
      if (this.contains(token)) {
        this.remove(token);
        return false;
      }
      this.add(token);
      return true;
    },
  };
}

function findByClass(root, className) {
  if (!root) return null;
  if (root.classList && root.classList.contains(className)) return root;
  for (const child of root.children || []) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

function createElement(tagName, id = null) {
  const attributes = new Map();
  const listeners = new Map();
  const node = {
    tagName: String(tagName || "").toUpperCase(),
    id,
    children: [],
    parentNode: null,
    className: "",
    dataset: {},
    style: {},
    textContent: "",
    hidden: false,
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    querySelector(selector) {
      if (selector.startsWith(".")) {
        return findByClass(node, selector.slice(1));
      }
      return null;
    },
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    dispatchEvent(event) {
      const list = listeners.get(event?.type) || [];
      list.forEach((handler) => handler(event));
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
      if (name === "id") node.id = String(value);
    },
    getAttribute(name) {
      return attributes.get(name) || null;
    },
  };
  node.classList = createClassList(node);
  Object.defineProperty(node, "innerHTML", {
    get() {
      return "";
    },
    set(value) {
      if (value === "") {
        node.children.length = 0;
      }
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
    createElement(tagName) {
      return createElement(tagName);
    },
    addEventListener() {},
  };
  document.__nodes = nodes;
  return document;
}

function collectHrefs(root) {
  const hrefs = [];
  function walk(node) {
    if (!node) return;
    if (node.tagName === "A") {
      hrefs.push(node.getAttribute("href"));
    }
    (node.children || []).forEach(walk);
  }
  walk(root);
  return hrefs;
}

async function renderSidebarAs(statusCode) {
  const document = createDocument();
  const sidebar = createElement("aside", "sidebar");
  sidebar.className = "sidebar";
  sidebar.classList.add("collapsed");
  const toggle = createElement("button", "sbToggle");
  toggle.setAttribute("aria-expanded", "false");
  document.__nodes.set("sidebar", sidebar);
  document.__nodes.set("sbToggle", toggle);

  const authListeners = [];
  const fetchCalls = [];
  const windowObj = {
    document,
    location: { pathname: "/index.html" },
    addEventListener() {},
    SupabaseAuthBridge: {
      getAccessToken: async () => "admin-token",
    },
    SupabaseAuth: {
      onAuthChange(listener) {
        authListeners.push(listener);
      },
    },
  };

  const context = vm.createContext({
    window: windowObj,
    document,
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return { status: statusCode };
    },
    matchMedia: () => ({ matches: false }),
    setTimeout,
    clearTimeout,
  });

  vm.runInContext(sidebarModelSource, context, { filename: "js/core/sidebar-model.js" });
  vm.runInContext(sidebarSource, context, { filename: "js/sidebar.js" });
  await flush();
  await flush();

  return { authListeners, fetchCalls, hrefs: collectHrefs(sidebar) };
}

test("sidebar shows Admin entry for verified admins", async () => {
  const result = await renderSidebarAs(200);

  assert.equal(result.fetchCalls.length >= 1, true);
  assert.equal(result.fetchCalls[0].url, "/.netlify/functions/admin-me");
  assert.equal(result.fetchCalls[0].options.headers.Authorization, "Bearer admin-token");
  assert.equal(result.authListeners.length, 1);
  assert.equal(result.hrefs.includes("/admin.html"), true);
});

test("sidebar hides Admin entry for non-admins", async () => {
  const result = await renderSidebarAs(403);

  assert.equal(result.fetchCalls.length >= 1, true);
  assert.equal(result.hrefs.includes("/admin.html"), false);
});
