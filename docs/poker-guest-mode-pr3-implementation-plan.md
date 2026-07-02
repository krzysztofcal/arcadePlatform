# Poker Guest Mode PR3 - Registration Incentives Implementation Plan

## Goal

PR3 adds a one-time registration incentive for Guest -> Account conversion.

The intended user outcome is:

- Guest players see a clear account-upgrade value proposition.
- An eligible account receives exactly one `500 CH` welcome bonus.
- Guest chips are never transferred into the real account.
- The existing authenticated poker and chip ledger flows remain unchanged.

## Scope

Backend:

- Add a chip ledger transaction type: `WELCOME_BONUS`.
- Grant a one-time `500 CH` welcome bonus.
- Enforce idempotency with `welcome-bonus:<userId>`.
- Expose bonus status and claim data:
  - `eligible`
  - `alreadyClaimed`
  - `amount`

Frontend:

- Replace plain `Create account` guest CTAs with `Create account and get 500 CH Welcome Bonus`.
- Update the Guest poker panel to show the account unlock value.
- Show `Welcome! 500 CH have been added to your account.` only after a real successful bonus claim.

Out of scope:

- No Guest chip transfer.
- No in-place Guest -> Account table upgrade.
- No smart conversion prompt trigger system; that remains PR4.
- No full guest landing redesign; that remains PR5.

## Backend Plan

### 1. Extend Ledger Transaction Types

File: `netlify/functions/_shared/chips-ledger.mjs`

Add `WELCOME_BONUS` to `VALID_TX_TYPES`.

Ledger transaction shape:

- `txType`: `WELCOME_BONUS`
- `idempotencyKey`: `welcome-bonus:<userId>`
- `reference`: `guest_registration_incentive`
- `description`: `Welcome bonus`
- user entry: `+500`
- system offset entry: `-500`, using the existing ledger/system account convention from the current chip ledger implementation
- metadata:
  - `source: "guest_registration_incentive"`
  - `bonus_chips: 500`

Use the existing `postTransaction()` path rather than creating a separate ledger write mechanism.

Before coding, identify the existing system account convention used by chip ledger helpers and document the chosen system account/reference in the implementation PR. If the repository does not expose a clear explicit system account for this source, resolve that first instead of inventing a new ledger source for the bonus.

### 2. Add Welcome Bonus Shared Helper

Proposed file: `netlify/functions/_shared/welcome-bonus.mjs`

Exports:

- `getWelcomeBonusStatus(userId, options)`
- `claimWelcomeBonus(userId, options)`

Status response:

```json
{
  "eligible": true,
  "alreadyClaimed": false,
  "amount": 500
}
```

Claim response:

```json
{
  "claimed": true,
  "eligible": false,
  "alreadyClaimed": true,
  "amount": 500
}
```

Implementation details:

- Bonus amount should come from env with a sane default:
  - `WELCOME_BONUS_CHIPS=500`
- Eligibility must be gated by a required rollout timestamp:
  - `WELCOME_BONUS_START_AT`
- For the initial rollout, set:
  - `WELCOME_BONUS_START_AT=2025-06-01T00:00:00Z`
- New-account detection should query `auth.users.created_at` through `SUPABASE_DB_URL`.
- A user is eligible when:
  - the account exists,
  - `auth.users.created_at >= WELCOME_BONUS_START_AT`,
  - no transaction exists for `welcome-bonus:<userId>`.
- Existing Arcade accounts created at or after `WELCOME_BONUS_START_AT` are eligible for the initial rollout if they have not already claimed the bonus.
- Accounts created before `WELCOME_BONUS_START_AT` are outside the rollout window.
- The endpoint should fail closed when `WELCOME_BONUS_START_AT` is missing or invalid.

### 3. Add API Endpoint

Proposed file: `netlify/functions/welcome-bonus.mjs`

Methods:

- `GET`: return bonus status.
- `POST`: claim the welcome bonus.

API behavior:

- `CHIPS_ENABLED !== "1"` returns `404`.
- Missing or invalid auth returns `401`.
- Ineligible user returns `200` with `eligible: false`.
- Already claimed user returns `200` with `alreadyClaimed: true`.
- First successful claim returns `200` with transaction/account details.
- Repeated claim must not create a second ledger transaction.
- Safe klog diagnostics are required:
  - `welcome_bonus_claimed`
  - `welcome_bonus_skipped`
  - `welcome_bonus_failed`

Logging rules:

- Use `klog`; do not use `console.log`.
- Logs must not contain secrets, JWTs, emails, or access tokens.
- Allowed metadata:
  - `userId`
  - `eligible`
  - `alreadyClaimed`
  - `amount`
  - `reason`
  - `transactionId` when available

Implementation patterns to reuse:

- CORS and auth from `netlify/functions/chips-balance.mjs`.
- Ledger write and error mapping style from `netlify/functions/admin-ledger-adjust.mjs`.

### 4. Idempotency and Race Safety

Use `postTransaction()` with:

```text
welcome-bonus:<userId>
```

The existing chips ledger already has unique idempotency constraints. A duplicate request should resolve as an already-claimed outcome when the payload matches, or as an idempotency conflict if payloads differ.

## Frontend Plan

### 1. Add Welcome Bonus Client

Proposed file: `js/welcome-bonus-client.js`

Expose a small browser API:

- `window.WelcomeBonusClient.fetchStatus()`
- `window.WelcomeBonusClient.claim()`

Auth:

- Reuse `SupabaseAuthBridge.getAccessToken()` or the same auth lookup pattern used by `js/chips/client.js`.

Events:

