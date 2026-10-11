# Feature Specification: Poker Daily Bonus

**Issue**: [#1079](https://github.com/krzysztofcal/arcadePlatform/issues/1079)
**Date**: 2026-10-11
**Status**: analysis/design only, awaiting owner review and implementation approval.
**Code baseline**: `origin/main`, `1ba99776ff427783f858e075d3474e144c3947b3`.
**Authority**: latest issue economics/replacement decisions and owner's current request. Approval of economics is not permission to implement, deploy, apply migrations, mutate campaigns, grant CH or merge.

## User Scenarios & Testing

### US1 — Claim consecutive daily rewards (P1)
A registered, signed-in Arcade account manually claims once per UTC calendar day without a Poker activity requirement.

**Acceptance scenarios**:
1. Consecutive successful claims pay 25, 50, 100, 200, 200, 200… CH. Day 4+ is a reward plateau; streak length does not wrap or stop at four.
2. A complete unclaimed UTC day resets the next claim to Day 1/25 CH; there is no backfill or rolling 24-hour cooldown. Claims at 23:59 UTC and just after 00:00 UTC can be consecutive days.
3. Duplicate clicks, concurrent tabs, lost-response retry, reload and reconnect neither pay twice nor advance the streak twice.
4. All registered accounts qualify, including accounts older than the campaign. Guests, unauthenticated requests and anonymous Supabase users do not qualify. No email-verification or Poker-hand requirement is introduced.
5. Pause/End or an invalid configuration prevents payout. Unclaimed UTC days during a pause also count as missed days; no automatic catch-up or pause credit.

**Fundamental verification**: deterministic server progression/UTC/idempotency tests, including a long plateau and a missed day, plus a narrowly scoped real PostgreSQL two-connection race test in an isolated test database.

### US2 — Replace the legacy Stage campaign safely (P1)
The operator replaces `daily-active-2026` (20 CH) with one new streak campaign, preserving every prior receipt and ledger entry.

**Acceptance scenarios**:
1. The new campaign is created as draft. After verified code/schema and an explicit Stage cutover GO, old active becomes paused; confirm no further grant can occur; only then activate the new campaign. They are never concurrently claimable.
2. An account paid by the old campaign on the cutover UTC day cannot receive the new bonus that day, including a racing/in-flight old request. The next eligible day starts at new Day 1; legacy claims never advance the new streak.
3. An account not paid by the old campaign that day may receive new Day 1 immediately after activation.
4. Cross-campaign same-day protection applies to the legacy code and all replacement Poker Daily campaigns, not to Welcome Bonus or unrelated campaigns—even those using generic `claim_policy=daily`.
5. After the first replacement has been published, attempts to reactivate the legacy campaign fail, including when its successor is paused or ended. Claim also fails closed for unsafe overlap/state. Ending the legacy campaign after acceptance requires explicit operator approval.
6. No old claims, transactions, metadata or balances are deleted/reinterpreted. A retry reports an existing payment rather than claiming a different campaign automatically.

### US3 — Configure and stop rewards in existing Admin (P2)
The operator configures four day amounts and uses existing campaign status controls.

**Acceptance scenarios**:
1. One campaign contains four positive safe-integer CH amounts, initially `[25,50,100,200]`; the fourth repeats indefinitely. `max_total_claims=null`, `eligibility_type=all_accounts`, `claim_policy=daily`.
2. Reward/identity/eligibility terms become immutable upon publication, following the existing stricter Admin policy. Once claims exist, they cannot be rewritten even while paused. Changed economics use a new campaign and restart that campaign's streak; shared daily protection still applies.
3. Pause/End are the existing kill switch. No budget framework, aggregate payout cap, scheduler, new bonus endpoint or streak table is added.
4. The dedicated Poker Daily template cannot schedule automatic activation; cutover is manual. Other campaign templates and their existing scheduler remain functional.

### US4 — Show truthful lobby progress (P2)
The existing Daily Bonus shortcut/modal shows account-specific server status and performs a real manual Claim.

**Acceptance scenarios**:
1. Reuse `dailyDialog`, `bonus-days`, reward art and portrait/landscape layout from #1069. Replace illustrative account states, “Amount not configured” and design-only Claim with server-derived rewards and status.
2. Display Day 1/2/3/4+, actual uncapped streak day, claimable/claimed/paused/unavailable/sign-in state and next UTC reset. Day 5 is not Day 1.
3. Before POST or after midnight/focus/auth changes, reload status. Server always rechecks inside its payout transaction regardless of UI state. Client time/countdown never grants eligibility.
4. While a claim is pending, disable repeated UI submission. Only authoritative success yields reward copy; a replay shows already claimed, not a second success. Preserve existing `chips:tx-complete` wallet/progression refresh.
5. Account A's response cannot appear after logout or A→B→A switching: use the existing `lobbyIdentityGeneration` guard. Do not persist progress or authority in browser storage.

## Functional Requirements

- FR001: Extend existing Bonus Campaigns/`bonus_claims`, `PROMO_BONUS`, GENESIS USER(+)/SYSTEM(-) entries and `postTransaction(..., tx)`; no direct balance write.
- FR002: Derive progression from the new campaign's successful receipts. Store server-derived `streak_day` in existing claim/transaction metadata; today's receipt is replay evidence, yesterday's receipt determines continuation. Invalid/missing new-format evidence fails closed; legacy evidence is only for same-day exclusion.
- FR003: Keep existing per-campaign period keys/idempotency strings. Add a cross-campaign Daily family check under a shared purpose-specific transaction lock; distinct campaign keys alone are insufficient.
- FR004: Inside the atomic claim transaction re-read the full locked campaign, registration/non-guest status, eligibility, date window, reward configuration, UTC day, same-day evidence and previous new-campaign receipt. Preflight GET is advisory only.
- FR005: Use one DB UTC decision instant after lock waits, immediately before payout validation. Do not derive entitlement from request arrival, browser clock or transaction-start `now()`. Receipt period and explicit `claimed_at` reflect this decision. If the period changes during validation, abort without writes and require a fresh status/claim. Commit may follow the validated decision instant; commit time does not retroactively move the claim's period.
- FR006: Ledger transaction, balanced entries and `bonus_claims` insert commit together. Missing/invalid transaction or receipt result must throw/rollback, not return `claimed=true`.
- FR007: Preserve the default GET `{items}` claimable-only behavior and ordinary POST contracts. Add an opt-in status projection to the same endpoint for the Daily panel, including claimed/paused states and progression. Do not repurpose legacy fixed campaign `amount` for all campaigns.
- FR008: Reuse Admin validation/form/status operations. Add one campaign reward configuration field, not a configuration/rules subsystem. Retain existing RLS/deny-all public access; read/write through authenticated existing backend.
- FR009: JSP-compatible global/IIFE browser JS; `klog`, one physical CSS line per selector; no new inline script planned, otherwise CSP SHA in the same change. No Poker WS/gameplay/tier/access changes.

## Key Entities

- `bonus_campaigns`: existing fields plus proposed nullable `daily_rewards` JSONB/API `dailyRewards`; reserved new `campaign_type=poker_daily`. Existing `amount` remains scalar, equal to Day 1 for the new type.
- `bonus_claims`: unchanged table/uniqueness; existing metadata additionally holds `streak_day`, `reward_day` (1–4), `amount`, `claim_period_key`, `daily_bonus_family=poker_daily`, `claim_decision_at` for new claims. Legacy rows stay intact.
- `chips_transactions`, `chips_entries`, durable `chips_transaction_idempotency`: existing economic/idempotency evidence; no new transaction type or funding account.

## Success Criteria

- Every account/day emits at most one Poker Daily payout across legacy/replacement campaigns; ordinary Welcome Bonus remains independently claimable.
- Every successful new-campaign payout matches authoritative day/config; Day 100 still pays the fourth amount; a missed day returns to Day 1.
- Pause/config/date/eligibility races cannot grant from stale preflight data; ledger/claim failures leave no partial economic state.
- Stage transition preserves historical evidence and passes explicit cutover and no-overlap checks before Production is considered.

## Scope and Approval Boundaries

Only these three planning documents are produced now. No code, SQL migration file, database connection/write, campaign mutation, CH grant or deployment is authorized by this planning task. The owner separately authorized publishing these three documents in a Draft PR for review; that authorization does not approve implementation or operational actions. The issue reports seven earlier Stage claims and no enabled Production Daily at its previous audit; these are historical reports, not freshly verified environment facts.

The future code/schema design, including manual-only activation and the proposed reserved campaign type/column, awaits review. Environment identities, actual old claims/configuration, deployment SHA and cutover date are operator preflight inputs, not unresolved reward economics. See plan.md for separate implementation, Stage schema/deploy/cutover and Production gates.
