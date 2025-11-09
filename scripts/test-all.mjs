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
run("node", ["tests/xp-game-hook.test.mjs"], "xp-game-hook");
run("node", ["tests/xp-multigame.test.mjs"], "xp-multigame");
run("node", ["tests/xp-award-score.test.mjs"], "xp-award-score");
run("node", ["tests/xp-award-score-rate.test.mjs"], "xp-award-score-rate");
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
