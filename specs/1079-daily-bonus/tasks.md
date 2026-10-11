# Tasks: Poker Daily Bonus (#1079)

**Source:** [spec.md](spec.md), [plan.md](plan.md), updated owner decision in #1079.
**State:** implementation authorized by owner and completed in Draft PR #1084; CI verification in progress. No SQL migration files, deployments or live campaign changes. Environment rollout remains unauthorized.

## Phase 0 — Owner gate

- [x] T001 Review main `1ba99776ff427783f858e075d3474e144c3947b3`, `agents.md`, `skills.md`, issue #1079 and existing Bonus Campaigns/Admin/client/lobby/CI files.
- [x] T002 Replace overbuilt old/new cutover with a no-migration, one-PR plan. One-time same-day 20 CH + 25 CH is explicitly acceptable; legacy claims are ignored by the new series.
- [x] T003 Obtain owner approval of the simplified spec and implementation scope before adding code to this same Draft PR #1084.

## Phase 1 — Existing backend and configuration

- [x] T004 Extend `tests/bonus-campaigns.behavior.test.mjs` with fundamental progression/long-plateau/gap/UTC/replay/invalid-config/rollback and locked End-vs-claim cases. Do **not** test or implement a cross-campaign old/new exclusion.
- [x] T005 Update `netlify/functions/_shared/bonus-campaigns.mjs`: for `poker_daily` validate `eligibility_config.daily_rewards`, dynamically calculate next amount from existing new-campaign claim metadata, store `streak_day` and actual award; inside `claimBonusCampaign` re-read the full locked current campaign/status/config/eligibility and transaction-time UTC period; preserve atomic `postTransaction(...,tx)`, GENESIS, per-campaign/day idempotency and fail-closed malformed new receipts. Do not read old claims.
- [x] T006 Extend `tests/admin-bonus-campaigns.behavior.test.mjs` and update `netlify/functions/admin-bonus-campaigns.mjs` parsing/normalizing/create/update/status for `poker_daily`. Keep config immutable once published, validate four positive amounts and all-accounts/daily/null cap; draft manual activation and End via existing Admin. No new DB column, family lock/index, special cutover action or migration.
- [x] T007 Update `admin.html` and `js/admin-page.js` existing Daily template and fields to four configurable amounts stored in `eligibility_config.daily_rewards`. Maintain Day 1 scalar amount and existing form/status workflows; leave unrelated campaign rules unchanged.

## Phase 2 — Status and lobby

- [x] T008 Extend `tests/bonus-campaigns-endpoint.behavior.test.mjs` and `netlify/functions/bonus-campaigns.mjs` with opt-in `GET ?includeDailyStatus=1`; maintain default `{items}` and Welcome compatibility; include claimed/paused/new-campaign progression and actual POST paid amount.
- [x] T009 Extend `js/chips/client.js:fetchBonusCampaigns(options)` only for requested opt-in; preserve all existing callers and existing `chips:tx-complete` emission.
- [x] T010 Wire `poker/poker.js:initLobby` + `poker/index.html:dailyDialog` + minimal scoped `poker/poker.css` to truthful daily status and manual Claim. Guard old asynchronous account responses, refresh on open/claim/UTC rollover, show logged-out/unavailable/paused truthfully. JSP-compatible JS; CSS one-line declarations; `klog` logging; if inline script appears, update CSP SHA.

## Phase 3 — Fundamental verification in the same PR

- [x] T011 Register `tests/bonus-campaigns.behavior.test.mjs` and `tests/bonus-campaigns.transaction.test.mjs` in `scripts/test-all.mjs`; run the essential PostgreSQL lock/ledger-rollback test in existing isolated PostgreSQL CI infrastructure (`.github/workflows/tests.yml`), without new jobs/dependencies/framework. Only fundamental deterministic tests; no UI/CSS/JSP suite.
- [x] T012 Run fundamental Bonus/Admin/endpoint/Welcome/ledger tests and existing syntax/CSP checks. Self-review impact and ensure the PR contains **no** `supabase/migrations/**` changes, scheduler, legacy cross-campaign guards or unrelated cleanup. Record exact runtime SHA and important breaking effects.

## Phase 4 — Authorized environment actions, not PR database code

- [ ] T013 After explicit Stage deployment/cutover GO, deploy the reviewed runtime, verify ordinary Bonus and new inactive status, create new `poker_daily` campaign as draft in existing Admin, **End** `daily-active-2026`, then **Activate** new draft. Confirm new 25 CH Day 1/duplicate behavior and receipt/ledger evidence with separately authorized payout smoke. No old-history audit, migration or cross-campaign same-day blocking.
- [ ] T014 After Stage acceptance and separate Production GO, inspect actual Production state, deploy reviewed runtime, End any active legacy `daily-active-2026` if present, and create/activate new draft through existing Admin. Do not claim the PR merge changes live records; no automatic activation or DB action without authorization.
- [ ] T015 Hand off verified SHA, tests, environment campaign status and any remaining GO. Failure rollback is Pause of new campaign and fix-forward; old End is intentionally irreversible.

## Scope and developer notes (project rules 3–9)

