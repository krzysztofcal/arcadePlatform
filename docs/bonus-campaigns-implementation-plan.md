# Bonus Campaigns Implementation Plan

## Decision

Refactor the current PR3 welcome bonus implementation into a small `bonus_campaigns` system before merge.

Reason:

- Arcade Hub plans to support anniversaries, seasonal events, returning-player bonuses, selected-account rewards, and future promotional campaigns.
- The current PR3 implementation is safe for one `WELCOME_BONUS`, but it hardcodes one campaign in code, env names, endpoint names, UI copy, and transaction type.
- A minimal campaign system avoids cloning `welcome-bonus` into `anniversary-bonus`, `winter-bonus`, `returning-player-bonus`, etc.

This plan keeps scope intentionally small. It does not introduce a full rule engine or complete admin CRUD in the first PR.

## Current Code Analysis

### Existing PR3 Welcome Bonus

Files:

- `netlify/functions/_shared/welcome-bonus.mjs`
- `netlify/functions/welcome-bonus.mjs`
- `js/chips/client.js`
- `js/account-page.js`
- `js/topbar.js`
- `poker/index.html`
- `poker/poker.js`
- `supabase/migrations/20260702000000_chips_welcome_bonus_tx_type.sql`
- `tests/welcome-bonus.behavior.test.mjs`
- `tests/account-page.test.mjs`

Current behavior:

- `GET /.netlify/functions/welcome-bonus` returns eligibility.
- `POST /.netlify/functions/welcome-bonus` claims the bonus.
- Eligibility is hardcoded from `auth.users.created_at >= WELCOME_BONUS_START_AT`.
- Amount comes from `WELCOME_BONUS_CHIPS`, defaulting to `500`.
- Idempotency key is `welcome-bonus:<userId>`.
- Ledger transaction type is `WELCOME_BONUS`.
- Entries use `USER +amount` and `SYSTEM/GENESIS -amount`.
- UI shows claim affordances only after backend status says the account is eligible.

Good parts to reuse:

- Backend decides eligibility.
- Frontend never grants chips.
- Success copy is shown only after a real successful POST.
- Guest chips are not transferred.
- Existing `postTransaction` ledger helper handles balanced entries, idempotency, and account creation.
- `SYSTEM/GENESIS` is the existing mint-like offset convention.
- `klog` events avoid secrets and provide operational visibility.

Limitations:

- One campaign only.
- One hardcoded eligibility rule.
- One hardcoded endpoint.
- One hardcoded transaction type.
- Env-based campaign config is not suitable for many campaigns.
- No campaign table, allowlist, claim table, preview, or admin lifecycle.

### Ledger

Relevant files:

- `netlify/functions/_shared/chips-ledger.mjs`
- `supabase/migrations/20251218213520_chips_ledger.sql`
- `supabase/migrations/20251218230000_chips_ledger_fixups.sql`
- `supabase/migrations/20251220000000_chips_allow_genesis_overdraft.sql`
- `supabase/migrations/20251221000000_chips_seed_treasury_genesis.sql`

Existing ledger strengths:

- Transactions are balanced.
- User balances cannot go negative.
- `SYSTEM/GENESIS` can go negative and is already seeded.
- Transactions support `idempotency_key`.
- Admin ledger filters already expose `tx_type`, `source`, metadata, user, and time range.

Needed change:

- Prefer one generic promotional transaction type:

```text
PROMO_BONUS
```

Campaign identity belongs in transaction metadata:

```json
{
  "source": "bonus_campaign",
  "campaign_code": "welcome-2026",
  "campaign_type": "welcome"
}
```

Do not add a new enum value for every campaign.

### Admin

Relevant files:

- `admin.html`
- `js/admin-page.js`
- `netlify/functions/_shared/admin-auth.mjs`
- `netlify/functions/admin-users-list.mjs`
- `netlify/functions/admin-ledger-list.mjs`

Existing admin patterns:

- Admin access is allowlisted through `requireAdminUser`.
- Admin UI is tab-based.
- Admin endpoints use `CHIPS_ENABLED`, CORS, auth, query parsing helpers, pagination, and safe errors.
- User search already supports exact `userId`, email/text search, created date, sign-in date, balance, and active poker state.

