# Tasks: Google Login V1

- [x] T001 Inspect main, issue #1100, PR #701, official docs and Stage provider settings.
- [x] T002 Extend critical auth/security cases in `tests/account-auth.contract.test.mjs` and confirm failures.
- [x] T003 Implement fixed Google flow and sanitized callback/telemetry in `js/auth/supabaseClient.js`.
- [x] T004 Add scoped button, PL/EN states and retry in `account.html`, `js/account-page.js`, `js/i18n.js`.
- [x] T005 Add default-off build flag in `scripts/generate-build-info.js` and account callback-safe analytics in `js/analytics.js`; set only `netlify.toml` deploy-preview flag.
- [x] T006 Run relevant automated regressions, syntax and CSP checks; inspect Preview desktop/mobile, error/retry and Stage password auth using temporary browser tooling.
- [x] T007 Configure Stage Google and verify existing-password identity continuity, Google repeat/reload and storage audit.
- [x] T009 Verify new Google registration/profile, repeat login and UUID with a real Google identity absent from Stage; no CH/Poker operations.
- [x] T008 Prepare Draft PR, working Preview and evidence/remaining external steps in `specs/1100-google-login/quickstart.md`.

## Evidence / remaining work
Historical runtime SHA `b68f546a`, Preview #1101: desktop/mobile PL/EN, disabled provider/retry, controlled synthetic callback error, Stage password/profile HTTP 200/reload/sign-out PASS. Full npm test and settled CI PASS. T007 Stage Google configuration, existing verified-email Google login, repeat/reload, UUID continuity and storage audit are now PASS. New-user registration has now passed with a second real Google identity verified absent from Stage before signup. See quickstart for the initial failed callback followed by successful fresh/repeat login.

## PR review follow-up
- [x] T010 Fix unavailable-SDK callback cleanup in `js/auth/supabaseClient.js`; preserve deferred SDK opportunity and add fundamental tests.
- [x] T011 Reproduce stale callback error after password login/sign-out; clear on successful authentication and preserve failed-password error; add tests.
- [x] T012 Rename SpecKit directory to `specs/1100-google-login` and synchronize status.
- [x] T013 Verify updated Preview security cases, password flow and real Google repeat; attempt original callback reproduction with safe diagnostics.
- DEFERRED T014 Permanent Stage Site URL is outside this issue and not a merge blocker, per owner decision. Keep the working temporary Preview and exact redirect allowlist; no new hosting or DNS.
- [x] T015 Run relevant regressions/CI and update existing Draft PR PASS/FAIL/NOT TESTED.

Review runtime SHA `19bc6fe1`: 14 auth cases PASS; syntax/structural/CSP/JWT regressions PASS; actual Preview blocked-SDK cleanup PASS; callback-error → real Stage password sign-in → sign-out PASS; two fresh existing-user Google logins PASS with callback HTTP302 and same UUID. Original callback error was not reproduced on these attempts. Safe diagnostics contain codes/status/booleans only. New-user registration is now PASS, permanent Stage Site URL deferred outside this issue (nonblocking). Final runtime SHA `0cf96fb4`: all CI settled, 23 PASS / 7 expected skips / 0 failures or pending. Refresh-only callback failure-mode coverage also PASS in both fundamental tests and the real blocked-SDK browser case.

New-user Stage E2E PASS: pre-signup auth.users count zero; first Google login authenticated with clean callback; one user and matching user_profiles row; profile endpoint HTTP200; sign-out confirmed; second Google login same UUID and profile HTTP200. No financial/Poker actions. Google requested human password verification during first OAuth; owner completed it. The historical failed callback did not recur.
