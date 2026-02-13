import { spawnSync } from "node:child_process";
import "../tests/_setup/poker-deal-secret.mjs";

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
run("node", ["tests/xp-caps.nextReset.test.mjs"], "xp-caps-nextReset");
run("node", ["tests/xp-client-bfcache.test.mjs"], "xp-client-bfcache");
run("node", ["tests/xp-client.cors.test.mjs"], "xp-client-cors");
run("node", ["tests/xp-gate.test.mjs"], "xp-gate");
run("node", ["tests/xp-game-hook-idempotent.test.mjs"], "xp-game-hook-idempotent");
run("node", ["tests/recorder-admin-only.test.mjs"], "recorder-admin-only");
run("node", ["tests/secureStorage.test.mjs"], "secure-storage");
run("node", ["tests/favorites-service.test.mjs"], "favorites-service");
run("node", ["tests/poker-stakes.test.mjs"], "poker-stakes");
run("node", ["tests/poker-bots.unit.test.mjs"], "poker-bots-unit");
run("node", ["tests/poker-stakes-ui.test.mjs"], "poker-stakes-ui");
run("node", ["tests/poker-create-table.stakes.test.mjs"], "poker-create-table-stakes");
run("node", ["tests/poker-phase1.test.mjs"], "poker-phase1");
run("node", ["tests/poker-engine.test.mjs"], "poker-engine");
run("node", ["tests/poker-eval.test.mjs"], "poker-eval");
run("node", ["tests/poker-cards-utils.test.mjs"], "poker-cards-utils");
run("node", ["tests/poker-hole-cards-store.test.mjs"], "poker-hole-cards-store");
run("node", ["tests/poker-contract.phase1.test.mjs"], "poker-contract-phase1");
run("node", ["tests/poker-db-lockdown.contract.test.mjs"], "poker-db-lockdown");
run("node", ["tests/poker-hole-cards.rls.test.mjs"], "poker-hole-cards-rls");
run("node", ["tests/poker-rls.read.test.mjs"], "poker-rls-read");
run("node", ["tests/poker-reducer.test.mjs"], "poker-reducer");
run("node", ["tests/poker-leave.test.mjs"], "poker-leave");
run("node", ["tests/poker-join.test.mjs"], "poker-join");
run("node", ["tests/poker-sweep.test.mjs"], "poker-sweep");
run("node", ["tests/poker-invariants.test.mjs"], "poker-invariants");
run("node", ["tests/poker-leave.behavior.test.mjs"], "poker-leave-behavior");
run("node", ["tests/poker-join.behavior.test.mjs"], "poker-join-behavior");
run("node", ["tests/poker-join.bot-seed.behavior.test.mjs"], "poker-join-bot-seed");
run("node", ["tests/poker-heartbeat.behavior.test.mjs"], "poker-heartbeat-behavior");
run("node", ["tests/poker-start-hand.behavior.test.mjs"], "poker-start-hand-behavior");
run("node", ["tests/poker-start-hand.legacy-init-upgrade.test.mjs"], "poker-start-hand-legacy-init-upgrade");
run("node", ["tests/poker-act.behavior.test.mjs"], "poker-act-behavior");
run("node", ["tests/poker-act.init-phase.test.mjs"], "poker-act-init-phase");
run("node", ["tests/poker-sweep.behavior.test.mjs"], "poker-sweep-behavior");
run("node", ["tests/poker-sweep.cashout-authoritative.behavior.test.mjs"], "poker-sweep-cashout-authoritative");
run("node", ["tests/poker-get-table.behavior.test.mjs"], "poker-get-table-behavior");
run("node", ["tests/poker-get-table.bot-fields.behavior.test.mjs"], "poker-get-table-bot-fields-behavior");
run("node", ["tests/poker-materialize-settlement.payouts.test.mjs"], "poker-materialize-settlement-payouts");

try { run("npm", ["run", "-s", "lint:games"], "unit"); } catch { /* optional */ }

if (has("CLI")) {
  try { run("npm", ["run", "-s", "test:cli"], "cli"); } catch { console.warn("⚠ no test:cli"); }
}

if (has("PLAYWRIGHT")) {
  // your project already has prepare/run helpers
  run("node", ["scripts/prepare-playwright.js"], "pw:prepare");
  run("node", ["scripts/run-e2e.js"], "pw:e2e");
}
