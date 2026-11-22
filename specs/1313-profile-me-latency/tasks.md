# Tasks: profile-me latency, scope 1 (#1313)

## Scope 1: client (this PR)
- [x] T000 Diagnosis and read-only verification (region, plan, Upstash, Stage locks): plan §Diagnosis, research R1–R3.
- [x] T001 [agy] FR-001 `js/account-page.js::renderUser`: no reload for the same user once the section has a successful or in-flight read. The profile and Poker sections are independent.
- [x] T002 [agy] FR-002 `js/auth/supabaseClient.js::applyResolvedUser`/`refreshProfile`: `profileConfirmedUserId` mark, cleared on a user change, sign-out or failure.
- [x] T003 [agy] FR-003 `js/xpClient.js::fetchStatus`: shared in-flight request per identity key and generation, `stale_identity` rejection, and callers in `js/xpClient.js` and `js/xp/core.js` treat it as a no-op.
- [x] T004 [agy] SRI: none of the four changed scripts carries an `integrity=` pin on any page, so no pin changed. `legal/*.html` is byte-identical.
- [x] T005 [agy] Fundamental tests in existing files only:
  - `tests/account-auth.contract.test.mjs`: same-user `INITIAL_SESSION`/`SIGNED_IN`/`TOKEN_REFRESHED` after a success → no new base or Poker read. An account switch, a sign-out followed by a sign-in, or an earlier failure → a read.
  - `tests/topbar-contract.test.mjs`: same-user event after a published profile → no `refreshProfile`. A failure clears the mark.
  - `tests/xp-client.test.mjs` or `tests/xp-client-contract.test.mjs`: N concurrent `fetchStatus` → 1 fetch. A changed session, auth subject or generation → a new fetch. An old answer resolving after a change → `stale_identity`, not applied. No finished-answer reuse.
  - Regression: the existing account, XP and legal-packaging tests pass. In `tests/topbar-contract.test.mjs` the new tests pass; its 5 existing `poker/table.html` assertions already fail identically on `main` and are reported separately.
- [x] T006 Coordinator review of the agy diff. Out-of-scope rewrites of 5 existing `poker/table.html` assertions in `tests/topbar-contract.test.mjs` were reverted; only the new tests remain. Those 5 assertions, and 1 in `tests/xp-overlay.test.mjs`, already fail identically on `main` and are not in CI or `scripts/test-all.mjs` (separate follow-up). Rerun the validation command from the plan. Check scope, SRI, `klog` only, no server change.
- [ ] T007 Draft PR. Independent read-only Codex review per AGENTS.md "Claude Code handoff: Codex review" (at most 3 rounds, 0 P0/P1/P2 on the final diff, evidence in the PR).
- [ ] T008 Measurement on the Deploy Preview (plan §Measurement), after the OWNER real-device acceptance. Report each SC.
- [ ] T009 OWNER: merge decision. Production publication stays a separate OWNER path.

## Scope 2: server XP (analysis only; separate GO)
- [x] T010 Security analysis: research R3–R7.
- [ ] T011 OWNER GO for 2a (and an explicit decision on 2b). Only then: implementation plus the R7 tests, in a separate PR with its own Codex review.

## Scope 3 and 4: HOLD
- [ ] T020 `profile-me` GET without the lifecycle lock: HOLD. No change to the account-lifecycle guarantee.
- [ ] T021 Functions region: HOLD.
  - Prerequisites: the OWNER checks the Upstash region (read-only), and decides on a Pro plan or a support request for `cdg`.
  - The change is a UI setting plus a redeploy through Candidate → Publish (OWNER).
  - Rollback: publish the previous deploy, which keeps its region, or set `iad` again and redeploy.
