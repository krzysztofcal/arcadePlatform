# Tasks: Poker Daily Bonus (#1079)

**Input**: [spec.md](spec.md), [plan.md](plan.md).
**Status**: planning complete; every implementation/operational task below is pending owner approval. No test, migration, campaign change, grant or deployment has been executed by this task.

## Phase 0 — Analysis and approval

- [x] T001 Read current issue #1079, agents.md, skills.md, constitution and SpecKit templates; inspect current main `1ba99776ff427783f858e075d3474e144c3947b3` campaign, ledger, Admin, lobby, migrations and tests.
- [x] T002 Produce the three documents; self-review economics, transaction recheck, old/new collision, bounded receipt progression, Welcome compatibility and Stage/Production gates. Embed research/model/contracts in plan.md; no extra subsystem.
- [ ] T003 Owner review/GO for this spec and plan, including proposed `poker_daily` type, nullable `daily_rewards`, opt-in projection, manual-only scoped publication and lock/index protections. Do not implement before GO.

## Phase 1 — Schema and atomic foundations (after T003)

- [ ] T004 Allocate a fresh migration via Supabase CLI: `supabase/migrations/<allocated-timestamp>_bonus_campaign_daily_rewards.sql`. Add reward/config/manual-only constraints, scoped one-active index and user/period/campaign evidence index. No seed, state transition, receipt backfill or payout. Do not push this file until T016 Stage schema GO; auto DB Stage Apply PR is a shared Stage mutation.
- [ ] T005 Extend `tests/bonus-campaigns.behavior.test.mjs` with progression/long plateau/gap/UTC, fresh locked status/amount/dates/eligibility, account/guest, replay, dynamic balanced funding and rollback rules.
- [ ] T006 Implement in `_shared/bonus-campaigns.mjs` the full `lockCampaign`/`claimBonusCampaign` transaction recheck, validated reward parser, bounded new-campaign receipt progression and explicit UTC decision instant/receipt time. Preserve `buildClaimPeriodKey`, idempotency strings, `postTransaction(...,tx)` and other campaign policies.

## Phase 2 — Safe replacement and Admin (depends on T006)

- [ ] T007 Add fundamental legacy→new tests in `tests/bonus-campaigns.behavior.test.mjs`: old/new same-day block, clean next-day Day 1, old claims excluded from series, orphan/durable evidence denial and Welcome/generic daily independence.
- [ ] T008 Implement purpose-specific family predicate/transaction lock/evidence lookup in `_shared/bonus-campaigns.mjs`. Enforce old and new claim paths, block legacy after published successor and unsafe overlap; no generic promotions lock framework.
- [ ] T009 Extend `tests/admin-bonus-campaigns.behavior.test.mjs` for rewards, active-family/legacy/scheduled conflicts, fresh immutable checks and Pause/End; implement locked `parseCampaignInput`, `normalizeCampaignRow`, create/update/status checks in `admin-bonus-campaigns.mjs`, reusing family helper. Preserve other campaign rules.
- [ ] T010 Add one focused `tests/bonus-campaigns-concurrency.integration.test.mjs` with existing postgres/node:test and isolated test DB: real two-connection claim/cutover/pause races and receipt-failure rollback. Validate migration constraints. No timing sleeps, Stage/Production fixtures or new framework.
- [ ] T011 Extend `admin.html` existing form and `js/admin-page.js` template/fill/read/validation/list/status messages with `dailyRewards`; keep draft-only economics editing and existing kill switch. Verify unrelated scheduler behavior in `tests/bonus-campaigns-scheduler.behavior.test.mjs`; no cron/job added.

## Phase 3 — Authenticated status and existing lobby (depends on T008–T011)

