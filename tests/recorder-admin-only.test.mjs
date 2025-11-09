import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

async function loadRecorder({ admin }) {
  const now = Date.now();
  const localStorage = {
    getItem(key) {
      if (key === "kcswh:admin" && admin) {
        return JSON.stringify({ v: true, exp: now + 86_400_000 });
      }
      return null;
    },
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
  return status;
}

(async () => {
  const nonAdminStatus = await loadRecorder({ admin: false });
  assert.equal(nonAdminStatus.startedAt || 0, 0, "recorder MUST NOT autostart without admin flag");

  const adminStatus = await loadRecorder({ admin: true });
  assert.ok((adminStatus.startedAt || 0) > 0, "recorder SHOULD autostart when admin flag present");

  console.log("recorder-admin-only.test.mjs: PASS");
})();
