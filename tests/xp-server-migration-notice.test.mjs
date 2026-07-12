import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLIENT_SOURCE = await fs.readFile(path.join(ROOT, "js", "xpClient.js"), "utf8");
function noticeKey(userId) {
  return `kcswh:xp:server-migration-notice:v1:${userId}`;
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = "";
    this.className = "";
    this.hidden = false;
    this.id = "";
    this.type = "";
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  contains(child) {
    return this === child || this.children.some((item) => item.contains(child));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }
}

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

async function loadClient({ legacy, serverStatus, userId = "user-a", error = false, marker = false }) {
  const storage = new Map();
  if (legacy !== undefined) storage.set("kcswh:xp:last", legacy);
  if (marker) storage.set(noticeKey(userId), "1");

  const badge = new FakeElement("a");
  badge.id = "xpBadge";
  const body = new FakeElement("body");
  body.appendChild(badge);
  const documentListeners = new Map();
  const documentStub = {
    body,
    head: new FakeElement("head"),
    createElement(tagName) { return new FakeElement(tagName); },
    getElementById(id) { return id === "xpBadge" ? badge : null; },
    addEventListener(name, callback) { documentListeners.set(name, callback); },
  };
  const requests = [];
  const applied = [];
  const resetCalls = [];
  let statusReads = 0;

  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  };
  const window = {
    localStorage,
    document: documentStub,
    SupabaseAuthBridge: {
      async getAccessToken() { return "stage-jwt"; },
      async getCurrentUserId() { return userId; },
    },
    SupabaseAuth: { onAuthChange() {} },
    I18N: {
      format(key) {
        if (key === "xpServerMigrationNotice") return "XP synchronized. Unsaved device progress could not be transferred.";
        if (key === "xpServerMigrationDismiss") return "Dismiss XP synchronization notice";
        return "";
      },
    },
    XP: {
      resetIdentityCache(options) { resetCalls.push(options || null); },
      refreshFromServerStatus(payload, meta) {
        applied.push({ payload, meta });
        const total = Number(payload.totalLifetime) || 0;
        badge.textContent = `${total} XP / level ${total >= 300 ? 3 : 1}`;
      },
    },
  };
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;

  const context = {
    window,
    document: documentStub,
    fetch: async (_url, options) => {
      requests.push({ url: _url, options });
      statusReads += 1;
      if (error) return response(500, { error: "server_error" });
      return response(200, serverStatus);
    },
    crypto: { randomUUID: () => "test-session-id" },
    Date,
    setTimeout,
    clearTimeout,
    console,
  };
  vm.createContext(context);
  vm.runInContext(CLIENT_SOURCE, context, { filename: "xpClient.js" });
  await new Promise((resolve) => setTimeout(resolve, 30));

  return {
    storage,
    badge,
    body,
    requests,
    applied,
    resetCalls,
    statusReads,
    notice: body.children.find((child) => child.id === "xpServerMigrationNotice") || null,
    XPClient: window.XPClient,
  };
}

function status(totalLifetime) {
  return { ok: true, status: "statusOnly", totalLifetime, cap: 300, capDelta: 300 };
}

// Legacy XP above the authoritative total is explained once, never uploaded, and removed after success.
{
  const result = await loadClient({
    legacy: JSON.stringify({ totalLifetime: 300, serverTotalXp: 300, badgeShownXp: 300 }),
    serverStatus: status(0),
  });
  assert.equal(result.badge.textContent, "0 XP / level 1");
  assert.equal(result.notice?.children[0]?.textContent, "XP synchronized. Unsaved device progress could not be transferred.");
  assert.equal(result.notice?.children[1]?.textContent, "×");
  assert.equal(result.storage.has("kcswh:xp:last"), false);
  assert.equal(result.storage.has("kcswh:xp:regen"), false);
  assert.equal(result.storage.get(noticeKey("user-a")), "1");
  assert.equal(result.requests[0].options.headers.Authorization, "Bearer stage-jwt");
  const requestBody = JSON.parse(result.requests[0].options.body);
  assert.equal(requestBody.operation, "status");
  assert.equal(Object.hasOwn(requestBody, "statusOnly"), false);
  assert.equal(Object.hasOwn(requestBody, "totalLifetime"), false);
  assert.equal(Object.hasOwn(requestBody, "serverTotalXp"), false);
  assert.equal(result.applied[0].meta.allowServerRegression, true);
  assert.equal(result.resetCalls.length, 0);
}

// Equal or lower legacy values do not produce a migration notice.
for (const [legacy, total] of [[300, 300], [100, 300], [undefined, 0]]) {
  const result = await loadClient({
    legacy: legacy === undefined ? undefined : JSON.stringify({ totalLifetime: legacy }),
    serverStatus: status(total),
  });
  assert.equal(result.notice, null);
  assert.equal(result.storage.has("kcswh:xp:last"), false);
  assert.equal(result.badge.textContent, `${total} XP / level ${total >= 300 ? 3 : 1}`);
}

// Invalid legacy JSON is harmless and does not affect the server total.
{
  const result = await loadClient({ legacy: "{invalid", serverStatus: status(300) });
  assert.equal(result.notice, null);
  assert.equal(result.badge.textContent, "300 XP / level 3");
}

// Failed status reads do not force zero, remove legacy storage, or set the marker.
{
  const result = await loadClient({
    legacy: JSON.stringify({ totalLifetime: 300 }),
    serverStatus: status(0),
    error: true,
  });
  assert.equal(result.badge.textContent, "");
  assert.equal(result.storage.get("kcswh:xp:last"), JSON.stringify({ totalLifetime: 300 }));
  assert.equal(result.storage.has(noticeKey("user-a")), false);
  assert.equal(result.notice, null);
}

// A prior per-user marker suppresses the notice, while another user gets an independent decision.
{
  const result = await loadClient({
    legacy: JSON.stringify({ totalLifetime: 300 }),
    serverStatus: status(0),
    marker: true,
  });
  assert.equal(result.notice, null);
  assert.equal(result.storage.get(noticeKey("user-a")), "1");
}

{
  const result = await loadClient({
    legacy: JSON.stringify({ totalLifetime: 300 }),
    serverStatus: status(0),
    userId: "user-b",
  });
  assert.notEqual(result.notice, null);
  assert.equal(result.storage.get(noticeKey("user-b")), "1");
}

console.log("xp server migration notice tests passed");