3. Think carefully and fulfill requirements completely.
4. Keep code minimal; simplify without changing behavior.
5. Reuse existing packages, methods, patterns and classes.
6. Highlight all breaking effects, especially End of old daily and changed Admin template/dynamic amount.
7. All JS remains JSP-compatible (global/IIFE, no browser modules).
8. One CSS selector per physical line with no intra-declaration linebreak.
9. Double-check/refactor before handing off.

Use `agents.md`/`skills.md`; no repository commands in this SpecKit, no new migrations, only fundamental tests, CSP SHA for added inline scripts, `klog` instead of `console.log`. The owner-approved product behavior does **not** authorize Stage/Production writes, CH grants or merge.


## Verification record

Original implementation runtime SHA: `6df81d3b1010d59fa85b02b55d3f69bbe51f3925` (historical baseline before the P2 correction below).

Completed: 35 targeted Bonus/Admin/endpoint/scheduler/Welcome tests; real isolated PostgreSQL native JSONB/concurrent Claim/End-wait/ledger rollback contract; full local `scripts/test-all.mjs` runner; syntax, CSP (55 documents), lifecycle guards and diff review. Only existing Admin template regression fixtures/expectations changed; no new presentation test suite.

Remote GitHub CI is running on this PR; final results will be recorded in its description. PR remains Draft for owner code review. Netlify Preview is intentionally skipped. T013–T014 remain unapproved and unexecuted; no live environment operations, campaign changes or production merge. T015's runtime/environment verification awaits later deployment authorization.


## Review follow-up — P2

- [x] T016 Make `validDailyEvidence()` fail closed when its matching PROMO_BONUS transaction is absent; preserve ID/amount/streak checks. Add exactly one fundamental missing-transaction case covering replay/continuation, verify red→green and run the relevant regression suites. Self-review: no new payout/storage/history mechanism; no migration or environment action. Local result: 36 tests passed, syntax and diff checks passed. Final SHA/remote CI results are recorded in Draft PR #1084; Netlify deployment remains skipped.


## UX follow-up

- [x] T017 Clarify inactive/paused/signed-out/API-error states in `renderDailyBonus`; add permanent eligibility text and existing `openSignIn()` CTA in the current dialog. Keep Claim/identity protections and narrow-landscape text visible. No backend, campaign or database changes.
- [x] T018 Run syntax/CSP/lifecycle controls, self-review and inspect updated Deploy Preview in portrait/landscape, including sign-in navigation and read-only simulated inactive/paused/API-error states. Keep PR Draft; no Claim, migration, campaign activation, Stage/Production mutation or merge.

UX verification: syntax (225 files), CSP (55 documents), lifecycle guards and diff check passed. Read-only Chromium smoke on Deploy Preview passed all 8 combinations: 390×844 portrait / 667×375 landscape × signed-out / missing campaign / paused / API error. Authenticated states used browser-only mock responses; no real Claim or campaign mutation. Existing sign-in bridge invocation and disabled Claim verified. GitHub CI for runtime commit `a9c893e8c4cf11c1afe4d7c429130629cd8f9047` passed, including core, PostgreSQL, Playwright, CodeQL and WS harness; Netlify playkcswh Preview succeeded. Preview authorization supersedes the historical skipped-deployment notes above; Stage/Production operations remain unexecuted. Self-review: no backend changes, inline scripts, breaking protocol changes or payout behavior changes.


## Stage GO and mobile status follow-up

- [x] T019 Move existing campaign live status above reward cards/Claim while retaining eligibility copy and sign-in CTA.
- [ ] T020 Verify Stage identity/backend; use existing Admin to create/verify Draft then End old and activate new, stop on failure, record both statuses and read-only API claim eligibility.
- [x] T021 Run fundamental tests, syntax/CSP/guards, CI and mobile Preview smoke; self-review and record deployment/SHA/Stage outcome. No automated CH claims, migration, Production or merge.

Stage attempt stopped on Admin Draft create HTTP 500. Deployed backend/identity verified at `c26301f7a0cbf7407a31a0c1153f3afa25c04fc6`, all Stage refs matched. PostgreSQL log confirms `bonus_campaigns_created_by_fkey`: the admin identity used for the request does not exist in Stage `auth.users`. No retry or bypass; no Draft persisted, old `daily-active-2026` remains active (20 CH), new `daily-streak-2026` absent. End/Activate were never requested. T020 remains incomplete pending a valid existing Stage admin identity and owner review of the stopped operation. No payout or migration performed.

Local verification: 36 fundamental Bonus/Admin/endpoint/scheduler/Welcome tests passed with the repository test runner CORS allowlist; direct invocation without that allowlist failed CORS assertions, then corrected configuration passed. Syntax (225 files), CSP (55 documents), lifecycle guards and diff check passed. Mobile Preview/CI results recorded in PR description.

Runtime/mobile verification SHA: `d728c59bca1f3ee971218b869860dd9fd51dce31`. Netlify playkcswh Preview ready; 8 read-only browser checks passed at 390×844 and 667×375, including an explicit assertion that campaign status is inside the initial viewport, above reward cards/Claim. Sign-in CTA/eligibility and Claim guards preserved. Authenticated UI states simulated only; final live Stage GET still returns `dailyBonus:null`. CI launched for the PR, with final results recorded in its description. Self-review: only existing HTML live-region placement and cached JS element changed; no payout, CSS, inline-script or protocol changes. Stage activation remains blocked at T020, not completed.
