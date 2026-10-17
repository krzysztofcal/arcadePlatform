# Validation guide — execute only after implementation GO

Current delivery is documentation only. No commands below authorize runtime changes or destructive fixtures. Run appropriate deterministic tests using existing installed packages; no dependency installation or broad UI suite required.

## Fundamental local checks

From repository root, after future implementation:

```sh
node --test tests/account-deletion.behavior.test.mjs tests/auth-identity.test.mjs tests/admin-auth.behavior.test.mjs
node --test tests/chips-ledger.test.mjs tests/welcome-bonus.behavior.test.mjs tests/bonus-campaigns.behavior.test.mjs tests/bonus-campaigns.transaction.test.mjs tests/bonus-campaigns-endpoint.behavior.test.mjs
node --test tests/start-session.test.mjs tests/calculate-xp.test.mjs tests/xp-ledger.behavior.test.mjs tests/profile-avatar.behavior.test.mjs tests/xp-leaderboard-maintenance.behavior.test.mjs
node --test tests/poker-reducer.applyLeaveTable-exported.behavior.test.mjs ws-server/server.leave-race.behavior.test.mjs ws-server/poker/persistence/authoritative-leave-adapter.behavior.test.mjs ws-server/poker/persistence/deferred-leave-finalization-adapter.behavior.test.mjs
node --test tests/chips/chips-ledger-closed-human-retention.test.mjs tests/chips/chips-ledger-archive-pruning.test.mjs
npm run syntax
npm run check:csp-inline
```

Use existing test-specific env/memory/PGlite fixtures; do not point database integration tests at Stage/Production implicitly. Verify test harness behavior before execution. `tests/chips/chips.integration.test.mjs` requires a deliberately isolated database fixture and explicit environment check; run only against approved local/disposable target. Test additions must assert business effects, not mirror source text. Expected results: no duplicate grants/BURN, conserved entries, correct pot/side-pot, old credentials and anonymous UUID sources rejected, receipts/limits survive recreation, cleanup retries and no false completion. Missing packages or environment are reported, not permission to reconfigure services.

## Authorized Stage integration later

Prerequisites: separate GO for migrations/shared Stage effects, disposable destructive tests and each deployment; approved R5/R6; verified Stage target; exact-SHA WS Preview Deploy success for runtime-affecting SHA before E2E. Never use Production or the pinned ordinary preview account as a deletion fixture. Never print credentials/emails/JWTs. Test metadata/results should use synthetic references and aggregate invariants only.

1. Fresh password and Google-only fixture: challenge/confirm, forged subject/proof denial, old JWT and socket/mint/RLS read/write denial after accepted marker. UI distinguishes pending from completed.
2. Multi-table non-all-in + all-in side-pot: confirm during hand, attempt concurrent JOIN/rebuy/gift/bonus/action, verify normal authoritative settlement, own cash-out burned once, opponents/escrow conserved. Restart WS after intent/settlement/cleanup checkpoints; requests with no tables also resume.
3. Inject transient Storage/Redis/Auth failures and lost successful Auth response. Verify retry/incident, no duplicate financial mutation, original payload/registry preserved, and no Auth removal while obligations unresolved.
4. Issue signed avatar upload before confirmation; attempt late PUT during its actual validity and concurrent finalize. Verify immediate finalize denial, tracked path cleanup after capability horizon, no orphan origin object and no premature completed label. Document CDN/browser/backups limits without claiming remote copies erased.
5. Hard-delete/recreate same email/password and same Google: new UUID/profile/wallet/handle allocation and zero inherited XP/assets/roles/streak/sessions; old guest conversion source rejected. New valid user remains usable.
6. Across recreated UUIDs and login methods, pay welcome 1/2/3 and deny 4, with parallel/replay/rollback cases. Claim Poker Daily, recreate same UTC day, deny; next UTC day eligible with fresh streak. Once campaign denied after recreation; unrelated weekly/monthly unchanged. Verify campaign global quota does not reopen on cascade.
7. Check private proof/schema access with anon/authenticated roles and key-recognition continuity/Daily-expiry fixtures; no raw email or digests in public responses/logs. Review retention/import limits against approved policy.

Owner may perform authenticated manual checks. If pending: report `implementation ready, awaiting manual runtime verification`, never merge-ready. Record target/SHA/test result without PII. Production needs a separate reviewed contract/GO; rollback stops new acceptance while preserving recovery for already accepted irreversible requests.

## Checks for this docs-only delivery

Validate artifact links, task numbering and requirement/gate coverage, exact existing source/test paths, no unfinished template placeholders and diff limited to `specs/1117-account-self-deletion/` plus SpecKit feature pointer. Runtime suites are intentionally not executed for a documentation-only change.

## Revision 2026-10-17 — minimal feasibility PoC (separate GO, not executed)

Use only two disposable Stage identities (email/password, Google-only), no financial claims/joins. Verify supported send/verify API, numeric OTP vs magic-link template, shouldCreateUser:false, exact same UUID/no identity linking; original initiating session stays bound while OTP may create another session. Negative cases: code issued before deletion challenge, concurrent normal-login code, two tabs/resend/challenge replacement, wrong UUID/session/request, email change, five-minute expiry, consumed code replay and lost provider verification response. JWT refresh/iat and ordinary login cannot pass. Record only boolean assertions and redacted fixture labels. A candidate fails if provider code cannot be shown fresh and bound to this request; no auth.users nonce-reading/password-change workaround. Cleanup fixture sessions/accounts only within that explicit GO.

Storage feasibility checks require additional scoped GO: prove real signed capability expiry and finite in-flight/clock grace on this deployment; validate dedicated pending-bucket scope. No unknown-user object contents/PII read. Rollout evidence must include last old issuer/cleanup invocation, surviving-row tracking preservation, legacy missing-row reconciliation after T_cutover+2h+grace, and rollback invalidation. Old row deleted after five minutes followed by late upload must be a fundamental deterministic regression scenario.

Additional fundamental assertions: no-timeout welcome count stays exhausted after >12 months; once campaign pause/reopen/rename retains denial; real program/campaign final closure purges proof under approved rights policy without reusable old program; Daily cannot backdate after proof expiry. Campaign global quota survives Auth cascade/pruning. Recovery handles no-table requests, VPS restart, Supabase outage, success-with-lost-response BURN/cash-out/Auth delete, lease takeover and exact-owner cleanup. Scheduled >2h Storage waits never trigger 30min overdue incident; real financial mismatch immediately blocks destructive steps. Inject delayed Redis operation after timeout and Redis restart/flush; ACTIVE permit/recovery epoch and startup reconciliation (missing permit denies; old delayed initialization cannot override BLOCKED) must prevent post-acceptance XP mutation. Race private WS delivery against acceptance, not just frame processing.

Docs-only review result: R1/R2/R3/R4/R7/R8 require future changes/tests; R5 legal/LIA/rights policy and R6 secure OTP feasibility unresolved. Not ready for unrestricted implementation GO; a separately scoped PoC GO may resolve R6 and Storage grace. No probe/deployment/environment mutation was performed for this revision.
