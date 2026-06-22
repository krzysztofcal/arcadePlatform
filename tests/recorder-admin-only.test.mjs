import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

async function loadRecorder() {
  const localStorage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  };

  const document = {
    body: { appendChild() {}, removeChild() {} },
    addEventListener() {},
    removeEventListener() {},
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
    documentElement: { appendChild() {}, removeChild() {} },
  };

  const sandbox = {
    console,
    Date,
    window: {
      localStorage,
      location: { search: "" },
      dispatchEvent() {},
      addEventListener() {},
    },
    document,
    localStorage,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    URL: { createObjectURL() { return ""; }, revokeObjectURL() {} },
    Blob: class {},
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  sandbox.window.window = sandbox.window;

  vm.createContext(sandbox);
  const src = await fs.readFile(new URL("../js/debug.js", import.meta.url), "utf8");
  vm.runInContext(src, sandbox, { filename: "debug.js" });

  const status = sandbox.window.KLog && typeof sandbox.window.KLog.status === "function"
    ? sandbox.window.KLog.status()
    : { startedAt: 0 };
  return { sandbox, status };
}

(async () => {
  const { sandbox, status: initialStatus } = await loadRecorder();
  assert.equal(initialStatus.startedAt || 0, 0, "recorder MUST NOT autostart without verified admin access");
  assert.equal(sandbox.window.KLog.isAdmin(), false, "admin access should default to false");
  assert.equal(sandbox.window.KLog.start(1), false, "non-admin callers must not be able to start recorder");
  assert.equal(sandbox.window.KLog.getText(), "", "non-admin callers must not be able to read diagnostics");

  sandbox.window.KLog.syncAdminAccess(true);
  assert.equal(sandbox.window.KLog.isAdmin(), true, "verified admin access should be tracked in memory");
  assert.equal(sandbox.window.KLog.start(1), true, "verified admins should be able to start recorder");
  assert.ok((sandbox.window.KLog.status().startedAt || 0) > 0, "recorder should start after admin verification");

  sandbox.window.KLog.syncAdminAccess(false);
  assert.equal(sandbox.window.KLog.isAdmin(), false, "admin access should be revocable");
  assert.equal(sandbox.window.KLog.getText(), "", "logs should become unreadable after admin access is removed");

  console.log("recorder-admin-only.test.mjs: PASS");
})();
