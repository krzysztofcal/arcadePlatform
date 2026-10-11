# Feature Specification: Poker Daily Bonus (#1079)

**Issue:** https://github.com/krzysztofcal/arcadePlatform/issues/1079
**Baseline:** main `1ba99776ff427783f858e075d3474e144c3947b3`
**Status:** owner approved implementation in Draft PR #1084. Deployment, live database/campaign changes, CH grants and merge remain unauthorized.

## Latest owner decision — simple, no-migration replacement

Arcade Poker has no external users yet. Retire `daily-active-2026` (fixed 20 CH) and start one new Poker Daily streak. A one-time same-day 20 CH + 25 CH payment is explicitly acceptable. **Do not add any legacy/new cross-campaign exclusion, shared advisory lock, unique family index, historical-orphan scanner, legacy receipt migration or special cutover mechanism.** Legacy records remain untouched; they are ignored by the new streak.

This feature requires **no SQL migration**: use existing `bonus_campaigns.eligibility_config` JSONB for the four rewards and existing `bonus_claims.metadata` for the streak. One PR (#1084, after implementation GO) may contain all implementation files and planning documents. State changes for existing campaigns are made through Admin *after the application is deployed*, not by merging the PR.

## User scenarios and acceptance

### US1 — Daily streak (P1)
- Signed-in, non-anonymous Arcade accounts, including previously registered users, may manually claim once per UTC calendar day. No poker play or email verification requirement.
- New campaign's consecutive successful days pay 25, 50, 100, 200, 200, 200… CH. Day 100 still pays 200 CH; streak length never wraps to Day 1 after Day 4.
- Missing an entire UTC day resets the next successful claim to Day 1/25 CH; no catch-up. Two claims on opposite sides of 00:00 UTC can be consecutive days.
- Duplicate/replayed/concurrent requests for the same account, campaign and UTC day never create two payments or advance the streak twice.
- Payout uses existing PROMO_BONUS, USER(+)/SYSTEM GENESIS(-), one atomic ledger transaction + claim receipt, existing per-campaign/day idempotency. Pause/End, ineligible or invalid configuration means no payout.

### US2 — Replace old 20 CH campaign (P1)
- Create the new `poker_daily` campaign as draft. Once the implementation is deployed and verified with environment-specific authorization, **End** the old `daily-active-2026` in existing Admin, then **Activate** the new draft. A short downtime between these actions is acceptable.
- No separate cutover PR, database migration, cleanup, manual SQL edit or payout script. The old `ended` campaign cannot be reactivated by the existing Admin lifecycle.
- An account paid 20 CH earlier on the same UTC day may also claim new Day 1/25 CH; this is intended and does not need testing as a collision failure. Old claims neither continue nor reset the new streak.
- Preserve old transactions, claims, ledger balances and evidence as-is. New claim/projection paths never need to inspect legacy records.

### US3 — Configure via existing Admin (P2)
- Use one campaign type `poker_daily` with `eligibility_config.daily_rewards=[25,50,100,200]`, `amount=25` (Day 1 compatibility), `claim_policy=daily`, `eligibility_type=all_accounts`, `max_total_claims=null`.
- Validate exactly four positive safe-integer rewards and the required type/policy/audience/cap in the backend; all values are backend configuration, never frontend-authoritative literals.
- Once published, rewards and eligibility terms cannot be changed; new economics require a new campaign. Admin keeps Pause/End, no automatic rewards or new scheduled job. New Poker Daily is manually activated from a draft; unrelated Bonus Campaigns remain unchanged.
- The old generic 20 CH Daily template is replaced with the Poker Daily streak template; ordinary generic daily campaigns remain supported by their existing API.

### US4 — Truthful Poker lobby (P2)
- Reuse #1069's `poker/index.html` `dailyDialog`, styles, day cards and assets; render the real four amounts, current streak day, claimed/unclaimed state, next UTC reset and a working Claim.
- Add bounded opt-in authenticated Daily status to existing `GET /.netlify/functions/bonus-campaigns`; preserve default claimable-only `{items}` and ordinary Welcome Bonus API. Before new activation, show unavailable state instead of pretending the old 20 CH campaign is a streak.
- POST always validates again server-side. The client never decides awards. Only a newly successful payment emits the existing chips refresh; duplicate shows already claimed.
- Refresh on opening, after claiming, on auth/account changes and at UTC reset while the modal is open. Guard stale responses via existing `lobbyIdentityGeneration`; guests see sign-in/unavailable, not fake progress.

## Data and server invariants

- `bonus_campaigns`: no new columns. Store four amounts under existing JSONB `eligibility_config.daily_rewards` for `campaign_type=poker_daily`; other campaign types ignore this key.
- `bonus_claims`: preserve existing unique (`campaign_id`, `user_id`, `claim_period_key`). For new receipts add metadata `streak_day`, `reward_day` (1–4), actual `amount`, and authoritative `claim_period_key`. Previous new-campaign day's receipt determines continuation. A missing yesterday means Day 1; invalid new-campaign receipt evidence denies rather than guessing. A matching PROMO_BONUS transaction is mandatory: missing transaction, mismatched transaction ID, award amount or streak day rejects the receipt.
- `chips_transactions`/`chips_entries`/idempotency registry: unchanged. Record the actual payout and matching claim atomically. No new payout path, enum, funding account, cron or migrations.
- On the claim transaction acquire the existing campaign row lock, reload authoritative status/window/type/config/eligibility and use a database UTC decision instant to derive the period/amount. Admin End and claim must serialize on that row; no legacy family lock is required. Match new claim timestamps to the decision period. Fail or rollback on incomplete ledger/receipt writes.
- Legacy fixed claims are not queried for new entitlement. Concurrent old/new payouts on cutover day are explicitly allowed.
- Preserve RLS and authenticated access; do not expose account identifiers, private receipt history, or trust browser-supplied amounts/day.

## Breaking/operational impact and approval

- The old `daily-active-2026` is irreversibly **Ended** when each environment is cut over; old 20 CH daily rewards stop. Existing generic fixed-daily campaign mechanics and Welcome Bonus stay available.
- `poker_daily` uses the existing JSONB field for four rewards and yields a **dynamic** daily payout; new GET/POST projection must distinguish actual awarded amount from Day 1 scalar `amount`.
- One implementation PR, **no schema migration**, but Admin campaign End/Create/Activate are real environment writes and cannot happen from PR merge alone.
- Keep Stage and Production rollouts separately authorized. The implementation in this Draft PR does not authorize campaign changes, CH grants, deployment or merge.

## Fundamental acceptance tests

Extend existing backend tests for days 1–6 and 100, missed-day reset, UTC boundary, duplicate/concurrent same-day claim, locked Pause/End-vs-claim, invalid reward config, ledger/claim atomic rollback, Welcome compatibility and opt-in GET status. Register tests in the existing CI runner/isolated PostgreSQL job where required; no UI/CSS/JSP snapshot suite or new testing framework.


## UX clarification after Preview review

The panel stays viewable without signing in. It permanently displays “Daily rewards are available only to signed-in Arcade players. Guest play does not qualify.” below its heading, including landscape. Signed-out viewers have a “Sign in / Create account” button using existing `openSignIn()`.

Distinguish a successful status read with no new campaign (“Daily Bonus is not active yet.”), paused campaign (“Daily Bonus is temporarily paused.”), signed-out account and a failed API read. No fixed legacy campaign is represented as a new streak; Claim remains governed by authoritative eligibility. Owner-reported Stage inventory still contains only legacy `daily-active-2026`; this UX change does not create/activate campaigns.
