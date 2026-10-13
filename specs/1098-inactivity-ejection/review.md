# Independent review and validation — #1098

Independent subagent reviewed ledger/escrow, CAS/rollback, live claims, retry/recovery, timeout/action races, private protocol, reconnect and CONTINUOUS_BOT. Final verdict: APPROVE for Draft PR; no remaining blocking findings. Runtime/manual smoke still required.

Findings fixed: CLOSED deferred avatar projection; stale frames restoring own avatar; null deadline coercion; preflight pending evidence requiring seat OR stack OR ACTIVE owner row. Additional review approved durable terminal accounting failure retry through the existing slow rollover scheduler.

Fundamental evidence:
- Engine actual hand transitions/JSON restore: Online=2/SP=3, full 20s per decision, CHECK/FOLD counted, manual FOLD/CALL/CHECK reset, late action cannot reverse marker; missing raw deadline fails closed.
- Timeout handler: Leave callback only after successful persistence; conflict restores without ejection.
- Existing Leave handler: lost response reloads current persistence; retry does not repeat cash-out; failed Leave keeps claims/pending and stable request ID.
- Shared JOIN: both modes reject terminal marker before debit and preserve ledger/state.
- Real deferred finalizer + real terminal-close in existing accounting harness: escrow 3000 equals claims (human 940 + funded bots 710/1350); correct USER/SYSTEM refunds; CLOSED and escrow=0; second finalizer returns already_closed with unchanged three payouts. These are local deterministic fixtures, not Stage/Production accounting evidence.
- Private projection/snapshot: pending owned avatar non-actionable; confirmed detach removes avatar; CLOSED historical seats stay hidden; only owner receives persisted reason after reconnect. Preflight reload handles CLOSED Single Player and OPEN Online.
- Rollover accounting failure: remains SETTLED, does not persist next hand, queues existing retry; CONTINUOUS_BOT lifecycle preserved.

Local verification: npm test PASS (isolated test environment with external DB/service credential variables removed); focused critical suite 97/97, JOIN/timeout subset 89/89, progression endpoint 13/13, rollover/access 18/18, existing Leave behavioral script PASS. ci:guards, test:quick, test:unit and CSP hash guard PASS. check:all reports five pre-existing XP badge violations in unchanged design mockups (poker/designs/luxury-lobby/{index,landscape,portrait}.html, specs/1086-poker-felt/design/index.html, specs/792-premium-table-themes/design/index.html); relevant script and inputs identical to origin/main.

No new migrations/dependencies/frameworks/configuration/CSS/inline scripts. No deployment, funded environment checks, Production mutation or merge. Exact-SHA Preview and manual smoke pending owner GO.

Draft PR: https://github.com/krzysztofcal/arcadePlatform/pull/1099 (issue reference only, no automatic issue closure).
GitHub CI on initial runtime commit: core, WS persistence integration, disposable accounting/retention integration, Playwright, CodeQL, CI/actionlint, WS deployment validation and catalog all passed. WS PR harness identified missing registration of ws_inactivity_ejection_pending; fixed in existing WARN/recovery policy and locally reverified before final CI. Final head rollup is recorded in PR handoff. WS deploy and funded integration jobs skipped as intended. Netlify frontend Preview: https://deploy-preview-1099--playkcswh.netlify.app (WS still NOT deployed).

Final reconnect audit additionally removed the pre-existing clearInactivityPenalty calls from funded rejoin paths; actual JOIN regressions in both modes fail before the fix and pass after it, with counter=1 preserved and no debit. Existing FORCE_RESTRICTED rejoin test now verifies no inactivity state mutation. Shared JOIN suite: 83/83 PASS. A second CI run exposed an existing cleanup-test race (unsolicited pre-finalization snapshot); the fundamental WS test now waits for confirmed HAND_DONE/null turn, not membership disappearance, before checking terminal state. Runtime cleanup semantics were not changed for this test correction.

After the reconnect/cleanup-test correction, independent subagent again approved with no blocking findings. Complete local WS server harness: 140/140 PASS.

## Owner BLOCKED review corrections (base c47e1af)

- P1 alternate timeout: loadSnapshotInTx is now strictly read-only; removed timeout application/CAS/action audit writes and mutation-only derivation/imports. Online and Single Player expired-deadline snapshots retain version, turn, deadline, count and intent with zero writes, including repeated reads. Old HTTP timeout-parity behavior is intentionally retired; authoritative per-table queue remains the sole timeout writer. Snapshot dependency and log-catalog guards updated for removed dependencies/emitter.
- P2 JOIN rejection: adapter allowlist and expected-rejection catalog now preserve removed_for_inactivity. Real adapter-to-handler regression confirms WS commandResult {status: rejected, reason: removed_for_inactivity} without runtime seating/debit invocation.
- P2 identity: logout/changed identity clear account-owned inactivity, redirect timer and remembered seat before teardown; original URL join intent is restored for the new identity. Same-account token-pending, refresh and reconnect keep exit/countdown. Retired socket callback cannot restore old exit. Only auth/transport state and timer assertions were added to the existing harness; no presentation/layout suite.
- P2 empty reconcile: existing Leave module selects retained seat/stack claims whose Leave is not already committed; CLOSED, completed history and deferred claims generate no sweep Leave commands. Marker remains durable. Existing deferred hand timeout/finalizer/settled retry still owns settlement before rollover. Actual extracted sweep test shows one pending command, then no new queued command after completion.

Validation: focused critical suites 258/258 PASS; full existing browser/auth harness 161/161 PASS; snapshot 10/10, adapter-to-WS 52/52, pending/Leave/deferred subset 30/30, package guard 2/2 and log-policy 2/2 PASS. npm test PASS in isolated test mode with external DB/service credential variables removed. Existing Leave accounting script PASS; real SP terminal accounting test retains human/bot refunds and escrow=0 with no duplicate payouts. ci:guards, test:quick, CSP PASS. Full WS harness initially 139/140 (only orphaned log catalog entry); its failing log guard passed after removing that obsolete registration. Final full harness/CI result is tracked in the Draft PR handoff.

Independent fresh subagent: APPROVE all owner findings and final dependency/log-catalog corrections, no blocking findings; 199 focused tests plus final guard/auth rechecks passed. Its initial local leave-race startup timed out because the default ERROR log level suppresses INFO readiness output. Re-run with CI's WS_POKER_LOG_LEVEL=INFO passed 1/1; no runtime modification was needed. No deployment, funded Stage checks, migrations, Production mutation or merge. PR remains Draft for another owner review.
