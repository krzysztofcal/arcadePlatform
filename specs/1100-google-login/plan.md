# Google Login V1 Implementation Plan

**Goal**: Google sign-in/sign-up on the existing account page.
**Architecture**: Extend the browser IIFE auth wrapper; existing Supabase client-only callback/session flow and fixed same-origin account return. Supabase owns identity linking. No backend, DB or WS changes.
**Spec**: [spec.md](spec.md)

## Technical Context
Plain global JS, existing Supabase UMD client, Netlify generated public config, PL/EN dictionary. No dependency/tooling/ignore changes. Only configuration edit is `netlify.toml` deploy-preview `AUTH_GOOGLE_ENABLED="1"`.

## Constitution Check
PASS: reuse existing mechanisms; UUID remains authoritative; no financial actions/migrations/Production; no WS deployment required. Tests only critical authentication/redirect/privacy behavior, extending existing tests. Presentation verified with temporary browser tooling outside repository. CSS scoped to account. No new script/CSP host required.

## Implementation
1. `tests/account-auth.contract.test.mjs`: test fixed redirect regardless of supplied return input; disabled config fails closed; controlled callback error and history cleanup; sanitized telemetry. Run before implementation.
2. `js/auth/supabaseClient.js`: `isGoogleEnabled()`, `signInWithGoogle()` and `getAuthCallbackError()`; basic identity scopes; explicit authorize endpoint preflight with `skipBrowserRedirect` to catch disabled provider/network errors before navigation. Validate resulting redirect against configured Supabase origin and `/auth/v1/authorize`; never log provider response. Keep existing implicit callback consumption; clean callback URL when `getSession()` settles. Remove identity-bearing session telemetry and full navigation URL logging.
3. `account.html`, `js/account-page.js`, `js/i18n.js`: one button within sign-in form with local inline G icon; translated pending/error states and busy/retry, hidden unless enabled; reset pending before leaving so browser Back restores a usable form; keep recovery separate.
4. `scripts/generate-build-info.js`: public `AUTH_GOOGLE_ENABLED`, default false, from context-specific environment. `js/analytics.js`: account page_location excludes query/hash before auth callback settles.
5. Set `netlify.toml` build flag only in deploy-preview context (API env write returned Forbidden). Stage Google provider configured with owner assistance if inaccessible. Preserve Production settings.
6. Existing auth/profile/identity regressions, syntax, CSP checks and temporary browser Preview smoke; report real Google login/identity/storage checks only when actually performed.
7. Draft PR with Preview, PASS/FAIL/NOT TESTED and external setup/rollback in `quickstart.md`.

## Research / current status
Google is configured on Stage through the official Management API, with a dedicated Google Cloud Stage Web client. Existing verified-password account Google login/repeat/reload and SDK storage audit passed before review. New-account registration still requires a second real Google identity absent from Stage; Draft stays open until it passes. Current Stage Site URL is temporarily Preview #1101; proposed canonical address is `https://stage.play.kcswh.pl/account.html`, but a working Stage deployment/DNS must precede changing the fallback. The exact Preview remains in the Stage redirect allowlist. Production is untouched.

## Review corrections
- `getCurrentUser()`: if the SDK is unavailable while deferred scripts are loading, wait for DOMContentLoaded before deciding failure; cleanup when no functioning SDK remains, or after getSession settles. Handle synchronous SDK failures through the same promise error path.
- `signIn()` / `attachAuthSubscription()`: clear stale callback error only on successful password session / SIGNED_IN; failed password attempts preserve it.
- Extend existing critical auth cases; keep all prior tests. Verify error → real Stage password login → sign-out in Preview.
- Temporary Google E2E tooling collects only allowlisted error codes, HTTP status, origin/path checks and boolean results; never persists tokens, email or full callback URL in diagnostic artifacts. Attempt first-callback reproduction during a new Google login; no new exception framework.
- Keep new-user Google registration pending; do not perform CH/Poker operations.

## Risks
SDK-managed Google provider token persistence was observed and documented; no application-owned copies or forwarding observed. Initial first-consent callback failed once, with cause unknown; later existing-user attempts passed. New-user evidence and canonical Stage hosting remain pending.
