import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

async function runXpWithDom({ hasHostAttr = false, slug = "", visibilityState = "visible" } = {}) {
  const calls = { addEventListener: 0, setInterval: 0, setTimeout: 0 };
  let timerId = 0;

  const makeTimer = (type) => (...args) => {
    calls[type] += 1;
    return ++timerId;
  };

  const setIntervalStub = makeTimer("setInterval");
  const setTimeoutStub = makeTimer("setTimeout");

  const document = {
    visibilityState,
    hidden: visibilityState !== "visible",
    readyState: "complete",
    body: {
      hasAttribute: (name) => (name === "data-game-host" ? !!hasHostAttr : false),
      dataset: slug ? { gameSlug: slug } : {},
      getAttribute: () => null,
      appendChild() {},
      removeChild() {},
    },
    addEventListener: () => { calls.addEventListener += 1; },
    removeEventListener() {},
    dispatchEvent() {},
    getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
    documentElement: { appendChild() {}, removeChild() {} },
    activeElement: null,
  };

  const localStorage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  };

  const windowObj = {
    addEventListener: () => { calls.addEventListener += 1; },
    removeEventListener() {},
    setInterval: setIntervalStub,
    setTimeout: setTimeoutStub,
    clearInterval() {},
    clearTimeout() {},
    localStorage,
    location: { pathname: slug ? `/${slug}/` : "/about/", search: "" },
    navigator: { userAgent: "" },
    document,
    dispatchEvent() {},
    KLog: { log() {} },
  };

  const sandbox = {
    console,
    Date,
    performance: { now: () => Date.now() },
    setInterval: setIntervalStub,
    setTimeout: setTimeoutStub,
    clearInterval: () => {},
    clearTimeout: () => {},
    location: windowObj.location,
    document,
    navigator: windowObj.navigator,
    localStorage,
    window: windowObj,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Blob: class {},
    URL: { createObjectURL() { return ""; }, revokeObjectURL() {} },
    requestAnimationFrame: () => {},
    cancelAnimationFrame: () => {},
  };
  sandbox.window.window = windowObj;

  vm.createContext(sandbox);
  const comboSrc = await fs.readFile(new URL("../js/xp/combo.js", import.meta.url), "utf8");
  const scoringSrc = await fs.readFile(new URL("../js/xp/scoring.js", import.meta.url), "utf8");
  const coreSrc = await fs.readFile(new URL("../js/xp/core.js", import.meta.url), "utf8");
  const src = await fs.readFile(new URL("../js/xp.js", import.meta.url), "utf8");
  vm.runInContext(comboSrc, sandbox, { filename: "xp/combo.js" });
  vm.runInContext(scoringSrc, sandbox, { filename: "xp/scoring.js" });
  vm.runInContext(coreSrc, sandbox, { filename: "xp/core.js" });
  vm.runInContext(src, sandbox, { filename: "xp.js" });

  return calls;
}

(async () => {
  {
    const calls = await runXpWithDom({ hasHostAttr: false, slug: "" });
    assert.equal(
      calls.addEventListener + calls.setInterval + calls.setTimeout,
      0,
      "xp.js MUST NOT wire listeners or timers on non-host pages",
    );
  }

  {
    const calls = await runXpWithDom({ hasHostAttr: true, slug: "" });
    assert.ok(
      calls.addEventListener + calls.setInterval + calls.setTimeout > 0,
      "xp.js SHOULD wire when the page is marked as a host",
    );
  }

  {
    const calls = await runXpWithDom({ hasHostAttr: false, slug: "tetris" });
    assert.ok(
      calls.addEventListener + calls.setInterval + calls.setTimeout > 0,
      "xp.js SHOULD wire when slug fallback marks a direct game page",
    );
  }

  console.log("xp-gate.test.mjs: PASS");
})();
