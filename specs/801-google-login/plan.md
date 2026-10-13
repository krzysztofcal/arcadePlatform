# Google Login V1 Implementation Plan

**Goal**: Google sign-in/sign-up on the existing account page.
**Architecture**: Extend the browser IIFE auth wrapper; existing Supabase client-only callback/session flow and fixed same-origin account return. Supabase owns identity linking. No backend, DB or WS changes.
**Spec**: [spec.md](spec.md)

## Technical Context
Plain global JS, existing Supabase UMD client, Netlify generated public config, PL/EN dictionary. No dependency/tooling/ignore changes.

## Constitution Check
PASS: reuse existing mechanisms; UUID remains authoritative; no financial actions/migrations/Production; no WS deployment required. Tests only critical authentication/redirect/privacy behavior, extending existing tests. Presentation verified with temporary browser tooling outside repository. CSS scoped to account. No new script/CSP host required.

## Implementation
1. `tests/account-auth.contract.test.mjs`: test fixed redirect regardless of supplied return input; disabled config fails closed; controlled callback error and history cleanup; sanitized telemetry. Run before implementation.
2. `js/auth/supabaseClient.js`: `isGoogleEnabled()`, `signInWithGoogle()` and `getAuthCallbackError()`; basic identity scopes; explicit authorize endpoint preflight with `skipBrowserRedirect` to catch disabled provider/network errors before navigation. Validate resulting redirect against configured Supabase origin and `/auth/v1/authorize`; never log provider response. Keep existing implicit callback consumption; clean callback URL when `getSession()` settles. Remove identity-bearing session telemetry and full navigation URL logging.
3. `account.html`, `js/account-page.js`, `js/i18n.js`: one button within sign-in form with local inline G icon; translated pending/error states and busy/retry, hidden unless enabled; reset pending before leaving so browser Back restores a usable form; keep recovery separate.
4. `scripts/generate-build-info.js`: public `AUTH_GOOGLE_ENABLED`, default false, from context-specific environment. `js/analytics.js`: account page_location excludes query/hash before auth callback settles.
5. Set Netlify build flag only in deploy-preview context. Stage Google provider configured with owner assistance if inaccessible. Preserve Production settings.
6. Existing auth/profile/identity regressions, syntax, CSP checks and temporary browser Preview smoke; report real Google login/identity/storage checks only when actually performed.
7. Draft PR with Preview, PASS/FAIL/NOT TESTED and external setup/rollback in `quickstart.md`.

## Research
Official Supabase Google/redirect/linking documentation checked 2026-10-13; PR #701 reviewed as reference only. Current Stage: Google disabled, no client/secret; signup enabled, preview redirect wildcard already allowed. Stage site_url currently Production URL; exact redirect must be verified after Preview exists. Google Cloud tools/session unavailable.

## Risks
Default SDK session may persist Google provider fields; application never reads/copies them. Must audit after real login. Implicit flow retained to avoid changing existing password confirmation/recovery semantics; SDK consumes tokens before cleanup. No caller-controlled return path or pending return state required.
