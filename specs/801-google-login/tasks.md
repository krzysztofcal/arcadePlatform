# Tasks: Google Login V1

- [x] T001 Inspect main, issue #1100, PR #701, official docs and Stage provider settings.
- [x] T002 Extend critical auth/security cases in `tests/account-auth.contract.test.mjs` and confirm failures.
- [x] T003 Implement fixed Google flow and sanitized callback/telemetry in `js/auth/supabaseClient.js`.
- [x] T004 Add scoped button, PL/EN states and retry in `account.html`, `js/account-page.js`, `js/i18n.js`.
- [x] T005 Add default-off build flag in `scripts/generate-build-info.js` and account callback-safe analytics in `js/analytics.js`; set only `netlify.toml` deploy-preview flag.
- [x] T006 Run relevant automated regressions, syntax and CSP checks; inspect Preview desktop/mobile, error/retry and Stage password auth using temporary browser tooling.
- [ ] T007 Configure Stage Google provider and perform real Google new/repeat login, verified-email identity continuity and storage audit (owner Google login required).
- [x] T008 Prepare Draft PR, working Preview and evidence/remaining external steps in `specs/801-google-login/quickstart.md`.

## Evidence / remaining work
Runtime SHA `b68f546a`, Preview #1101: desktop/mobile PL/EN, disabled provider/retry, controlled synthetic callback error, Stage password/profile HTTP 200/reload/sign-out PASS. Full npm test and settled CI PASS. T007 Stage Google configuration, existing verified-email Google login, repeat/reload, UUID continuity and storage audit are now PASS. Completely new Google user registration remains pending a second real Google identity absent from Stage; do not mark this task fully done yet. See quickstart for the initial failed callback followed by successful fresh/repeat login.
