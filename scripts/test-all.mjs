import { spawnSync } from "node:child_process";
import "../tests/_setup/poker-deal-secret.mjs";

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.XP_TEST_MODE = "1";
process.env.XP_CORS_ALLOW = process.env.XP_CORS_ALLOW || [
  "https://arcade.test",
  "https://example.test",
  "https://play.kcswh.pl",
  "https://deploy-preview-123--mysite.netlify.app",
  "http://127.0.0.1:4173",
].join(",");

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
run("node", ["tests/xp-policy.test.mjs"], "xp-policy");
run("node", ["tests/xp-award-input.behavior.test.mjs"], "xp-award-input-behavior");
run("node", ["tests/xp-server-migration-notice.test.mjs"], "xp-server-migration-notice");
run("node", ["tests/xp-core-authoritative-reset.test.mjs"], "xp-core-authoritative-reset");
run("node", ["tests/xp-game-hook.test.mjs"], "xp-game-hook");
run("node", ["tests/xp-badge.test.mjs"], "xp-badge");
run("node", ["tests/xp-multigame.test.mjs"], "xp-multigame");
run("node", ["tests/store-upstash.force-memory-test-mode.behavior.test.mjs"], "store-upstash-force-memory-test-mode");
run("node", ["scripts/check-xp-authoritative-transport.mjs"], "xp-authoritative-transport");
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
run("node", ["tests/poker-bot-cashout.userId-is-bot.unit.test.mjs"], "poker-bot-cashout-userid-is-bot-unit");
run("node", ["tests/chips-ledger.escrow-only.null-user.unit.test.mjs"], "chips-ledger-escrow-only-null-user");
run("node", ["tests/chips-ledger.human.buyin.unit.test.mjs"], "chips-ledger-human-buyin");
run("node", ["tests/chips-ledger-pagination.behavior.test.mjs"], "chips-ledger-pagination-behavior");
run("node", ["tests/welcome-bonus.behavior.test.mjs"], "welcome-bonus-behavior");
run("node", ["tests/bonus-campaigns-endpoint.behavior.test.mjs"], "bonus-campaigns-endpoint-behavior");
run("node", ["tests/bonus-campaigns-scheduler.behavior.test.mjs"], "bonus-campaigns-scheduler-behavior");
run("node", ["tests/poker-stakes-ui.test.mjs"], "poker-stakes-ui");
run("node", ["tests/poker-ws-client.test.mjs"], "poker-ws-client");
run("node", ["tests/poker-csp-ws-allowlist.test.mjs"], "poker-csp-ws-allowlist");
run("node", ["ws-tests/ws-mint-token.test.mjs"], "ws-mint-token");
run("node", ["ws-tests/ws-table-state-payload.test.mjs"], "ws-table-state-payload");
run("node", ["tests/poker-create-table.stakes.test.mjs"], "poker-create-table-stakes");
run("node", ["tests/poker-engine.test.mjs"], "poker-engine");
run("node", ["tests/poker-eval.test.mjs"], "poker-eval");
run("node", ["tests/poker-cards-utils.test.mjs"], "poker-cards-utils");
run("node", ["tests/poker-hole-cards-store.test.mjs"], "poker-hole-cards-store");
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
run("node", ["shared/poker-domain/deferred-leave-finalization.behavior.test.mjs"], "poker-domain-deferred-leave-finalization-behavior");
run("node", ["shared/poker-domain/human-stack-accounting.behavior.test.mjs"], "poker-domain-human-stack-accounting-behavior");
run("node", ["shared/poker-domain/rebuy.behavior.test.mjs"], "poker-domain-rebuy-behavior");
run("node", ["shared/poker-domain/inactive-cleanup.behavior.test.mjs"], "poker-domain-inactive-cleanup-behavior");
run("node", ["tests/poker-inactive-cleanup.behavior.test.mjs"], "poker-inactive-cleanup-behavior");
run("node", ["tests/poker-materialize-settlement.payouts.test.mjs"], "poker-materialize-settlement-payouts");
run("node", ["tests/poker-dead-money-settlement.behavior.test.mjs"], "poker-dead-money-settlement-behavior");

