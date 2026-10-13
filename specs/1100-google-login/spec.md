# Feature Specification: Google Login V1

**Feature Branch**: `feat/1100-google-login`
**Created**: 2026-10-13
**Status**: Approved functional scope in issue #1100
**Input**: Google sign-in on existing Arcade login; Stage verification and Draft PR; Production requires separate GO.

## User Scenarios & Testing

### User Story 1 - Continue with Google (Priority: P1)
New and returning players use one recognizable Google button on the existing account page, then continue with their Arcade account.
**Independent Test**: Real Google login on the task Preview against Stage.
**Acceptance Scenarios**:
1. A new player signs in with Google and receives a working account/profile; repeating login uses the same identity.
2. An existing player with matching verified email retains their identity, XP, CH and Poker history.
3. Desktop/mobile users see an accessible translated button with the Google G icon.

### User Story 2 - Safe retry and existing authentication (Priority: P2)
**Independent Test**: Existing password/recovery checks plus callback error and retry validation.
**Acceptance Scenarios**:
1. Cancellation or provider failure produces a controlled translated message and allows retry.
2. Password sign-in, signup, sign-out and recovery keep working.
3. Disabled Google configuration leaves password authentication available.

### Edge Cases
Provider not configured; network error; repeated click; callback containing error descriptions/tokens; external return URL; recovery callback; browser back from Google.

## Requirements
### Functional Requirements
- FR-001: Add only Google to `/account.html`; no One Tap, other providers, new backend, migrations or WS changes.
- FR-002: Reuse existing Supabase identity/session and profile architecture; never merge accounts or balances by email in Arcade code.
- FR-003: Return only to the current origin's `/account.html`; ignore caller-supplied return destinations.
- FR-004: Controlled errors, safe retry, URL cleanup after SDK consumes callback; no callback credentials or provider errors in logging/analytics.
- FR-005: Google uses basic identity permissions only. No application-owned provider-token records; existing SDK-managed persistence is retained and must be audited in Stage.
- FR-006: Google visibility is controlled by a non-secret build-context flag, off by default. Configure Preview only; Production activation requires separate GO.
- FR-007: Modify existing `js/auth/supabaseClient.js`, `js/account-page.js`, `js/i18n.js`, `scripts/generate-build-info.js`, `netlify.toml` deploy-preview flag, and account-scoped presentation; sanitize account analytics in `js/analytics.js`.
- FR-008: Tests cover critical auth/security behavior in existing `tests/account-auth.contract.test.mjs`; no rendering/layout/glue suites or dependencies.

### Key Entities
Player identity: existing Supabase UUID; account/profile/progression remain keyed by this identity.

## Success Criteria
### Measurable Outcomes
- SC-001: First/repeat Google login and verified-email identity continuity pass on Stage.
- SC-002: All relevant existing authentication regressions pass; cancellation can be retried.
- SC-003: Preview works on desktop/mobile; no credential leakage or unsafe redirects observed.

## Assumptions
User has authorized implementation, Stage configuration and Preview work in this task. Real Google consent/login may require the owner. Existing public legal pages/contact are used; legal changes require approval. Provider setup is an external dependency, not a reason to add account deletion. Production, financial actions and merge remain unauthorized.

## Review requirements
Callback tokens must be removed when SDK initialization fails, while deferred SDK initialization must retain the opportunity to consume them. Successful password login must clear an old callback error before subsequent sign-out. New-user Google E2E is mandatory before leaving Draft and must include profile creation/repeat UUID without CH/Poker operations. Per owner decision, permanent Stage URL configuration is deferred outside this issue and is not a merge blocker. Preserve the working temporary Preview and exact redirect allowlist, using explicit redirectTo; do not create new hosting or DNS. Diagnostics persist only safe error codes/status/booleans, not tokens, email or full callback URLs. SpecKit directory maps to issue #1100.
