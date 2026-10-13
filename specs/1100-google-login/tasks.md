# Tasks: Google Login V1

- [x] T001 Inspect main, issue #1100, PR #701, official docs and Stage provider settings.
- [x] T002 Extend critical auth/security cases in `tests/account-auth.contract.test.mjs` and confirm failures.
- [x] T003 Implement fixed Google flow and sanitized callback/telemetry in `js/auth/supabaseClient.js`.
- [x] T004 Add scoped button, PL/EN states and retry in `account.html`, `js/account-page.js`, `js/i18n.js`.
- [x] T005 Add default-off build flag in `scripts/generate-build-info.js` and account callback-safe analytics in `js/analytics.js`; set only `netlify.toml` deploy-preview flag.
- [x] T006 Run relevant automated regressions, syntax and CSP checks; inspect Preview desktop/mobile, error/retry and Stage password auth using temporary browser tooling.
- [x] T007 Configure Stage Google and verify existing-password identity continuity, Google repeat/reload and storage audit.
- [ ] T009 Verify new Google registration/profile, repeat login and UUID with a real Google identity absent from Stage; no CH/Poker operations.
- [x] T008 Prepare Draft PR, working Preview and evidence/remaining external steps in `specs/1100-google-login/quickstart.md`.

## Evidence / remaining work
Runtime SHA `b68f546a`, Preview #1101: desktop/mobile PL/EN, disabled provider/retry, controlled synthetic callback error, Stage password/profile HTTP 200/reload/sign-out PASS. Full npm test and settled CI PASS. T007 Stage Google configuration, existing verified-email Google login, repeat/reload, UUID continuity and storage audit are now PASS. Completely new Google user registration remains pending a second real Google identity absent from Stage; do not mark this task fully done yet. See quickstart for the initial failed callback followed by successful fresh/repeat login.

## PR review follow-up
- [x] T010 Fix unavailable-SDK callback cleanup in `js/auth/supabaseClient.js`; preserve deferred SDK opportunity and add fundamental tests.
- [x] T011 Reproduce stale callback error after password login/sign-out; clear on successful authentication and preserve failed-password error; add tests.
- [x] T012 Rename SpecKit directory to `specs/1100-google-login` and synchronize status.
- [ ] T013 Verify updated Preview security cases, password flow and real Google repeat; attempt original callback reproduction with safe diagnostics.
- [ ] T014 Set a working canonical Stage Site URL after stable Stage hosting is available; proposed `https://stage.play.kcswh.pl/account.html`, keep exact Preview allowlist.
- [ ] T015 Run relevant regressions/CI and update existing Draft PR PASS/FAIL/NOT TESTED.
