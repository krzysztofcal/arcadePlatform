# Implementation plan — #1042

Accepted architecture and task sequence: spec.md (live issue #1042), parent #786. Baseline origin/main: 4f798bdd56dba0e11b34e8982895650920ec6944.

## Constitution Check

PASS: only fundamental deterministic accounting/domain/WS tests (T010/T011). No UI/CSS/JSP/glue tests, dependencies, tooling cleanup or generic framework. JSP globals; klog only; CSS one physical line per selector. WS owns gameplay; gifts do not change gameplay/ESCROW/settlement/bot bankroll/progression/recipient CH.

## Reconciliation

The WS table ledger wrapper is specialized for table lifecycle. Use the canonical netlify/functions/_shared/chips-ledger.mjs::postTransaction with the same tx; current WS deployment already packages that ledger and root shared/poker-domain. No wrapper ledger extension or deployment configuration change needed.

## Rollout

Publishing supabase/migrations intentionally permits DB Stage Apply PR to create only empty receipts/indexes/RLS, with zero CH/data mutations. Prepare Production-equivalent schema and exhaustive manifest; do not apply Production. Exact runtime-SHA WS Preview Deploy and mandatory authenticated Stage smoke are required; pending smoke means not merge-ready.

The exhaustive migration guard scripts/check-db-migrations.mjs hardcodes inventory/category counts. Update only these counts for the required new manifest entry (54 missing, 33 needs-production-equivalent); this exact tooling change is required by T003, not cleanup.

T012 requires registering the two focused gift suites in scripts/test-all.mjs and classifying the two gift diagnostics in ws-server/poker/observability/poker-log-policy.mjs. Existing vitest-only tests/chips-ledger.test.mjs is not runnable with installed repo dependencies; extend the existing Node canonical-ledger suite tests/chips-ledger.human.buyin.unit.test.mjs instead. Receipt migration constraints/RLS/indexes are exercised with existing PGlite in the focused domain suite; external migration DB suite remains gated by CHIPS_MIGRATIONS_TEST_DB_URL. No new framework/dependency.

Gift table/seat row locks use NOWAIT: current gameplay persistence can project seats before updating table activity. Reject a contended gift transaction immediately rather than creating table→seat vs seat→table lock waits. This preserves required validation/atomicity without changing gameplay locking. DB clock_timestamp after buyer advisory lock enforces cooldown; SQL to_char(joined_at) preserves microseconds. Gift recovery/broadcast uses a short per-table cosmetic promise chain separate from the gameplay queue. Every purchase is followed by authoritative aggregate state; storage errors return no recovery frame (never false empty state).

Review correction: the existing seat protocol does not expose joined_at. Keep it private and broadcast current receipt aggregates to all table connections after every accepted authenticated join (including same-user rejoin). This clears old participation badges even when an observer missed the intermediate absence. Browser clears disappeared/changed owners locally; DB exact participation joins remain final authority. Recovery is scheduled without awaiting it on gameplay lifecycle paths, and resume recovery follows replay frames.

The canonical ledger import is lazy after DB availability/auth validation, matching existing shared-domain adapters and keeping file-backed WS startup compatible with WS-package-only CI dependencies. Deploy packages already include root shared/ledger/dependencies.

Review P1 correction: only new purchases broadcast table_gift. Exact replay is accepted with current table_gift_state and no animation. This is a minimal WS fanout guard; canonical ledger/receipt idempotency remains unchanged, with no outbox or delivery framework.

## Manual smoke amendment implementation

T012A–C modify only table-v2.html, poker-v2.js, poker-v2.css and accessible copy in i18n.js. Group ordinary buttons with aria-pressed and native Tab/Enter/Space; keep selections inside existing Gift Shop DOM, reuse renderSeatAvatar and getDisplayName, reconcile recipient buttons from state.seats without a player cache. Preserve focus by retaining existing buttons on normal sync. Selection changes reset giftRetry; pending disables choices/send. Guest control is visible/locked with aria-disabled and click guard; authenticated availability remains existing. T012D is blocked on #1048, with no badge layout change. Constitution Check: no new UI/CSS/JSP test suites, dependencies, configuration or migration changes. Browser Deploy Preview inspection is required; no WS redeploy for presentation-only changes. Final T013 smoke follows #1048 integration, T014 remains owner-gated.

Preview reconciliation for T012C: applySignedOutState previously left the whole screen behind the boot splash. Call existing markBootReady after resolving signed-out identity so the locked control and existing sign-in message can be seen. No auth/gameplay/WS change.

T012B occupant review correction: reconcile by seatNo + userId on recipient buttons, not seat alone. Remove the obsolete occupant button, clear its selection/uncertain retry, build a new button for the replacement. Normal sync retains the same occupant button/focus but replaces the avatar span with a fresh element before calling unchanged renderSeatAvatar, so profile/style/data cannot leak. Retry invalidation is limited to the replaced/removed target seat; another seat changing must not discard a requestId after uncertain transport. No payload/backend/player-model changes.

## T012E no-self / Quick Gift amendment

Live main verified at 4f798bdd56dba0e11b34e8982895650920ec6944; no seat HUD gift/quick-action slot exists on main or #1047, no related HUD implementation PR found, #1048 remains open. E2 and T012D stay BLOCKED on #1048; no dormant Quick Gift UI, overlay or speculative purchase refactor. E1: after ACTIVE sender/recipient resolution reject matching user_id with existing gift_target_unavailable before postTransaction; browser giftEligibleSeats excludes isCurrentUserSeat. Keep receipt-first idempotent lookup and cooldown ordering unchanged (historical paid receipt replay remains accepted/state-only with no new debit/event). Replace prior self-purchase success case with focused zero-call/zero-BURN/zero-receipt self-rejection test. Constitution Check: only fundamental domain tests; no UI/CSS/JSP/dependency/migration/tooling changes. Shared WS dependency changes require a new exact-SHA WS Preview deployment with installed metadata and health checks. Final authenticated T013 follows T012D + completed T012E; Production T014 remains owner-gated.


## 2026-10-08 — Main integration plan

Integrate main `d49c33fa` into existing #1047. Preserve both seat name/transient cleanup operations in `renderSeats()`; bind gifts to `renderedSeatHud[seatNo].gifts` instead of cached avatar badge nodes. Keep every main CSS rule and add only scoped gift presentation. Reuse main HTML layers and `hud.quickAction`; share one `sendSelectedGift()` helper with existing purchase handling. Keep targeted-reaction content and pointer interaction intact. Maintain occupant identity reconciliation, authoritative summaries and replay suppression.

Review `ws-server/server.mjs` and log policy after textual auto-merge for retained message payload/backlog security, reconnect, janitor and lifecycle. No accounting, protocol or applied Stage SQL change. Verify existing Production inventory and remove unrelated JSON Unicode escaping churn. Constitution Check PASS: fundamental existing tests only, no new UI/CSS/JSP suites/dependencies/configuration changes; JSP globals/klog/CSS constraints preserved. WS test startup detection requires `WS_POKER_LOG_LEVEL=INFO`, matching WS CI, because current main defaults to ERROR. Complete checks, review and exact runtime-SHA Preview deployment; leave authenticated smoke/Production GO pending.
