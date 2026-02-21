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
run("node", ["tests/docs.poker-bots.test.mjs"], "docs-poker-bots");
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
run("node", ["tests/poker-create-table.stakes.test.mjs"], "poker-create-table-stakes");
run("node", ["tests/poker-phase1.test.mjs"], "poker-phase1");
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
run("node", ["tests/poker-leave.test.mjs"], "poker-leave");
run("node", ["tests/poker-join.test.mjs"], "poker-join");
run("node", ["tests/poker-sweep.test.mjs"], "poker-sweep");
run("node", ["tests/poker-invariants.test.mjs"], "poker-invariants");
run("node", ["tests/poker-leave.behavior.test.mjs"], "poker-leave-behavior");
run("node", ["tests/poker-join.behavior.test.mjs"], "poker-join-behavior");
run("node", ["tests/poker-join.seat-domain.behavior.test.mjs"], "poker-join-seat-domain-behavior");
run("node", ["tests/poker-join.rejoin-seat-logging.behavior.test.mjs"], "poker-join-rejoin-seat-logging-behavior");
run("node", ["tests/poker-join.bot-seed.behavior.test.mjs"], "poker-join-bot-seed");
run("node", ["tests/poker-join.bot-leave-after-hand.behavior.test.mjs"], "poker-join-bot-leave-after-hand");
run("node", ["tests/poker-heartbeat.behavior.test.mjs"], "poker-heartbeat-behavior");
run("node", ["tests/poker-start-hand.behavior.test.mjs"], "poker-start-hand-behavior");
run("node", ["tests/poker-start-hand.bots.behavior.test.mjs"], "poker-start-hand-bots-behavior");
run("node", ["tests/poker-start-hand.bot-autoplay.behavior.test.mjs"], "poker-start-hand-bot-autoplay-behavior");
run("node", ["tests/poker-start-hand.bot-autoplay.requestid.behavior.test.mjs"], "poker-start-hand-bot-autoplay-requestid-behavior");
run("node", ["tests/poker-start-hand.idempotency.replay.returns-stored.behavior.test.mjs"], "poker-start-hand-idempotency-replay-returns-stored-behavior");
run("node", ["tests/poker-start-hand.bot-autoplay-advance.behavior.test.mjs"], "poker-start-hand-bot-autoplay-advance-behavior");
run("node", ["tests/poker-start-hand.bot-autoplay.last-action-requestid.behavior.test.mjs"], "poker-start-hand-bot-autoplay-last-action-requestid-behavior");
run("node", ["tests/poker-start-hand.seat-stacks.behavior.test.mjs"], "poker-start-hand-seat-stacks-behavior");
run("node", ["tests/poker-start-hand.legal-actions.behavior.test.mjs"], "poker-start-hand-legal-actions-behavior");
run("node", ["tests/poker-start-hand.short-stack-blind.behavior.test.mjs"], "poker-start-hand-short-stack-blind-behavior");
run("node", ["tests/poker-start-hand.legacy-init-upgrade.test.mjs"], "poker-start-hand-legacy-init-upgrade");
run("node", ["tests/poker-act.behavior.test.mjs"], "poker-act-behavior");
run("node", ["tests/poker-act.load.no-duplicate-helpers.behavior.test.mjs"], "poker-act-load-no-duplicate-helpers-behavior");
run("node", ["tests/poker-act.bot-autoplay.behavior.test.mjs"], "poker-act-bot-autoplay-behavior");
run("node", ["tests/poker-act.bot-autoplay.timeout-applied.behavior.test.mjs"], "poker-act-bot-autoplay-timeout-applied-behavior");
run("node", ["tests/poker-act.bot-autoplay.multi-human-requests.behavior.test.mjs"], "poker-act-bot-autoplay-multi-human-requests-behavior");
run("node", ["tests/poker-act.bot-autoplay.last-action-requestid.behavior.test.mjs"], "poker-act-bot-autoplay-last-action-requestid-behavior");
run("node", ["tests/poker-act.bot-autoplay.compile.behavior.test.mjs"], "poker-act-bot-autoplay-compile-behavior");
run("node", ["tests/poker-act.bot-autoplay-stop-reason.behavior.test.mjs"], "poker-act-bot-autoplay-stop-reason-behavior");
run("node", ["tests/poker-bots.leave-after-hand-evicted-on-settle.behavior.test.mjs"], "poker-bots-leave-after-hand-evicted-on-settle");
run("node", ["tests/poker-act.init-phase.test.mjs"], "poker-act-init-phase");
run("node", ["tests/poker-sweep.behavior.test.mjs"], "poker-sweep-behavior");
run("node", ["tests/poker-sweep.timeout-zero-amount-inactivates-seat.behavior.test.mjs"], "poker-sweep-timeout-zero-inactivate");
run("node", ["tests/poker-sweep.bot-cashout-on-timeout.behavior.test.mjs"], "poker-sweep-bot-cashout-on-timeout-behavior");
run("node", ["tests/poker-sweep.bot-timeout-forces-inactive-even-if-helper-noop.behavior.test.mjs"], "poker-sweep-bot-timeout-force-inactive-helper-noop");
run("node", ["tests/poker-sweep.bot-timeout-skips-when-actor-missing.behavior.test.mjs"], "poker-sweep-bot-timeout-skips-when-actor-missing");
run("node", ["tests/poker-sweep.bot-timeout-invalid-botUserId-does-not-crash.behavior.test.mjs"], "poker-sweep-bot-timeout-invalid-botuserid-no-crash");
run("node", ["tests/poker-sweep.bot-cashout-on-close.behavior.test.mjs"], "poker-sweep-bot-cashout-on-close-behavior");
run("node", ["tests/poker-sweep.bot-close-cashes-out-using-state-when-seat-zero.behavior.test.mjs"], "poker-sweep-bot-close-cashout-state-when-seat-zero");
run("node", ["tests/poker-sweep.bot-close-rechecks-status-after-inactivate.behavior.test.mjs"], "poker-sweep-bot-close-recheck-status-after-inactivate");
run("node", ["tests/poker-sweep.bot-close-skips-when-actor-missing.behavior.test.mjs"], "poker-sweep-bot-close-skips-when-actor-missing");
run("node", ["tests/poker-sweep.bot-close-invalid-tableId-skips.behavior.test.mjs"], "poker-sweep-bot-close-invalid-tableid-skips");
run("node", ["tests/poker-sweep.bot-close-does-not-clear-state-when-not-safe.behavior.test.mjs"], "poker-sweep-bot-close-no-clear-when-not-safe");
run("node", ["tests/poker-sweep.close-empty-table-counts-skipped.behavior.test.mjs"], "poker-sweep-close-empty-table-counts-skipped");
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