- [ ] T012 Extend `tests/bonus-campaigns-endpoint.behavior.test.mjs` for unchanged default GET/Welcome POST, opt-in claimed/paused Daily projection, real paid amount and new reason mapping. Implement projection/response updates in `bonus-campaigns.mjs` and shared status helpers; no new endpoint or exposed history.
- [ ] T013 Extend `js/chips/client.js:fetchBonusCampaigns(options)` with opt-in status; preserve existing `claimBonusCampaign`, Welcome and `chips:tx-complete` behavior.
- [ ] T014 Wire `poker/poker.js:initLobby` Daily open/status/Claim handlers with identity generation guards, server UTC reset refresh and no browser authority. Update `poker/index.html:dailyDialog` and scoped `poker/poker.css` real states using current art/layout. JSP-compatible JS, klog, one physical CSS line per selector; new inline scripts require CSP SHA, none planned. Manual/existing Preview presentation checks only, no UI/CSS suite.
- [ ] T015 Run fundamental campaign/Admin/endpoint/scheduler/Welcome/ledger tests and isolated concurrency test; syntax/CSP/lifecycle checks, self-review minimal diff, denial paths and breaking impact. Prepare exact SHA and explicit migration Stage-effect statement before requesting operational GO. No unrelated tooling/ignore/dependency edits.

## Phase 4 — Stage verification/cutover (environment-specific GO required)

- [ ] T016 Obtain explicit Stage schema GO before migration PR push/automatic DB Stage Apply PR. Read-only identity/schema/active-and-scheduled-family/auth-capability/legacy-history/GENESIS preflight; record conflicts and stop rather than mutate them implicitly. Apply additive schema only after GO; old campaign remains untouched.
- [ ] T017 Obtain Stage application Preview GO; deploy approved SHA, verify schema/ordinary Bonus/Admin/status compatibility and retirement of old claim handlers/in-flight invocations. No WS deploy for this scope; no new campaign active.
- [ ] T018 Obtain Stage draft-creation GO; create reviewed replacement through existing Admin with `[25,50,100,200]`, all accounts/daily/null cap and reviewed dates/code. Confirm draft and no automatic publication.
- [ ] T019 Obtain explicit Stage cutover + bounded CH-smoke GO: pause legacy, drain/verify pending old claims, confirm no further grants; activate new only after that evidence. Audit today's old claimant blocked, unpaid account Day 1, retry/ledger consistency, same-day exclusion and correct next-day eligibility. Preserve all existing receipts/transactions; do not fake Stage dates/history to test a multi-day sequence.
- [ ] T020 Record Stage acceptance and redacted cutover evidence (operator/UTC/campaign IDs/config/SHA/history counts). End legacy only with explicit Stage End GO; otherwise leave it paused and permanently nonclaimable under replacement guard.

## Phase 5 — Production handoff (never implicit)

- [ ] T021 Request separate Production readiness/schema/application GO after Stage acceptance. Verify exact Production target/current inventory, migrate additively, deploy approved SHA, prepare inactive campaign; do not assume the earlier audit remains current. Merge requires a distinct explicit user instruction.
- [ ] T022 Obtain Production activation/cutover and any payout-smoke GO. If old Daily exists, repeat pause→verify→activate; otherwise verify no active family. Confirm server-side guard and evidence. Do not automatically promote Stage or revive old campaign on rollback; Pause new and fix forward.
- [ ] T023 Handoff implementation/CI/Preview/Stage evidence and remaining Production/manual gates. No merge-ready claim while required evidence is absent. Never execute Production/merge actions solely because this planning checklist exists.

## Dependencies / scope check

T003 gates all product work. T004 can be authored locally after implementation approval but cannot trigger shared Stage until T016. T006 precedes family/administrative integration; T010 must prove races using a real isolated DB before Stage cutover. T012–T014 depend on the authoritative backend contract; presentation is not a source of reward truth. T016–T020 complete before any Production request. Operator gates are target-specific and cannot be inferred from approved economics.

Fundamental-tests-only Constitution Check applies before implementation: no generated UI/layout/JSP/simple-glue test tasks, no budget/monitoring service, no extra cron, streak table, payment path, live-history rewrite, WS/protocol work or generic setup cleanup.
