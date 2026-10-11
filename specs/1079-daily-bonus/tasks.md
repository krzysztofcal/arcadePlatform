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


## Dedicated Stage identity gate

- [x] T022 Read current Auth/Admin code and effective Preview configuration; inspect Stage Auth public settings, existing allowlisted Stage user existence and campaign inventory without using owner session or creating JWTs. Result: Preview Stage ref matches; email confirmation required; unauthenticated Admin GET returns 401.
- [ ] T023 Obtain operator-controlled technical email and VPS secret mechanism/access identifiers; stop before provisioning while missing. Never request passwords/tokens in chat.
- [ ] T024 Provision and confirm dedicated Stage Auth user, store credentials exclusively in approved VPS secrets, record UUID; append only to Preview ADMIN_USER_IDS while preserving existing IDs and Production values.
- [ ] T025 Refresh appropriate Preview, authenticate through real Supabase Auth session and verify JWT subject/Auth row/Admin GET/Stage identity plus Production rejection; no locally generated JWT or personal-account reuse.
- [ ] T026 Resume T020 after T025; existing Admin only, Draft verification before irreversible End, no duplicates, stop on failure, no Claim.

Read-only preflight baseline SHA `20a24f893ba683f99e706491a3bc7fff29a91cfc`. 50 fundamental existing Auth/Stage-identity/Bonus/Admin/endpoint/scheduler/Welcome tests passed with repository CORS setup. Self-review: no application/security-policy changes; no secret values persisted or logged. Stage old `daily-active-2026` remains active (20 CH), new `daily-streak-2026` absent. Technical account has not been created; actual account authorization and Production denial have not been verified. Blocked on controlled email and VPS secret mechanism/access. No migrations, payouts, Production mutation or merge.

## AI-agent Stage operations follow-up

- [x] T024 Complete approved Stage Daily switch atomically using the connected Stage management action, then read back exact old/new status/rewards (not Claim; Production unchanged).
- [x] T025 Add reusable owner-dispatched, Stage-fenced GitHub workflow and operator script using existing Stage secrets and Admin campaign validation/status methods; read-only inspect default, exact GO for writes, DB physical identity check, atomic old/new switch, stop on unexpected state.
- [x] T026 Add one minimal guard test file to the existing runner; document agent one-line dispatch and Stage/Production boundary in `docs/stage-bonus-agent-operations.md`.
- [ ] T027 Confirm CI on final SHA; after approved merge to main, verify an actual **inspect-only** workflow dispatch on Stage. No workflow has been dispatched from this Draft PR.


## One-click Daily reward and success emphasis

- [x] T028 Update existing Daily shortcut/claim flow to one preflight plus POST, immediate authoritative receipt projection, pending/identity guards, readonly reset/focus/reload and error reconciliation.
- [x] T029 Add strong gold success +CH/streak hero and claimed milestone shine/glow in existing HTML/CSS; no style overhaul, extra assets or UI test suite; reduced-motion supported.
- [x] T030 Extend fundamental POST receipt contract assertions, run Bonus/Welcome and controls/CI; ephemeral mobile Preview verifies eligible GET+POST, claimed/guest no POST, duplicate clicks and account switching. Self-review records request counts, touched files and breaking impacts.

Local verification: 38 fundamental Bonus/Admin/endpoint/scheduler/Welcome/operator guard tests passed; endpoint contract covers paid amount, uncapped streak, milestone, receipt ID and authoritative UTC times required for immediate rendering. Syntax, CSP (55 documents), lifecycle guards and diff checks passed. Ephemeral browser smoke with locally intercepted PR files passed 12 portrait/landscape cases: guest, claimed, eligible, duplicate replay, uncertain failure/reconciliation and identity change during pending POST. Eligible happy path asserted exactly one Daily status GET + one POST before success; reopening added only a status GET. Focus/double-click during POST added no request. No real claims or campaign/identity changes performed. Preview/remote CI pending and tracked in PR.

Verified runtime SHA `c6b59ac6692b6e81458e4921e59eff340332fa8f`: Netlify playkcswh Preview succeeded. Twelve read-only mobile Preview cases passed (390×844/667×375 × guest/claimed/eligible/replay/failure/account switch); two reduced-motion checks and eight existing inactive/paused/API-error/guest checks also passed. No maintained presentation suite added. Eligible asserted GET+POST before immediate success; reopening added only a GET. GitHub CI all executed checks passed, including core, PostgreSQL, Playwright, CodeQL and WS harness. First WS attempt failed in unchanged disconnect cleanup with seat_user_closed vs null; only that job was rerun and passed. Existing Stage inventory read-only: legacy ended, new active; no campaign mutations or real CH claims in this follow-up. Final documentation commit is runtime-identical; final head/CI evidence is in PR description.


## Table-style transient Claim celebration

- [x] T031 Add dominant 1.8s table-style Daily fly-in in existing HTML/JS/CSS, fresh confirmed claim only; lifecycle cleanup/reduced-motion, no new HTTP requests.
- [x] T032 Run fundamental tests/controls and CI; inspect mobile Preview overlay size, timing, duplicate/account-switch/close and reduced-motion behavior; self-review and retain Draft.

Local verification: 38 fundamental tests, syntax (225 files), CSP (55 documents), lifecycle/project guards and diff checks passed. Mobile mock smoke asserts viewport-sized transient +CH and full STREAK DAY (including Day 100), 1.8s disappearance and persistent streak receipt; no actual claims. Runtime SHA `42e4ae494ca154fce701f2c7eb6483d6155ab1f6`: all executed CI checks and Netlify playkcswh Preview succeeded. Sixteen Preview mock cases passed (12 flow cases, two reduced-motion and two close-during-effect checks) at 390×844 and 667×375. Screenshots confirm visible giant +CH and STREAK DAY 100 in both orientations. No real CH claims. Self-review: six files touched (existing lobby HTML/JS/CSS plus SpecKit); effect is visual only, adds no requests or payout changes, and introduces no protocol/schema breaking impacts. Existing foreground claim remains GET + POST versus four sequential Daily requests before the previous optimization.


## Cumulative streak card highlights

- [x] T033 Apply cumulative gold milestone highlights and neutral unclaimed current card; verify paid Days 1/2/3/4/100, continuing Day 5 before claim and reset to zero. Run fundamental tests/controls/CI and Preview; no actual CH claims.

T033 local validation: 38 fundamental tests and syntax/CSP/project guards passed. Sixteen ephemeral mobile cases cover paid Days 1/2/3/4/100, pre-claim ongoing Days 2/5 and missed-day reset (0 highlighted), including computed gold styling for each completed milestone. Self-review: only lobby JS/CSS and three SpecKit files changed; status-derived presentation, no extra requests, payout/backend/protocol/schema changes, no breaking impacts. CI/Preview evidence will be recorded in PR.

T033 Preview verification at runtime SHA `7ba3e2601cba8167acf2c9f85941052c93b68834`: Netlify playkcswh succeeded; all 16 mocked mobile milestone/reset cases passed on deployed files, plus fresh-claim fly-in/persistent receipt screenshot with all four gold cards at Day 100. No real claims. CI evidence is tracked in PR; Tests workflow explicitly dispatched after normal PR workflows did not appear for the runtime push.