Recommended admin direction:

- Start with read/preview/admin visibility first.
- Add mutating campaign management only after campaign claims are proven safe.

## Target Model

### Tables

#### `public.bonus_campaigns`

Purpose:

- Defines a claimable bonus campaign.

Suggested columns:

```text
id uuid primary key
code text unique not null
title text not null
description text
campaign_type text not null
amount bigint not null
status text not null
starts_at timestamptz not null
ends_at timestamptz
eligibility_type text not null
eligibility_config jsonb not null default '{}'
claim_policy text not null default 'once'
max_total_claims bigint
created_by uuid
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Suggested statuses:

```text
draft
scheduled
active
paused
ended
```

Suggested eligibility types for MVP:

```text
all_accounts
created_after
created_before
allowlist
```

Supported claim policies:

```text
once
daily
weekly
monthly
```

Future eligibility types:

```text
inactive_since
played_poker_at_least_n_hands
no_bonus_claimed_since
```

#### `public.bonus_claims`

Purpose:

- Records one claim per user per campaign period.

Suggested columns:

```text
id uuid primary key
campaign_id uuid not null references public.bonus_campaigns(id)
user_id uuid not null references auth.users(id)
transaction_id uuid not null references public.chips_transactions(id)
idempotency_key text not null
claim_period_key text not null default 'once'
claimed_at timestamptz not null default now()
metadata jsonb not null default '{}'
```

Constraints:

```text
unique (campaign_id, user_id, claim_period_key)
unique (idempotency_key)
```

`max_total_claims` is a campaign-wide cap across all claim periods. The claim path must enforce it while holding a row lock on `bonus_campaigns` before posting the `PROMO_BONUS` ledger transaction, so concurrent claims cannot exceed the cap.

#### `public.bonus_campaign_eligible_users`

Purpose:

- Allowlist selected accounts for targeted campaigns.

Suggested columns:

```text
campaign_id uuid not null references public.bonus_campaigns(id)
user_id uuid not null references auth.users(id)
reason text
created_by uuid
created_at timestamptz not null default now()
primary key (campaign_id, user_id)
```

### Idempotency

Use stable campaign-scoped keys. `once` campaigns keep the original key shape:

```text
bonus:<campaignCode>:<userId>
```

Repeating campaigns include the UTC claim period:

```text
bonus:<campaignCode>:<userId>:<claimPeriodKey>
```

Examples:

```text
bonus:welcome-2026:00000000-0000-4000-8000-000000000003
bonus:anniversary-2026:00000000-0000-4000-8000-000000000003
bonus:daily-login:00000000-0000-4000-8000-000000000003:2026-07-07
```

### Ledger Entries

Every successful claim creates one balanced `PROMO_BONUS` transaction:

```text
USER +amount
SYSTEM/GENESIS -amount
```

Transaction fields:

```text
tx_type = PROMO_BONUS
idempotency_key = bonus:<campaignCode>:<userId>[:<claimPeriodKey>]
reference = bonus:<campaignCode>:<userId>[:<claimPeriodKey>]
description = campaign title
created_by = userId
```

Metadata:

```json
{
  "source": "bonus_campaign",
  "campaign_id": "...",
  "campaign_code": "welcome-2026",
  "campaign_type": "welcome",
  "claim_policy": "once",
  "claim_period_key": "once",
  "amount": 500
}
```

## Seeded Welcome Campaign

The current welcome bonus becomes a seeded campaign.

Suggested seed:

```text
code = welcome-2026
title = 500 CH Welcome Bonus
description = Create an account and claim your starter chips.
campaign_type = welcome
amount = 500
status = active
starts_at = 2025-06-01T00:00:00Z
ends_at = null
eligibility_type = created_after
eligibility_config = { "created_at_gte": "2025-06-01T00:00:00Z" }
```

Eligibility:

- Account must be authenticated.
- Campaign must be active and within time window.
- `auth.users.created_at >= eligibility_config.created_at_gte`.
- User must not have a row in `bonus_claims` for this campaign.
- User must not have an existing ledger transaction with the same idempotency key.

## API Shape

### Public user endpoints

Use one generic endpoint family instead of `welcome-bonus`:

```text
GET  /.netlify/functions/bonus-campaigns
POST /.netlify/functions/bonus-campaigns-claim
```

`GET` response:

```json
{
  "items": [
    {
      "code": "welcome-2026",
      "title": "500 CH Welcome Bonus",
      "description": "Create an account and claim your starter chips.",
      "campaignType": "welcome",
      "amount": 500,
      "eligible": true,
      "alreadyClaimed": false,
      "reason": "eligible"
    }
  ]
}
```

`POST` body:

```json
{
  "code": "welcome-2026"
}
```

`POST` success:

```json
{
  "claimed": true,
  "code": "welcome-2026",
  "amount": 500,
  "transactionId": "..."
}
```

Compatibility option:

- Keep `/.netlify/functions/welcome-bonus` as a thin wrapper around campaign `welcome-2026` for one PR if that reduces frontend churn.
- Preferred final state: remove PR3-specific endpoint before merge and update clients to generic campaign APIs.

### Admin endpoints

Add admin endpoints incrementally:

```text
GET  /.netlify/functions/admin-bonus-campaigns
GET  /.netlify/functions/admin-bonus-campaign-preview
GET  /.netlify/functions/admin-bonus-campaign-claims
POST /.netlify/functions/admin-bonus-campaigns
POST /.netlify/functions/admin-bonus-campaign-eligible-users
POST /.netlify/functions/admin-bonus-campaign-status
```

Do not build every endpoint in the first PR. Start with read/preview.

## klog Diagnostics

Use safe events:

```text
bonus_campaign_status_checked
bonus_campaign_claimed
bonus_campaign_skipped
bonus_campaign_failed
bonus_campaign_previewed
bonus_campaign_admin_updated
```

Allowed metadata:

```text
userId
adminUserId
campaignId
campaignCode
campaignType
eligible
alreadyClaimed
amount
reason
transactionId
estimatedEligibleCount
estimatedLiability
```

Never log:

```text
emails
JWTs
access tokens
raw authorization headers
full allowlist uploads
```

## Admin Control Strategy

### Phase 1: Git/migration-controlled campaigns

Use migrations to create campaigns.

Good for:

- Welcome bonus.
- Anniversary event.
- Seasonal event.
- Manually reviewed allowlist import.

Pros:

- Changes are reviewed in PR.
- Audit exists in git.
- Lower risk of accidental mass payout.

Recommendation:

- Use this for the first campaign system PR.

### Phase 2: Admin read/preview UI

Add an Admin tab:

```text
Bonus Campaigns
```

Views:

- Campaign list.
- Campaign detail.
- Claim list.
- Eligibility preview.
- Estimated liability.

Preview must show:

```text
Estimated eligible users
Already claimed users
Max liability = eligibleCount * amount
Campaign status
Time window
Eligibility rule summary
```

### Phase 3: Admin mutating UI

Only after Phase 1 and Phase 2 are proven:

- Create draft campaign.
- Edit draft campaign.
- Upload allowlist.
- Preview eligible users.
- Activate campaign.
- Pause campaign.
- End campaign.

Safety controls:

- Mutating actions require admin auth.
- Activation requires preview.
- Activation should show estimated liability.
- Campaign `code` is immutable after activation.
- `amount` is immutable after activation.
- `eligibility_type` and `eligibility_config` are immutable after activation.
- `status` can move `draft -> scheduled/active -> paused/ended`.
- Avoid editing active campaigns except pausing/ending.

## PR Breakdown

### PR A: Bonus Campaign Schema and Ledger Foundation

Goal:

- Replace single-bonus data model with generic campaign tables and generic ledger transaction type.

Backend/database:

- Add `PROMO_BONUS` to `public.chips_tx_type`.
- Add `bonus_campaigns`.
- Add `bonus_claims`.
- Add `bonus_campaign_eligible_users`.
- Add indexes and unique constraints.
- Add RLS deny-all policies, matching ledger/admin tables.
- Seed `welcome-2026` campaign.
- Keep or remove `WELCOME_BONUS` migration decision:
  - Preferred before merge: replace `WELCOME_BONUS` usage with `PROMO_BONUS`.
  - If migration already reached remote DB, keep enum value but stop using it.

Shared backend:

- Add `netlify/functions/_shared/bonus-campaigns.mjs`.
- Implement campaign loading.
- Implement eligibility checks for:
  - `all_accounts`
  - `created_after`
  - `created_before`
  - `allowlist`
- Implement claim helper using `postTransaction`.
- Use `SYSTEM/GENESIS` offset.
- Use idempotency `bonus:<campaignCode>:<userId>`.
- Insert `bonus_claims` after successful ledger transaction.
- Handle retry/idempotent existing transaction safely.

Tests:

- Campaign active window is enforced.
- Created-after welcome campaign eligibility matches current PR3 rules.
- Allowlist eligibility works.
- Repeated claim does not grant a second bonus.
- Ledger uses `PROMO_BONUS` and `SYSTEM/GENESIS`.
- Guest chips are never transferred.

Acceptance:

- `welcome-2026` can be evaluated from DB.
- Claim writes one ledger transaction and one claim row.
- Repeated claim is idempotent/no second grant.
- Existing welcome bonus semantics are preserved.

Breaking impact:

- Existing PR3 `WELCOME_BONUS_*` envs are no longer campaign source of truth.
- If `WELCOME_BONUS` enum migration was applied remotely, it remains harmless but deprecated.

### PR B: Public Campaign API and Client Refactor

Goal:

- Replace `welcome-bonus` endpoint/client with generic bonus campaign status/claim.

Backend:

- Add `netlify/functions/bonus-campaigns.mjs` for `GET`.
- Add `netlify/functions/bonus-campaigns-claim.mjs` for `POST`.
- Optional compatibility wrapper:
  - `welcome-bonus.mjs` calls campaign code `welcome-2026`.
  - Remove wrapper before final merge if frontend is fully generic.

Frontend:

- Update `js/chips/client.js`:
  - `fetchBonusCampaigns()`
  - `claimBonusCampaign(code)`
- Keep temporary aliases only if useful:
  - `fetchWelcomeBonusStatus()` maps to first/known welcome campaign.
  - `claimWelcomeBonus()` maps to `welcome-2026`.
- Update account page to render claimable campaigns.
- Update topbar badge to show a campaign indicator from generic campaign list.
- Update poker lobby banner to use generic campaign list.

Tests:

- Public `GET` returns claimable campaigns.
- Public `POST` claims by code.
- Unknown/inactive/ineligible campaign does not claim.
- Account page success appears only after successful POST.
- Topbar/lobby hide campaign after claim.

Acceptance:

- Current UI behavior remains: eligible welcome users see `500 CH` claim affordances.
- The UI is no longer hardcoded to `WELCOME_BONUS_*` endpoint names.

Breaking impact:

- None expected for users.

### PR C: Admin Read and Preview

Goal:

- Let admins inspect campaigns and estimate impact before activation.

Backend:

- Add `admin-bonus-campaigns` list/detail endpoint.
- Add `admin-bonus-campaign-preview` endpoint.
- Add `admin-bonus-campaign-claims` endpoint.
- Reuse `requireAdminUser`.
- Reuse admin pagination and timestamp parsing helpers.

Admin UI:

- Add `Bonus Campaigns` tab to `admin.html`.
- Add campaign list with status, amount, start/end, claimed count.
- Add campaign detail panel.
- Add preview panel:
  - estimated eligible users,
  - already claimed,
  - max liability,
  - sample users if useful.
- Add claims table.

Tests:

- Admin endpoints require admin.
- Preview returns estimated eligible count and liability.
- Claims list filters by campaign.

Acceptance:

- Admin can review campaign state and risk without mutating anything.

Breaking impact:

- None expected.

### PR D: Admin Allowlist Management

Goal:

- Safely support bonuses for selected accounts.

Backend:

- Add admin endpoint to add/remove/list allowlisted users.
- Support exact user ID and admin-side email lookup.
- Store only `user_id` in allowlist rows.
- Validate campaign is `draft`, `scheduled`, or `paused` before allowlist mutation.

Admin UI:

- Add allowlist section in campaign detail.
- Add exact user ID input.
- Add email/user search picker.
- Add CSV paste/upload only if parsing can stay simple and safe.

Tests:

- Non-admin cannot mutate allowlist.
- Allowlisted user is eligible.
- Non-allowlisted user is not eligible.
- Removing a user prevents future claim if not already claimed.
- Removing does not revoke already-claimed chips.

Acceptance:

- Admin can target selected accounts without touching ledger manually.

Breaking impact:

- None expected.

### PR E: Admin Campaign Draft/Create/Status Controls

Goal:

- Move from migration-controlled campaigns to controlled admin-created campaigns.

Backend:

- Add create draft campaign endpoint.
- Add update draft campaign endpoint.
- Add status transition endpoint:
  - `draft -> scheduled`
  - `draft -> active`
  - `scheduled -> active`
  - `active -> paused`
  - `paused -> active`
  - `active/paused -> ended`
- Enforce immutable fields after activation.
- Require preview before activation if practical.

Admin UI:

- Add create campaign form.
- Add status buttons with confirmation.
- Display max liability before activation.

Tests:

- Invalid transitions rejected.
- Active campaign immutable fields cannot change.
- Admin action klogs are emitted safely.

Acceptance:

- Admin can run normal campaigns without migrations.

Breaking impact:

- Higher operational power in admin panel; requires careful review.

### PR F: Advanced Segments and Returning Player Campaigns

Goal:

- Add richer eligibility for future lifecycle campaigns.

Potential rules:

- `inactive_since`
- `last_sign_in_before`
- `played_poker_at_least_n_hands`
- `no_bonus_claimed_since`
- `balance_below`

Recommendation:

- Add one rule per PR.
- Each rule needs preview, tests, and clear liability estimate.
- Do not implement a free-form SQL rule editor.

Acceptance:

- Returning-player and lifecycle campaigns can be configured without custom endpoints.

Breaking impact:

- None expected if rules are additive.

## Rewrite Scope for Current PR3

Since this current PR is not merged yet, recommended rewrite target is:

- Implement PR A and PR B in the current PR3 branch.
- Keep PR C+ as follow-up PRs.

That means the current PR3 should deliver:

- Generic campaign schema.
- Seeded `welcome-2026`.
- Generic public campaign status/claim.
- Account page/topbar/poker lobby consuming generic campaigns.
- Current welcome bonus UX preserved.

Do not include in current PR3:

- Full admin CRUD.
- CSV upload.
- Advanced returning-player rules.
- Email reminders.
- Notification persistence.

## Manual Test Plan for Rewritten PR3

Eligible welcome account:

1. Account created at or after `2025-06-01T00:00:00Z`.
2. No `bonus_claims` row for `welcome-2026`.
3. Log in.
4. Account page/topbar/lobby show claim affordance.
5. Claim.
6. Balance increases by `500`.
7. Ledger shows `PROMO_BONUS`.
8. `bonus_claims` contains one row.
9. UI affordances disappear after refresh.

Already claimed account:

1. Claim once.
2. Refresh.
3. No claim affordance.
4. Repeated POST returns no second grant.

Ineligible old account:

1. Account created before `2025-06-01T00:00:00Z`.
2. Log in.
3. No claim affordance.
4. POST cannot claim.

Allowlist campaign:

1. Seed test allowlist campaign.
2. Add one user to allowlist.
3. Only that user sees and claims campaign.
4. Non-allowlisted user cannot claim.

## Open Decisions Before Runtime Implementation

These do not block this planning document, but should be confirmed before coding:

1. Should the current remote `WELCOME_BONUS` enum migration be kept as deprecated if already applied?
2. Should the first campaign transaction type be named `PROMO_BONUS` or `BONUS`?
3. Should `welcome-2026` have no `ends_at`, or should it expire?
4. Should public `GET bonus-campaigns` return all visible campaigns or only claimable campaigns?
5. Should topbar show only the highest-priority campaign if multiple are claimable?
6. Should admin mutating controls wait until a separate PR after the generic public claim path is merged?

Recommended answers:

1. Keep `WELCOME_BONUS` enum if already applied, but do not use it going forward.
2. Use `PROMO_BONUS`.
3. No `ends_at` for welcome bonus initially.
4. Return claimable plus already-claimed visible campaign summaries only when useful; hide ineligible campaigns from normal users.
5. Show one compact topbar indicator using highest priority or soonest-expiring campaign.
6. Yes, admin mutations should be follow-up PRs.
