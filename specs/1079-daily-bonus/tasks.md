# Tasks: Poker Daily Bonus (#1079)

**Source:** [spec.md](spec.md), [plan.md](plan.md), updated owner decision in #1079.  
**State:** revised planning in Draft PR #1084; implementation/rollout pending authorization. No DB migrations.

## Phase 0 — Owner gate

- [x] T001 Review main `1ba99776ff427783f858e075d3474e144c3947b3`, `agents.md`, `skills.md`, issue #1079 and existing Bonus Campaigns/Admin/client/lobby/CI files.
- [x] T002 Replace overbuilt old/new cutover with a no-migration, one-PR plan. One-time same-day 20 CH + 25 CH is explicitly acceptable; legacy claims are ignored by the new series.
- [ ] T003 Obtain owner approval of the simplified spec and implementation scope before adding code to this same Draft PR #1084.

## Phase 1 — Existing backend and configuration

- [ ] T004 Extend `tests/bonus-campaigns.behavior.test.mjs` with fundamental progression/long-plateau/gap/UTC/replay/invalid-config/rollback and locked End-vs-claim cases. Do **not** test or implement a cross-campaign old/new exclusion.
- [ ] T005 Update `netlify/functions/_shared/bonus-campaigns.mjs`: for `poker_daily` validate `eligibility_config.daily_rewards`, dynamically calculate next amount from existing new-campaign claim metadata, store `streak_day` and actual award; inside `claimBonusCampaign` re-read the full locked current campaign/status/config/eligibility and transaction-time UTC period; preserve atomic `postTransaction(...,tx)`, GENESIS, per-campaign/day idempotency and fail-closed malformed new receipts. Do not read old claims.
- [ ] T006 Extend `tests/admin-bonus-campaigns.behavior.test.mjs` and update `netlify/functions/admin-bonus-campaigns.mjs` parsing/normalizing/create/update/status for `poker_daily`. Keep config immutable once published, validate four positive amounts and all-accounts/daily/null cap; draft manual activation and End via existing Admin. No new DB column, family lock/index, special cutover action or migration.
- [ ] T007 Update `admin.html` and `js/admin-page.js` existing Daily template and fields to four configurable amounts stored in `eligibility_config.daily_rewards`. Maintain Day 1 scalar amount and existing form/status workflows; leave unrelated campaign rules unchanged.

## Phase 2 — Status and lobby

- [ ] T008 Extend `tests/bonus-campaigns-endpoint.behavior.test.mjs` and `netlify/functions/bonus-campaigns.mjs` with opt-in `GET ?includeDailyStatus=1`; maintain default `{items}` and Welcome compatibility; include claimed/paused/new-campaign progression and actual POST paid amount.
- [ ] T009 Extend `js/chips/client.js:fetchBonusCampaigns(options)` only for requested opt-in; preserve all existing callers and existing `chips:tx-complete` emission.
- [ ] T010 Wire `poker/poker.js:initLobby` + `poker/index.html:dailyDialog` + minimal scoped `poker/poker.css` to truthful daily status and manual Claim. Guard old asynchronous account responses, refresh on open/claim/UTC rollover, show logged-out/unavailable/paused truthfully. JSP-compatible JS; CSS one-line declarations; `klog` logging; if inline script appears, update CSP SHA.

## Phase 3 — Fundamental verification in the same PR

- [ ] T011 Register the existing `tests/bonus-campaigns.behavior.test.mjs` in `scripts/test-all.mjs`; ensure any necessary new essential DB-lock test runs in existing isolated PostgreSQL CI infrastructure (`.github/workflows/tests.yml`), without new jobs/dependencies/framework. Only fundamental deterministic tests; no UI/CSS/JSP suite.
- [ ] T012 Run fundamental Bonus/Admin/endpoint/Welcome/ledger tests and existing syntax/CSP checks. Self-review impact and ensure the PR contains **no** `supabase/migrations/**` changes, scheduler, legacy cross-campaign guards or unrelated cleanup. Record exact runtime SHA and important breaking effects.

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
