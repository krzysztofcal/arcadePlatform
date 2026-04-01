import { spawnSync } from "node:child_process";
import "../tests/_setup/poker-deal-secret.mjs";

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.XP_TEST_MODE = "1";

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
run("node", ["tests/store-upstash.force-memory-test-mode.behavior.test.mjs"], "store-upstash-force-memory-test-mode");
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
run("node", ["tests/poker-bot-cashout.active-seat.unit.test.mjs"], "poker-bot-cashout-active-seat-unit");
run("node", ["tests/poker-bot-cashout.invalid-seatno.unit.test.mjs"], "poker-bot-cashout-invalid-seatno-unit");
run("node", ["tests/poker-bot-cashout.userId-is-bot.unit.test.mjs"], "poker-bot-cashout-userid-is-bot-unit");
run("node", ["tests/poker-bot-cashout.invalid-actor.unit.test.mjs"], "poker-bot-cashout-invalid-actor-unit");
run("node", ["tests/poker-bot-cashout.invalid-idempotency-suffix.unit.test.mjs"], "poker-bot-cashout-invalid-idempotency-suffix-unit");
run("node", ["tests/poker-bot-cashout.invalid-table-id.unit.test.mjs"], "poker-bot-cashout-invalid-table-id-unit");
run("node", ["tests/poker-bot-cashout.invalid-bot-user-id.unit.test.mjs"], "poker-bot-cashout-invalid-bot-user-id-unit");
run("node", ["tests/poker-bot-cashout.seat-missing.unit.test.mjs"], "poker-bot-cashout-seat-missing-unit");
run("node", ["tests/poker-bot-cashout.not-bot.unit.test.mjs"], "poker-bot-cashout-not-bot-unit");
run("node", ["tests/chips-ledger.escrow-only.null-user.unit.test.mjs"], "chips-ledger-escrow-only-null-user");
run("node", ["tests/chips-ledger.human.buyin.unit.test.mjs"], "chips-ledger-human-buyin");
run("node", ["tests/poker-stakes-ui.test.mjs"], "poker-stakes-ui");
run("node", ["tests/poker-ws-client.test.mjs"], "poker-ws-client");
run("node", ["tests/poker-csp-ws-allowlist.test.mjs"], "poker-csp-ws-allowlist");
run("node", ["ws-tests/ws-mint-token.test.mjs"], "ws-mint-token");
run("node", ["ws-tests/ws-table-state-payload.test.mjs"], "ws-table-state-payload");
run("node", ["tests/poker-ws-presence-mapping.test.mjs"], "poker-ws-presence-mapping");
run("node", ["tests/poker-ws-presence-race.behavior.test.mjs"], "poker-ws-presence-race-behavior");
run("node", ["tests/poker-ws-rich-snapshot.behavior.test.mjs"], "poker-ws-rich-snapshot-behavior");
run("node", ["tests/poker-ws-authoritative-seat-bootstrap.behavior.test.mjs"], "poker-ws-authoritative-seat-bootstrap-behavior");
run("node", ["tests/poker-create-table.stakes.test.mjs"], "poker-create-table-stakes");
run("node", ["tests/poker-engine.test.mjs"], "poker-engine");
run("node", ["tests/poker-eval.test.mjs"], "poker-eval");
run("node", ["tests/poker-cards-utils.test.mjs"], "poker-cards-utils");
run("node", ["tests/poker-hole-cards-store.test.mjs"], "poker-hole-cards-store");
run("node", ["tests/poker-contract.phase1.test.mjs"], "poker-contract-phase1");
run("node", ["tests/poker-db-lockdown.contract.test.mjs"], "poker-db-lockdown");
run("node", ["tests/poker-hole-cards.rls.test.mjs"], "poker-hole-cards-rls");
run("node", ["tests/poker-hole-cards.allow-bots.contract.test.mjs"], "poker-hole-cards-allow-bots-contract");
run("node", ["tests/poker-rls.read.test.mjs"], "poker-rls-read");
run("node", ["tests/poker-reducer.test.mjs"], "poker-reducer");
run("node", ["tests/poker-reducer.left-player.applyAction.invalid-player.unit.test.mjs"], "poker-reducer-left-player-invalid-player-unit");
run("node", ["tests/poker-handSeats-routing.behavior.test.mjs"], "poker-handseats-routing-behavior");
run("node", ["tests/poker-handSeats.left-player.excluded.behavior.test.mjs"], "poker-handseats-left-player-excluded-behavior");
run("node", ["tests/poker-handSeats-seats-undefined.behavior.test.mjs"], "poker-handseats-seats-undefined-behavior");
run("node", ["tests/poker-handSeats-reset.behavior.test.mjs"], "poker-handseats-reset-behavior");
run("node", ["tests/poker-legal-actions.left-player.invalid-player.behavior.test.mjs"], "poker-legal-actions-left-player-invalid-player-behavior");
run("node", ["shared/poker-domain/leave.behavior.test.mjs"], "poker-domain-leave-behavior");
run("node", ["shared/poker-domain/inactive-cleanup.behavior.test.mjs"], "poker-domain-inactive-cleanup-behavior");
run("node", ["tests/poker-invariants.test.mjs"], "poker-invariants");
run("node", ["tests/poker-inactive-cleanup.behavior.test.mjs"], "poker-inactive-cleanup-behavior");
run("node", ["tests/poker-bots.leave-after-hand-evicted-on-settle.behavior.test.mjs"], "poker-bots-leave-after-hand-evicted-on-settle");
run("node", ["tests/poker-materialize-settlement.payouts.test.mjs"], "poker-materialize-settlement-payouts");

