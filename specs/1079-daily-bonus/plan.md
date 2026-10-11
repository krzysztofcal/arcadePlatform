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


## UX follow-up

In `poker/poker.js:renderDailyBonus`, keep a local `dailyLoadError` flag separate from null `dailyState`; clear it on refresh/account change and set it on failed status read. Render distinct inactive/paused/signed-out/error messages and toggle existing-panel `dailySignIn` CTA. Its handler closes the panel and invokes existing `openSignIn()`. No changes to backend, Claim authority or response-generation guards.

`poker/index.html:dailyDialog` adds permanent `dailyEligibility` copy and `dailySignIn` button. Replace the narrow-landscape CSS rule hiding heading paragraphs with readable small text, preserving one physical line per selector. Check portrait/landscape and sign-in behavior on Deploy Preview using read-only browser inspection and simulated status responses; do not submit a Claim or mutate environments. Existing syntax/CSP/lifecycle controls apply; no UI suite, new scripts or inline CSP changes.


## Stage GO and mobile status follow-up

Use deployed `admin-stage-identity` and existing `admin-bonus-campaigns` GET/create/set_status APIs: verify Stage identity/backend, create or reuse uniquely coded correct Draft, verify full configuration, End `daily-active-2026`, activate new Draft, read back both campaigns and authenticated Daily status without Claim. Move existing `dailyDisclaimer` live region before reward cards in `poker/index.html`; cache its element in current `poker/poker.js` renderer. Keep existing classes, sign-in CTA and payout logic.


## Dedicated Stage identity preflight and resumption

Reuse `requireAdminUser()` / `parseAdminUserIds()` in `netlify/functions/_shared/admin-auth.mjs`, current Supabase Auth login and `admin-bonus-campaigns` GET/create/set_status. No application changes are needed. `supabase-admin.mjs` resolves primary `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` before available V2 fallbacks; frontend build writes `js/auth/supabase-config.js` from public URL/anon configuration.

Observed on PR1084 Preview: Netlify context `deploy-preview`; URL, DB target and expected Stage ref identify `krydukthwdvccggbyjfw`; `CHIPS_ENABLED=1`. `ADMIN_USER_IDS` has two existing IDs, one matching a Stage Auth user. Preserve both, append only the new technical UUID to this context. Production is separately scoped and must remain unchanged.

1. Obtain controlled email and VPS host/approved existing secret mechanism identifiers from owner, without requesting credential values in chat. Store generated credentials directly there; no local credential-file fallback.
2. Provision the Stage Auth identity using supported Supabase Auth administration, confirm controlled email when required, record only actual UUID. Current Stage Auth settings: email enabled, signup enabled, automatic email confirmation disabled. Stop for required manual confirmation.
3. Extend only Preview allowlist and refresh the affected Preview deployment so the new setting is effective. Preserve owner's IDs.
4. Log in using real Supabase Auth credentials from VPS secrets. Keep access/refresh tokens out of files, repository, PR and logs. Verify authenticated Supabase user/JWT subject, existing Stage Auth row, successful Admin GET and `admin-stage-identity` matches across URL/DB/service role; verify Production rejection and no Production allowlist change. Environment configuration alone is not authorization evidence.
5. Only then resume T020 through authenticated existing Admin: recheck no duplicate, create and verify `daily-streak-2026` Draft, End legacy 20 CH, Activate new, read back statuses/rewards/eligible Day1 25CH without claiming. Stop on any failure.

Current preflight stops before provisioning: controlled email and approved VPS secret storage/access not supplied. No Auth creation, environment edits, campaign operations or real-session authorization checks performed.

## Stage execution and reusable AI-agent operator (2026-10-11)

Owner-authorized Stage transition completed atomically via the connected Supabase management connector, with independent readback: legacy `daily-active-2026` = ended, `daily-streak-2026` = active, rewards `[25,50,100,200]`, no cap/end date. This replaces the earlier blocked technical-account route; its preflight was correct but no longer necessary.

For future agents, `.github/workflows/stage-bonus-campaigns.yml` (owner-only dispatch from main) runs `scripts/ops/stage-bonus-campaigns.mjs` on the existing Stage runner with existing GitHub Stage database secrets. Actions: inspect, create daily Draft via `admin-bonus-campaigns.mjs::createBonusCampaign`, atomic switch via `setBonusCampaignStatus` under row locks, and pause/end. No generic privileged Supabase Auth account, Production secrets, scheduled automation or new migration. Exact GO strings include parameters; verify host/ref/system identifier. `tests/stage-bonus-campaigns.behavior.test.mjs` covers only critical action/target/GO guards. Workflow becomes usable **after merge**, not merely after this Draft PR push; do not dispatch it until approved.

Notes: review deeply and refactor for minimal complexity; reuse existing packages and backend methods; only fundamental tests; preserve JSP compatibility and single-line CSS if frontend changes, update CSP SHA for any added inline script, log using `klog`; highlight that ending a campaign cannot be undone and `created_by=NULL` on workflow-created drafts reflects a GitHub operator rather than impersonating an Auth user. No unauthorized Production actions.


## One-click Daily reward and success emphasis

Constitution check: existing IIFE/global JS, scoped one-line CSS, klog, no inline script/framework/dependency, no maintained UI/CSS tests. In poker/poker.js, route the Daily shortcut into claimDailyBonus; use one refreshDailyBonus(true) preflight, suppress other refreshes while pending, project claimed/alreadyClaimed POST fields onto the preflight dailyState, and use the same UTC refresh timer without further GET on success. Keep existing error reconciliation GET and server-side status/config/UTC/eligibility recheck. poker/index.html adds a small existing-style success live region above reward cards; poker/poker.css adds scoped claimed/success glow and finite shine with reduced-motion handling. Extend the existing fundamental POST response contract in tests/bonus-campaigns-endpoint.behavior.test.mjs; use ephemeral Preview mocks for flow/races/visuals. Daily happy-path requests: 4 → 2 (GET/GET/POST/GET → GET/POST); existing asynchronous chip badge/progression/Welcome refreshes remain outside this count and do not block rendering. No API/schema/protocol break; intentional UX impact: opening the shortcut now claims when eligible.


### One-click self-review

Latency came from a second user click and redundant pre-Claim/post-success status reads. The foreground Daily path previously required four HTTP calls (open GET → second preflight GET → POST → status GET); now it requires two (GET → POST) and no second click. Guests require zero Daily requests; already-claimed users one GET; duplicate POST results render without another GET; uncertain failure adds one reconciliation GET. Existing asynchronous chips badge/Welcome/progression event-driven refreshes are preserved, outside this foreground count, and never awaited for success rendering. Server-side transaction preflight/locked rechecks remain intact.

Touched files: `poker/poker.js` (shortcut, receipt projection, reset timer reuse, pending guard and auth-callback render order); `poker/index.html` (success live region); `poker/poker.css` (gold claimed/receipt emphasis, finite animations, reduced motion and compact landscape); `tests/bonus-campaigns-endpoint.behavior.test.mjs` (existing receipt contract assertions); these three SpecKit documents. No client module/backend/WS/config/dependency/schema edits.

Intentional behavioral impact: the explicit shortcut click now claims when eligible, so it is no longer a preview-only action. Background login/reload/focus/UTC/reconnect never claim. Historical clients remain compatible with unchanged API and per-campaign/day idempotency. No breaking API/protocol/storage impact, no migrations or actual agent payout smoke. Success requires `claimed:true`; duplicate/already-claimed results do not celebrate. Account switches discard old responses and immediately clear the receipt.