run("node", ["tests/poker-ui.behavior.test.mjs"], "poker-ui-behavior");
run("node", ["tests/poker-settlement-presentation.unit.test.mjs"], "poker-settlement-presentation-unit");
run("node", ["tests/poker-v2-live.behavior.test.mjs"], "poker-v2-live-behavior");
run("node", ["ws-server/poker/persistence/inactive-cleanup-adapter.behavior.test.mjs"], "ws-inactive-cleanup-adapter-behavior");
run("node", ["ws-server/poker/persistence/deferred-leave-finalization-adapter.behavior.test.mjs"], "ws-deferred-leave-finalization-adapter-behavior");
run("node", ["ws-server/poker/persistence/persisted-state-writer.behavior.test.mjs"], "ws-persisted-state-writer-behavior");
run("node", ["ws-server/poker/idempotency/action-command.behavior.test.mjs"], "ws-action-command-idempotency-behavior");
run("node", ["ws-server/poker/persistence/authoritative-rebuy-adapter.behavior.test.mjs"], "ws-authoritative-rebuy-adapter-behavior");
run("node", ["ws-server/poker/handlers/rebuy.behavior.test.mjs"], "ws-rebuy-handler-behavior");
run("node", ["ws-server/poker/runtime/disconnect-cleanup.behavior.test.mjs"], "ws-disconnect-cleanup-runtime-behavior");
run("node", ["ws-server/poker/runtime/table-janitor.behavior.test.mjs"], "ws-table-janitor-behavior");
run("node", ["ws-server/poker/runtime/accepted-bot-autoplay-adapter.behavior.test.mjs"], "ws-accepted-bot-autoplay-adapter-behavior");
run("node", ["ws-tests/ws-lobby-join-public-snapshot.behavior.test.mjs"], "ws-lobby-join-public-snapshot-behavior");
run("node", ["tests/admin-auth.behavior.test.mjs"], "admin-auth-behavior");
run("node", ["tests/admin-endpoints.behavior.test.mjs"], "admin-endpoints-behavior");
run("node", ["tests/admin-ledger-adjust.behavior.test.mjs"], "admin-ledger-adjust-behavior");
run("node", ["tests/admin-users-list.behavior.test.mjs"], "admin-users-list-behavior");
run("node", ["tests/admin-bonus-campaigns.behavior.test.mjs"], "admin-bonus-campaigns-behavior");
run("node", ["tests/admin-tables-list.behavior.test.mjs"], "admin-tables-list-behavior");
run("node", ["tests/admin-ledger-list.behavior.test.mjs"], "admin-ledger-list-behavior");
run("node", ["tests/admin-table-actions.behavior.test.mjs"], "admin-table-actions-behavior");
run("node", ["tests/admin-ops-summary.behavior.test.mjs"], "admin-ops-summary-behavior");
run("node", ["tests/admin-stage-identity.behavior.test.mjs"], "admin-stage-identity-behavior");
run("node", ["tests/admin-page.contract.test.mjs"], "admin-page-contract");
run("node", ["tests/admin-page.behavior.test.mjs"], "admin-page-behavior");
run("node", ["tests/admin-user-search.behavior.test.mjs"], "admin-user-search-behavior");
run("node", ["tests/public-profiles.behavior.test.mjs"], "public-profiles-behavior");
run("node", ["tests/profile-avatar.behavior.test.mjs"], "profile-avatar-behavior");
run("node", ["tests/public-profile-xp.e2e.test.mjs"], "public-profile-xp-e2e");
run("node", ["tests/public-profile-ui.contract.test.mjs"], "public-profile-ui-contract");
run("node", ["tests/user-ui-state.behavior.test.mjs"], "user-ui-state-behavior");
run("node", ["tests/chips-client-cache.behavior.test.mjs"], "chips-client-cache-behavior");
run("node", ["tests/home-bonuses.contract.test.mjs"], "home-bonuses-contract");
run("node", ["tests/account-auth.contract.test.mjs"], "account-auth-contract");
run("node", ["tests/xp-ledger.behavior.test.mjs"], "xp-ledger-behavior");
run("node", ["tests/xp-leaderboard-foundation.behavior.test.mjs"], "xp-leaderboard-foundation-behavior");
run("node", ["tests/xp-leaderboard-maintenance.behavior.test.mjs"], "xp-leaderboard-maintenance-behavior");
run("node", ["tests/xp-leaderboard-api.behavior.test.mjs"], "xp-leaderboard-api-behavior");
run("node", ["tests/leaderboard-ui.contract.test.mjs"], "leaderboard-ui-contract");
run("node", ["tests/sidebar-admin-visibility.behavior.test.mjs"], "sidebar-admin-visibility-behavior");
run("node", ["tests/i18n.behavior.test.mjs"], "i18n-behavior");
run("node", ["tests/static-html.behavior.test.mjs"], "static-html-behavior");
run("node", ["tests/csp-inline-hashes.behavior.test.mjs"], "csp-inline-hashes-behavior");
run("node", ["tests/test-all.runner-registration.guard.test.mjs"], "test-all-runner-registration-guard");
run("node", ["tests/poker-runtime-docs.behavior.test.mjs"], "poker-runtime-docs-behavior");
run("node", ["tests/poker-http-retired-contract.guard.test.mjs"], "poker-http-retired-contract-guard");
run("node", ["tests/poker-get-table-retired-implementation.guard.test.mjs"], "poker-get-table-retired-implementation-guard");
run("node", ["tests/poker-http-tooling-retired.guard.test.mjs"], "poker-http-tooling-retired-guard");
run("node", ["tests/poker-requestid-helper.guard.test.mjs"], "poker-requestid-helper-guard");
run("node", ["tests/poker-idempotency-scope.guard.test.mjs"], "poker-idempotency-scope-guard");
run("node", ["tests/poker-workflows.playwright-install.guard.test.mjs"], "poker-workflows-playwright-install-guard");
run("node", ["tests/poker-workflows.no-http-sweep.guard.test.mjs"], "poker-workflows-no-http-sweep-guard");
run("node", ["tests/db-stage-workflows.guard.test.mjs"], "db-stage-workflows-guard");
run("node", ["tests/chips-economy-reset-cli.contract.test.mjs"], "chips-economy-reset-cli-contract");
run("node", ["tests/ch-economy-network-maintenance.behavior.test.mjs"], "ch-economy-network-maintenance-behavior");

try { run("npm", ["run", "-s", "lint:games"], "unit"); } catch { /* optional */ }

if (has("CLI")) {
  try { run("npm", ["run", "-s", "test:cli"], "cli"); } catch { console.warn("⚠ no test:cli"); }
}

if (has("PLAYWRIGHT")) {
  // your project already has prepare/run helpers
  run("node", ["scripts/prepare-playwright.js"], "pw:prepare");
  run("node", ["scripts/run-e2e.js"], "pw:e2e");
}
