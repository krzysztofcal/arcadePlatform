# Implementation Plan: Poker Daily Bonus (#1079)

**Source:** [spec.md](spec.md), latest owner decision in [issue #1079](https://github.com/krzysztofcal/arcadePlatform/issues/1079).
**Baseline:** main `1ba99776ff427783f858e075d3474e144c3947b3`.
**Status:** simplified design approved and implemented in Draft PR #1084; CI verification in progress. Environment actions remain unauthorized.

## Summary — YAGNI

Implement new Daily streak in existing Bonus Campaigns, ledger and Poker lobby. **No migration files, schema changes, new tables, cross-campaign guards, shared advisory locks, unique active-family index, old-history scan or dedicated cutover runner.** The owner accepts a one-time old 20 CH + new 25 CH same-day award. Treat `daily-active-2026` as an unrelated historical campaign whose status is set to `ended` via the existing Admin API at authorized rollout.

Use one implementation PR (continue #1084 after implementation GO), containing the backend, Admin, client and fundamental tests. A PR cannot itself End/Activate database records: those are two existing Admin status operations after deployment, with a new draft created beforehand.

## Model and configuration without migration

- `bonus_campaigns.campaign_type = 'poker_daily'`: new backend-recognized type; the column is already free-form text. Do not add a SQL enum or constraint.
- `bonus_campaigns.eligibility_config`: existing JSONB stores `{"daily_rewards":[25,50,100,200]}`. The existing `all_accounts` rule ignores other configuration keys, so this is a scoped extension, not a new generic rule engine.
- `amount` remains the Day 1 scalar (= first JSONB reward), for existing Admin row/API compatibility. The payout must use the **calculated day amount**, not this scalar.
- `claim_policy='daily'`, `eligibility_type='all_accounts'`, `max_total_claims=null`, draft → active manually, no automatic scheduler activation for this type. Validate all invariants in the backend. Existing generic daily/Welcome campaigns are unchanged.
- Extend existing `bonus_claims.metadata` for new payouts with `streak_day`, `reward_day`, `amount` and period. No changes to receipt uniqueness. Last successful new-campaign receipt on yesterday's UTC period continues the streak; no yesterday means Day 1. Today's receipt blocks repeated payout. Bounded lookups for today's and yesterday's records, never a full-history scan.
- An unsupported/malformed previous new-campaign receipt or mismatched ledger evidence fails closed. **Do not inspect old 20 CH claims or use them to derive progression or eligibility.**

## Backend touchpoints

1. `netlify/functions/_shared/bonus-campaigns.mjs`
   - `normalizeCampaign`: recognize new type and parse/validate `eligibility_config.daily_rewards` only for Poker Daily. Other campaigns retain current defaults.
   - `getBonusCampaignStatus`, `publicStatus`, `listBonusCampaignStatuses`: compute current day's actual reward for the new campaign and leave default claimable-only GET behavior intact.
   - `claimBonusCampaign` / `lockCampaign`: retain preflight as advisory; in `beginSql` lock the current campaign row `FOR UPDATE` and recheck status, starts/ends, identity, eligibility and immutable reward configuration. This corrects existing stale-preflight Pause/End risk without a family lock or scanning unrelated campaigns.
   - Use DB `clock_timestamp()` after the lock for one UTC claim decision period; compute previous-day receipt and reward under that lock. Prevent writing a claim whose period changed during calculation; explicitly use a matching decision time for `bonus_claims.claimed_at`, keeping existing ledger timestamps untouched.
   - `buildBonusCampaignEntries` / `insertBonusClaim`: record derived award amount, balanced USER/GENESIS entries and `streak_day` in metadata; call existing `postTransaction(..., tx)` and insert the receipt in the **same** transaction. Throw/rollback on missing transaction/receipt. Duplicate returns historical *new-campaign* paid amount rather than new entitlement.
   - No legacy query, no cross-campaign lock or same-day exclusion. Existing idempotency keys `bonus:<campaignCode>:<userId>:<UTC-day>` remain unchanged.
2. `netlify/functions/bonus-campaigns.mjs:createBonusCampaignsHandler`: default GET `{items}` and POST `{code}` stay compatible. Add opt-in `GET ?includeDailyStatus=1` with one bounded authenticated `dailyBonus` projection (`code,status,reason,dailyRewards,streakDay,rewardDay,amount,eligible,alreadyClaimed,nextEligibleAt,serverNow`); include claimed and paused states. Ignore fixed 20 CH legacy as a streak. POST returns the *actual* new-campaign payout. Map new business reasons without breaking generic error contracts.
3. `netlify/functions/admin-bonus-campaigns.mjs`: use existing `parseCampaignInput`, `normalizeCampaignRow`, `createBonusCampaign`, `updateBonusCampaign`, `assertSafePublishedUpdate`, `setBonusCampaignStatus`. Validate the scoped JSONB rewards/type/policy/cap, preserve after-publication immutability, and allow manual draft → active / active → paused or ended. No new cross-family lock/index, no Admin cutover endpoint. The existing Admin End obtains the row's UPDATE lock; claim must revalidate after its own row lock. Disallow scheduling for `poker_daily` in application validation, leaving ordinary campaign scheduling intact.
4. `netlify/functions/bonus-campaigns-scheduled.mjs`: **no implementation change expected**; because the new Poker Daily never enters `scheduled`, scheduler cannot activate it. Keep generic scheduling as is.

## Existing Admin/client/lobby touchpoints

- `admin.html` + `js/admin-page.js`: repurpose existing 20 CH Daily Login template as Poker Daily series template (code example `daily-streak-2026`). Expose four day amounts in the existing campaign form, serialize them to `eligibilityConfig.daily_rewards`, keep `amount` equal to Day 1, validate on client for UX **and** in backend for authority. Preserve generic campaigns; do not build another Admin section.
- `js/chips/client.js:fetchBonusCampaigns(options)`: optional `includeDailyStatus` flag, existing callers unchanged. Keep `claimBonusCampaign(code)` and existing `chips:tx-complete` behavior.
- `poker/index.html` `dailyDialog` and `poker/poker.js:initLobby`: reuse existing day cards and #1069 art; local `refreshDailyBonus`/`renderDailyBonus`/`claimDailyBonus` functions fetch authoritative status, handle claimed/paused/guest/failure, display four amounts and indefinite Day 4+ plateau. Refresh at open, after claim, account change and next UTC boundary while open. Use existing `lobbyIdentityGeneration` to discard stale account responses. No local entitlement and no polling service.
- `poker/poker.css`: only scoped one-line-per-selector rules where needed. Keep JSP-compatible IIFE/global JS, existing accessible dialog and reduced-motion behavior. No inline scripts planned; add CSP SHA if implementation adds one. Use `klog`, never `console.log`.

## Fundamental tests and CI

- Extend `tests/bonus-campaigns.behavior.test.mjs`: Day 1/2/3/4/5/6 and 100, missing-day reset, UTC boundary, duplicate, anonymous/invalid configuration, dynamic GENESIS amounts, atomically failing receipt/ledger write, and locked active→ended claim denial. No test expecting an old/new same-day block.
- Extend `tests/admin-bonus-campaigns.behavior.test.mjs`: four-value validation, draft→active, publication immutability, Pause/End, no `poker_daily` scheduling, unchanged generic campaigns.
- Extend `tests/bonus-campaigns-endpoint.behavior.test.mjs`: default GET/Welcome unchanged, opt-in Daily claimed/paused state and actual paid amount.
- Register the currently omitted `tests/bonus-campaigns.behavior.test.mjs` plus any new *essential* test in existing `scripts/test-all.mjs`. For one real End-vs-Claim or same-campaign double-submit lock test, reuse the existing isolated PostgreSQL infrastructure in `.github/workflows/tests.yml`, with an adequate `auth.users` fixture. Do not add a new framework/job or broad UI/CSS tests. If a focused real DB test is unnecessary after review, do not create it merely for coverage count.
- Run existing Welcome, Admin, Bonus and ledger idempotency regressions, syntax and CSP checks. No Stage/Production payouts for tests.

## One PR and simplified rollout

1. **Implementation GO:** extend the same Draft PR #1084 with application/CLI-free changes above and only fundamental tests; no migration files or automatic Stage DB writes. Review/CI/Preview before deployment.
2. **Stage GO:** verify real environment, deploy matching tested application SHA, confirm ordinary Welcome/generic Bonus still works and new Poker Daily is unavailable until activated. Create the new campaign as **draft** through existing Admin. Then **End** `daily-active-2026` via existing Admin (not Pause or rewrite), confirm status `ended`, and **Activate** the reviewed new draft. Verify Day 1/25 CH for a test account, duplicate denial, and correct UI/ledger; any real CH claim smoke requires explicit permission. No need to wait for historical claims or enforce cross-campaign collision.
3. **Production GO separately:** inspect actual Production campaigns rather than assume the earlier baseline. Deploy same approved code. If old `daily-active-2026` exists and is active, End it through Admin. Create/activate the new draft as above. Do not automatically write Production records or activate on merge.
4. **Failure path:** Pause the new campaign and fix forward, preserving claim/ledger records; the old ended campaign remains ended. No data migration or refund/backfill. Operator records environment, campaign IDs, status and deployment SHA using existing means.

**Operational clarification:** A single PR delivers the implementation, but campaign lifecycle data is not repository state. The two Admin status operations happen after environment deployment and require explicit environment-specific authorization. Do not put a hidden Stage/Production DB update in the PR or claim that merge automatically activates the campaign.

## Constitution notes / breaking impact

- Deeply review and double-check; simplify/refactor without changing existing functionality; use existing packages/classes/methods.
- Call out breaking impact: old fixed 20 CH campaign stops permanently when set to `ended`; the Admin Daily template switches from generic 20 CH to configurable Poker Daily; new Poker Daily displays dynamically calculated amount instead of constant scalar `amount`. Generic campaigns and Welcome stay compatible.
- JSP-compatible JS only, CSS one physical line per selector, CSP SHA whitelist if any inline script is added, and diagnostic logs through `klog`.
- Only fundamental tests; no large test matrix, dependencies, extra framework, tooling cleanup, broad new feature flags, or future-proof subsystem.
- No commands for repository operations in this SpecKit; no migrations and no unapproved Stage/Production actions.


## Implementation self-review

Implemented the scoped reward parser/progression in existing Bonus helpers, opt-in endpoint projection, four Admin inputs and real lobby Claim. The existing campaign row lock now protects fresh status/configuration/eligibility/UTC validation; Admin edits/status transitions take that same row lock. No legacy cross-campaign mechanism or scheduler change was added.

Fundamental real-PostgreSQL verification is `tests/bonus-campaigns.transaction.test.mjs`, registered in the existing runner and isolated PostgreSQL job. It proves native JSONB Admin configuration, simultaneous Claim serialization, an End lock blocking a stale-preflight Claim, and complete real-ledger/idempotency rollback on missing receipt. CI auth fixtures include `created_at` and `is_anonymous`; no shared database fixtures are used. JSONB writes cast serialized text to JSONB explicitly, and Admin tolerates existing JSON-string configuration without rewriting old records.

Local verification: 35 Bonus/Admin/endpoint/scheduler/Welcome tests, the focused PostgreSQL transaction test, syntax, CSP and lifecycle guards passed. The full local regression runner passed. Remote CI evidence will be reported in the PR. Only existing Admin template expectations/fixtures were updated; no new UI test suite or inline script. Deploy Preview is intentionally suppressed with `[skip netlify]` while deployment remains unauthorized. Runtime/mobile verification follows separate deployment approval; the PR stays Draft for owner code review.


## P2 review correction — mandatory payment evidence

`validDailyEvidence()` returns null if `fetchPromoTransaction()` finds no matching PROMO_BONUS transaction. Existing transaction ID, amount and streak-day comparisons remain mandatory. This also denies unverifiable receipts whose matching transaction is absent from the existing lookup; no reconstruction, fallback history scanner or additional storage is introduced.

One fundamental case in `tests/bonus-campaigns.behavior.test.mjs` removes the matching transaction after a valid claim and verifies both today's replay and tomorrow's continuation deny eligibility/payout without any extra ledger write. The case failed before the fix and passed afterward; all 36 targeted Bonus/Admin/endpoint/scheduler/Welcome tests and syntax checks passed locally. Self-review confirms the change only tightens new Daily receipt validation. Remote CI and the final SHA are recorded in the Draft PR description; deployment remains intentionally skipped.
