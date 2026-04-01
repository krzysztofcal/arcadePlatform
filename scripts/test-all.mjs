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
run("node", ["tests/poker-ws-client.test.mjs"], "poker-ws-client");
run("node", ["tests/poker-csp-ws-allowlist.test.mjs"], "poker-csp-ws-allowlist");
run("node", ["ws-tests/ws-mint-token.test.mjs"], "ws-mint-token");
run("node", ["ws-tests/ws-table-state-payload.test.mjs"], "ws-table-state-payload");
run("node", ["tests/poker-ws-presence-mapping.test.mjs"], "poker-ws-presence-mapping");
run("node", ["tests/poker-ws-presence-race.behavior.test.mjs"], "poker-ws-presence-race-behavior");
run("node", ["tests/poker-ws-rich-snapshot.behavior.test.mjs"], "poker-ws-rich-snapshot-behavior");
run("node", ["tests/poker-ws-authoritative-seat-bootstrap.behavior.test.mjs"], "poker-ws-authoritative-seat-bootstrap-behavior");
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
run("node", ["tests/poker-reducer.left-player.applyAction.invalid-player.unit.test.mjs"], "poker-reducer-left-player-invalid-player-unit");
run("node", ["tests/poker-handSeats-routing.behavior.test.mjs"], "poker-handseats-routing-behavior");
run("node", ["tests/poker-handSeats.left-player.excluded.behavior.test.mjs"], "poker-handseats-left-player-excluded-behavior");
run("node", ["tests/poker-handSeats-seats-undefined.behavior.test.mjs"], "poker-handseats-seats-undefined-behavior");
run("node", ["tests/poker-handSeats-reset.behavior.test.mjs"], "poker-handseats-reset-behavior");
run("node", ["tests/poker-legal-actions.left-player.invalid-player.behavior.test.mjs"], "poker-legal-actions-left-player-invalid-player-behavior");
run("node", ["tests/poker-leave.test.mjs"], "poker-leave");
run("node", ["shared/poker-domain/leave.behavior.test.mjs"], "poker-domain-leave-behavior");
run("node", ["shared/poker-domain/inactive-cleanup.behavior.test.mjs"], "poker-domain-inactive-cleanup-behavior");
run("node", ["tests/poker-join-http-retired.test.mjs"], "poker-join-http-retired");
run("node", ["tests/poker-leave.instant-detach.midhand.behavior.test.mjs"], "poker-leave-instant-detach-midhand-behavior");
run("node", ["tests/poker-leave.instant-detach.replay-preserves-left-flag.behavior.test.mjs"], "poker-leave-instant-detach-replay-preserves-left-flag-behavior");
run("node", ["tests/poker-leave.instant-detach.no-resurrection.behavior.test.mjs"], "poker-leave-instant-detach-no-resurrection-behavior");
run("node", ["tests/poker-leave.cashout-only-uncommitted.behavior.test.mjs"], "poker-leave-cashout-only-uncommitted-behavior");
run("node", ["tests/poker-leave.active-hand.instant-detach.idempotent-replay.behavior.test.mjs"], "poker-leave-active-hand-instant-detach-idempotent-replay-behavior");
run("node", ["tests/poker-sweep.test.mjs"], "poker-sweep");
run("node", ["tests/poker-invariants.test.mjs"], "poker-invariants");
run("node", ["tests/poker-leave.behavior.test.mjs"], "poker-leave-behavior");
run("node", ["tests/poker-inactive-cleanup.behavior.test.mjs"], "poker-inactive-cleanup-behavior");
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
run("node", ["tests/poker-start-hand.stuck-showdown.recovers.behavior.test.mjs"], "poker-start-hand-stuck-showdown-recovers-behavior");
run("node", ["tests/poker-start-hand.hand-done.recovery-semantics.behavior.test.mjs"], "poker-start-hand-hand-done-recovery-semantics-behavior");
run("node", ["tests/poker-start-hand.leave-then-bots-finish.can-restart.behavior.test.mjs"], "poker-start-hand-leave-then-bots-finish-can-restart-behavior");
run("node", ["tests/poker-start-hand.recovery.init-shape.behavior.test.mjs"], "poker-start-hand-recovery-init-shape-behavior");
run("node", ["tests/poker-act.behavior.test.mjs"], "poker-act-behavior");
run("node", ["tests/poker-act.left-player.invalid-player.behavior.test.mjs"], "poker-act-left-player-invalid-player-behavior");
run("node", ["tests/poker-act.left-player.leave-table.idempotent-noop.behavior.test.mjs"], "poker-act-left-player-leave-table-idempotent-noop-behavior");
run("node", ["tests/poker-act.left-player.leave-table.noop-stores-once.behavior.test.mjs"], "poker-act-left-player-leave-table-noop-stores-once-behavior");
run("node", ["tests/poker-act.idempotency.stored-replay-sets-replayed-true.behavior.test.mjs"], "poker-act-idempotency-stored-replay-sets-replayed-true-behavior");
run("node", ["tests/poker-act.idempotency.stored-nonok-object.not-mutated.behavior.test.mjs"], "poker-act-idempotency-stored-nonok-object-not-mutated-behavior");
run("node", ["tests/poker-act.idempotency.claimed-status.proceeds.behavior.test.mjs"], "poker-act-idempotency-claimed-status-proceeds-behavior");
run("node", ["tests/poker-act.idempotency.pending-status.does-not-proceed.behavior.test.mjs"], "poker-act-idempotency-pending-status-does-not-proceed-behavior");
run("node", ["tests/poker-act.idempotency.pending-status.no-state-read.behavior.test.mjs"], "poker-act-idempotency-pending-status-no-state-read-behavior");
run("node", ["tests/poker-act.idempotency.pending-then-claimed.proceeds.behavior.test.mjs"], "poker-act-idempotency-pending-then-claimed-proceeds-behavior");
run("node", ["tests/poker-act.idempotency.unknown-status.rejected.behavior.test.mjs"], "poker-act-idempotency-unknown-status-rejected-behavior");
run("node", ["tests/poker-act.load.no-duplicate-helpers.behavior.test.mjs"], "poker-act-load-no-duplicate-helpers-behavior");
run("node", ["tests/poker-act.bot-autoplay.behavior.test.mjs"], "poker-act-bot-autoplay-behavior");
run("node", ["tests/poker-act.bot-autoplay.timeout-applied.behavior.test.mjs"], "poker-act-bot-autoplay-timeout-applied-behavior");
run("node", ["tests/poker-act.bot-autoplay.multi-human-requests.behavior.test.mjs"], "poker-act-bot-autoplay-multi-human-requests-behavior");
run("node", ["tests/poker-act.bot-autoplay.last-action-requestid.behavior.test.mjs"], "poker-act-bot-autoplay-last-action-requestid-behavior");
run("node", ["tests/poker-act.bot-autoplay.compile.behavior.test.mjs"], "poker-act-bot-autoplay-compile-behavior");
run("node", ["tests/poker-act.bot-autoplay-stop-reason.behavior.test.mjs"], "poker-act-bot-autoplay-stop-reason-behavior");
run("node", ["tests/poker-bots.leave-after-hand-evicted-on-settle.behavior.test.mjs"], "poker-bots-leave-after-hand-evicted-on-settle");
run("node", ["tests/poker-act.init-phase.test.mjs"], "poker-act-init-phase");
run("node", ["tests/poker-get-table.behavior.test.mjs"], "poker-get-table-behavior");
run("node", ["tests/poker-get-table.bot-fields.behavior.test.mjs"], "poker-get-table-bot-fields-behavior");
run("node", ["tests/poker-get-table.me-left-consistent.behavior.test.mjs"], "poker-get-table-me-left-consistent-behavior");
run("node", ["tests/poker-get-table.me-isSeated.db-shape.behavior.test.mjs"], "poker-get-table-me-isseated-db-shape-behavior");
run("node", ["tests/poker-get-table.me-notSeated.db-shape.behavior.test.mjs"], "poker-get-table-me-notseated-db-shape-behavior");
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
run("node", ["tests/poker-ui-requestid-retry.guard.test.mjs"], "poker-ui-requestid-retry-guard");
run("node", ["tests/poker-requestid-helper.guard.test.mjs"], "poker-requestid-helper-guard");
run("node", ["tests/poker-idempotency-scope.guard.test.mjs"], "poker-idempotency-scope-guard");
run("node", ["tests/poker-get-table-nonmutation.guard.test.mjs"], "poker-get-table-nonmutation-guard");
run("node", ["tests/poker-start-hand-storage.guard.test.mjs"], "poker-start-hand-storage-guard");
run("node", ["tests/poker-workflows.playwright-install.guard.test.mjs"], "poker-workflows-playwright-install-guard");

try { run("npm", ["run", "-s", "lint:games"], "unit"); } catch { /* optional */ }

if (has("CLI")) {
  try { run("npm", ["run", "-s", "test:cli"], "cli"); } catch { console.warn("⚠ no test:cli"); }
}

if (has("PLAYWRIGHT")) {
  // your project already has prepare/run helpers
  run("node", ["scripts/prepare-playwright.js"], "pw:prepare");
  run("node", ["scripts/run-e2e.js"], "pw:e2e");
}
