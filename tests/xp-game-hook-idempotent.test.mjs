import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

async function loadHookAndTrack() {
  let addListenerCount = 0;
  const document = {
    title: "T-Rex",
    readyState: "complete",
    body: {
      hasAttribute: (name) => (name === "data-game-host"),
      dataset: { gameId: "t-rex" },
      getAttribute: () => "t-rex",
    },
    addEventListener: () => { addListenerCount += 1; },
    removeEventListener: () => {},
  };

  const sandbox = {
    console,
    document,
    window: {
      document,
      addEventListener: () => { addListenerCount += 1; },
      removeEventListener: () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
      localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
      XP: {
        startSession() {},
        stopSession() {},
        addScore() {},
        isRunning() { return false; },
      },
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    navigator: {},
  };
  sandbox.window.window = sandbox.window;

  vm.createContext(sandbox);
  const src = await fs.readFile(new URL("../js/xp-game-hook.js", import.meta.url), "utf8");
  vm.runInContext(src, sandbox, { filename: "xp-game-hook.js" });

  const bridge = sandbox.window.GameXpBridge;
  assert.ok(bridge && typeof bridge.auto === "function", "GameXpBridge.auto must exist");

  const before = addListenerCount;
  bridge.auto("t-rex");
  const afterFirst = addListenerCount;
  assert.ok(afterFirst > before, "auto() should wire listeners on first call");

  bridge.auto("t-rex");
  const afterSecond = addListenerCount;
  assert.equal(afterSecond, afterFirst, "auto() should be idempotent and not add listeners twice");
}

(async () => {
  await loadHookAndTrack();
  console.log("xp-game-hook-idempotent.test.mjs: PASS");
})();