run("node", ["tests/poker-ui.behavior.test.mjs"], "poker-ui-behavior");
run("node", ["tests/poker-ui-turn-actions.test.mjs"], "poker-ui-turn-actions");
run("node", ["tests/poker-ui-amount-actions-dom.behavior.test.mjs"], "poker-ui-amount-actions-dom-behavior");
run("node", ["tests/poker-ui-ws-join-smoke.behavior.test.mjs"], "poker-ui-ws-join-smoke-behavior");
run("node", ["tests/poker-ui-ws-write-path.guard.test.mjs"], "poker-ui-ws-write-path-guard");
run("node", ["tests/poker-ui-no-heartbeat.guard.test.mjs"], "poker-ui-no-heartbeat-guard");
run("node", ["ws-server/poker/persistence/inactive-cleanup-adapter.behavior.test.mjs"], "ws-inactive-cleanup-adapter-behavior");
run("node", ["ws-server/poker/runtime/disconnect-cleanup.behavior.test.mjs"], "ws-disconnect-cleanup-runtime-behavior");
run("node", ["ws-server/poker/runtime/accepted-bot-autoplay-adapter.behavior.test.mjs"], "ws-accepted-bot-autoplay-adapter-behavior");
run("node", ["tests/poker-ui-ws-leave-smoke.behavior.test.mjs"], "poker-ui-ws-leave-smoke-behavior");
run("node", ["ws-tests/ws-lobby-join-public-snapshot.behavior.test.mjs"], "ws-lobby-join-public-snapshot-behavior");
run("node", ["tests/i18n.behavior.test.mjs"], "i18n-behavior");
run("node", ["tests/static-html.behavior.test.mjs"], "static-html-behavior");
run("node", ["tests/poker-ui-stopPendingAll.guard.test.mjs"], "poker-ui-stopPendingAll-guard");
run("node", ["tests/test-all.runner-registration.guard.test.mjs"], "test-all-runner-registration-guard");
run("node", ["tests/poker-runtime-docs.behavior.test.mjs"], "poker-runtime-docs-behavior");
run("node", ["tests/poker-http-retired-contract.guard.test.mjs"], "poker-http-retired-contract-guard");
run("node", ["tests/poker-ui-requestid-retry.guard.test.mjs"], "poker-ui-requestid-retry-guard");
run("node", ["tests/poker-requestid-helper.guard.test.mjs"], "poker-requestid-helper-guard");
run("node", ["tests/poker-idempotency-scope.guard.test.mjs"], "poker-idempotency-scope-guard");
run("node", ["tests/poker-workflows.playwright-install.guard.test.mjs"], "poker-workflows-playwright-install-guard");
run("node", ["tests/poker-workflows.no-http-sweep.guard.test.mjs"], "poker-workflows-no-http-sweep-guard");

try { run("npm", ["run", "-s", "lint:games"], "unit"); } catch { /* optional */ }

if (has("CLI")) {
  try { run("npm", ["run", "-s", "test:cli"], "cli"); } catch { console.warn("⚠ no test:cli"); }
}

if (has("PLAYWRIGHT")) {
  // your project already has prepare/run helpers
  run("node", ["scripts/prepare-playwright.js"], "pw:prepare");
  run("node", ["scripts/run-e2e.js"], "pw:e2e");
}