- Dispatch `chips:tx-complete` after a successful claim so topbar/account chip balance can refresh.
- Optionally dispatch `welcome-bonus:claimed` for page-local UI messaging.

### 2. Update Guest Table CTA and Panel

Files:

- `poker/table-v2.html`
- `poker/poker-v2.js`
- `poker/poker-v2.css`

Update Guest panel copy to:

- `Guest account`
- `Practice poker`
- `Unlimited bot games`
- `Create account to unlock:`
- `+500 CH welcome bonus`
- `Multiplayer`
- `XP progression`
- `Persistent chips`

Add CTA text:

```text
Create account and get 500 CH Welcome Bonus
```

CTA behavior:

- Navigate to `/account.html`.
- Store a session marker before navigation:

```text
poker:guestConversionIntent=welcome_bonus
```

This marker lets account page auto-claim the bonus after login.

### 3. Update Poker Lobby CTA

Files:

- `poker/index.html`
- `poker/poker.js`

Change signed-out account CTA copy from plain sign-in/account text to:

```text
Create account and get 500 CH Welcome Bonus
```

Keep PR3 limited to copy and bonus wiring. The larger lobby split remains PR5.

Do not use `Sign in and get 500 CH` copy. Existing users may sign in, but they must not see misleading bonus claim or success copy.

### 4. Claim After First Login

Files:

- `account.html`
- `js/account-page.js`

Flow:

1. Guest clicks bonus CTA.
2. UI stores `poker:guestConversionIntent=welcome_bonus`.
3. User reaches account page and signs in or creates an account.
4. Account page detects authenticated user and the conversion marker.
5. Account page calls `GET /.netlify/functions/welcome-bonus`.
6. If `eligible`, account page calls `POST /.netlify/functions/welcome-bonus`.
7. Account page shows the success message only after the `POST` returns a real successful claim:

```text
Welcome! 500 CH have been added to your account.
```

8. Account page clears the session marker.
9. Chip balance refreshes via `chips:tx-complete`.

If the user is not eligible or already claimed, clear the marker without showing a success message. Existing signed-in users who are not eligible may continue normally, but the UI must not imply they received the bonus.

## Tests and Validation

Although the roadmap originally said not to write tests unless explicitly requested, PR3 touches the economy ledger. Add focused tests.

Backend tests:

- `GET welcome-bonus` returns `eligible: true` for an account created at or after `WELCOME_BONUS_START_AT` without prior bonus.
- `POST welcome-bonus` creates one `WELCOME_BONUS` transaction.
- Repeated `POST welcome-bonus` does not create a second transaction.
- Already claimed status returns `alreadyClaimed: true`.
- Account created before `WELCOME_BONUS_START_AT` is outside the rollout window and is not eligible.
- Account created at or after `WELCOME_BONUS_START_AT` is eligible when it has not claimed the bonus.
- Missing auth returns `401`.
- `CHIPS_ENABLED !== "1"` returns `404`.

Frontend/static tests:

- Guest panel contains `+500 CH welcome bonus`.
- Guest account CTA contains `Create account and get 500 CH Welcome Bonus`.
- Account page claim flow dispatches chip refresh after success.
- Ineligible or already-claimed account flow does not show the success message.

Suggested commands:

```bash
node --test tests/welcome-bonus.behavior.test.mjs tests/poker-v2-live.behavior.test.mjs tests/static-html.behavior.test.mjs tests/account-page.test.mjs
```

## Acceptance Criteria

- Guest users see the `Create account and get 500 CH Welcome Bonus` account incentive.
- An eligible account receives exactly one `WELCOME_BONUS` transaction.
- For the initial rollout, `WELCOME_BONUS_START_AT` is `2025-06-01T00:00:00Z`.
- Existing Arcade accounts created at or after `WELCOME_BONUS_START_AT` can claim the bonus once.
- Account created before `WELCOME_BONUS_START_AT` is outside the rollout window and is not eligible.
- Account created at or after `WELCOME_BONUS_START_AT` is eligible if it has not claimed the bonus.
- Reloading or retrying does not grant another bonus.
- Repeated `POST` does not grant a second bonus.
- Ineligible or already-claimed users do not see `Welcome! 500 CH have been added to your account.`
- Existing signed-in users do not see misleading `get 500 CH` claim-result copy.
- Guest chips remain temporary and are not transferred.
- Guest chips are never transferred into the registered account.
- Topbar/account chip balance refreshes after bonus claim.
- Existing authenticated poker flow is unchanged.
- Existing ledger integrity and idempotency behavior are preserved.

## Risks

- Eligibility must be implemented from `auth.users.created_at`; do not infer it from a JWT alone.
- `WELCOME_BONUS_START_AT` is required. Missing or invalid configuration must fail closed.
- Do not expose arbitrary ledger entries through a user-facing endpoint.
- Do not add the bonus to guest table state or guest stacks.
- Keep the idempotency key account-scoped and stable.
- Future implementation must reuse existing ledger/auth/chips concepts from the repository and avoid duplicate abstractions.

## Documentation-Only Update Notes

- Do not implement runtime code in this PR.
- Do not change backend or frontend files in this PR.
- Do not add JavaScript.
- Do not add CSS.
- Do not write tests for this documentation-only update.
- Any future runtime logging for this feature must use `klog`.

## PR Summary Template

```markdown
## What changed
- Added `WELCOME_BONUS` ledger support.
- Added welcome bonus status/claim endpoint.
- Added Guest -> Account bonus CTA copy.
- Added account-page claim flow after Guest conversion login.

## Validation
- `node --test ...`

## Breaking impact
- None expected.
```
