import { spawnSync } from "node:child_process";

function run(cmd, args, name){
  const r = spawnSync(cmd, args, { stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    console.error(`✖ ${name} failed (exit ${r.status})`);
    process.exit(r.status || 1);
  }
  console.log(`✔ ${name} passed`);
}
const has = s => !!(process.env[s] && process.env[s] !== "0");

run("node", ["scripts/syntax-check.mjs"], "syntax");

run("node", ["tests/xp-client.test.mjs"], "xp-client");
run("node", ["tests/xp-client-contract.test.mjs"], "xp-client-contract");
run("node", ["tests/xp-game-hook.test.mjs"], "xp-game-hook");
run("node", ["tests/xp-badge.test.mjs"], "xp-badge");
run("node", ["tests/xp-multigame.test.mjs"], "xp-multigame");
run("node", ["tests/xp-award-delta.test.mjs"], "xp-award-delta");
run("node", ["tests/xp-award-session-daily.test.mjs"], "xp-award-session-daily");
run("node", ["tests/xp-award-legacy-fallback.test.mjs"], "xp-award-legacy-fallback");
run("node", ["tests/xp-award-drift.test.mjs"], "xp-award-drift");
run("node", ["tests/xp-client-bfcache.test.mjs"], "xp-client-bfcache");
run("node", ["tests/xp-client.cors.test.mjs"], "xp-client-cors");
run("node", ["tests/xp-gate.test.mjs"], "xp-gate");
run("node", ["tests/xp-game-hook-idempotent.test.mjs"], "xp-game-hook-idempotent");
run("node", ["tests/recorder-admin-only.test.mjs"], "recorder-admin-only");

try { run("npm", ["run", "-s", "lint:games"], "unit"); } catch { /* optional */ }

if (has("CLI")) {
  try { run("npm", ["run", "-s", "test:cli"], "cli"); } catch { console.warn("⚠ no test:cli"); }
}

if (has("PLAYWRIGHT")) {
  // your project already has prepare/run helpers
  run("node", ["scripts/prepare-playwright.js"], "pw:prepare");
  run("node", ["scripts/run-e2e.js"], "pw:e2e");
}
