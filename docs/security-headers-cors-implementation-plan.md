# Issue #388 — security headers and exact-origin CORS

Status: accepted implementation plan for this PR.

## Goal and scope

This PR closes the two remaining parts of #388 without changing XP rules, poker rules, WebSocket runtime, persisted data, or browser application APIs:

1. make clickjacking protection consistent while preserving only the same-origin iframe routes used by the game shell;
2. replace wildcard Netlify CORS trust with one exact-origin policy shared by browser-facing Netlify Functions.

The two changes are kept as separate commits/tasks inside one PR so either can be reverted independently.

## Current code findings

### Frame policy

- `_headers` currently declares the strict global pair `X-Frame-Options: DENY` and `frame-ancestors 'none'`.
- `netlify.toml` declares a conflicting global pair `SAMEORIGIN` and `frame-ancestors 'self'`, with a different CSP and `unsafe-inline` script policy.
- `play.html` and `js/frame.js` load same-origin documents from `source.page` in `js/games.json`.
- The current catalog resolves to three route families: `/games-open/*`, `/game*.html`, and `/poker/*`; these are the only routes that need same-origin framing.
- `/games-open/freedoom/*` needs its existing WASM/worker CSP allowances in addition to the framing exception.

### CORS

- `netlify/functions/_shared/xp-cors.mjs`, `calculate-xp.mjs`, `start-session.mjs`, `ws-mint-token.mjs`, `poker-guest-session.mjs`, and `netlify/functions/_shared/supabase-admin.mjs` independently trust arbitrary `https://*.netlify.app` origins.
- `supabase-admin.mjs` supplies `corsHeaders()` to the wider browser API surface: admin, chips, profiles, favourites, bonus, leaderboard, and poker HTTP functions. Changing it is intentionally a global browser API CORS contract, not an XP-only change.
- The endpoints do not all expose the same methods, request headers, or credential policy. Shared code must decide only origin trust; response parameters remain endpoint-specific.
- `scripts/generate-build-info.js` already generates `BUILD_DEPLOY_CONTEXT`, but not the exact origin of the current deploy.

## Task A — scoped frame policy

### Files

- `_headers`
- `netlify.toml`
- `js/games.json` (read-only source for inventory)
- `play.html` and `js/frame.js` (read-only iframe call sites)
- `tests/static-html.behavior.test.mjs`
- `tests/e2e-security-headers.spec.ts` only if its existing expectations require adjustment
- `docs/csp-implementation.md`

### Changes

1. Keep `_headers` as the single deployed source for CSP and X-Frame-Options.
2. Keep the global default pair:
   - `X-Frame-Options: DENY`;
   - CSP `frame-ancestors 'none'`.
3. Add route-scoped pairs for `/games-open/*`, `/game*.html`, and `/poker/*`:
   - `X-Frame-Options: SAMEORIGIN`;
   - CSP `frame-ancestors 'self'`.
4. Preserve the special Freedoom CSP, changing only its frame pair to the same-origin exception.
5. Remove only the duplicated CSP/XFO blocks from `netlify.toml`; retain cache headers, redirects, build configuration, and environment documentation.
6. Extend the existing static contract test to parse catalog `source.page` values and prove that every currently frame-loaded route matches an exception. It must also reject inconsistent pairs such as `DENY` with `'self'` and prove that non-game portal routes retain `DENY`/`'none'`.

No inline script changes are planned, so no CSP script hash is added.

## Task B — exact-origin API CORS

### Files

- `scripts/generate-build-info.js`
- `netlify/functions/_generated/deploy-context.mjs`
- new `netlify/functions/_shared/api-cors.mjs`
- remove `netlify/functions/_shared/xp-cors.mjs`
- `netlify/functions/_shared/supabase-admin.mjs`
- `netlify/functions/calculate-xp.mjs`
- `netlify/functions/start-session.mjs`
- `netlify/functions/ws-mint-token.mjs`
- `netlify/functions/poker-guest-session.mjs`
- focused existing CORS/build/token test files
- `netlify.toml`, `docs/operations.md`, `docs/ws-auth-token-mint.md`, and `docs/xp-service.md`
- `ws-server/Dockerfile`, WS packaging workflows, and existing image guards because `supabase-admin.mjs` is also packaged into the WS runtime

### Generated deploy identity

`generateServerDeployContext()` will also emit `BUILD_DEPLOY_ORIGIN`, normalized with `new URL(DEPLOY_PRIME_URL).origin`. Missing or invalid input produces `null`, never a partially trusted URL.

Policy by context:

- `production`: trust the exact generated production deploy origin plus explicitly configured origins;
- `deploy-preview` and `branch-deploy`: trust the exact generated current deploy origin plus explicitly configured origins, not the production URL and not other Netlify deploys;
- local/development: trust only explicitly configured origins;
- requests without an `Origin` header remain available for same-origin and server-to-server calls.

`XP_CORS_ALLOW` remains the compatibility name for comma-separated additional API origins in this PR. Documentation will state that it now applies to the shared browser API policy; renaming it is intentionally deferred to avoid a simultaneous environment migration.

### Shared helper contract

`api-cors.mjs` will provide small pure functions for:

- origin normalization;
- allowlist construction from build identity and `XP_CORS_ALLOW`;
- exact allow/reject decisions;
- response header construction with parameters supplied by the caller: `methods`, `allowedHeaders`, `credentials`, and base headers.

Configured values must be origin-only HTTPS URLs. Explicit localhost HTTP origins are allowed for development. Paths other than `/`, query strings, fragments, credentials, malformed URLs, and wildcard domains are rejected. Invalid entries are ignored and counted; callers log only the sanitized count/context through `klog`, never the raw values. If no valid origins remain, every request carrying `Origin` fails closed.

For an accepted origin the helper reflects that exact origin and adds `Vary: Origin`; it never emits `*`. A rejected response contains neither `Access-Control-Allow-Origin` nor credentials.

### Wiring

- `supabase-admin.mjs` delegates origin policy to `api-cors.mjs` while preserving its existing default methods/headers/credentials and allowing individual endpoints to supply narrower parameters.
- XP session and award functions remove their duplicate origin checks and use POST/OPTIONS without credentials.
- WS user token mint and poker guest session remove their local allowlists and use POST/OPTIONS with credentials.
- All other imports of `supabase-admin.corsHeaders()` inherit the exact global origin policy without handler rewrites.

## Verification

Use existing runners and focused existing suites; do not add a new test framework.

- Build generation: valid, absent, and malformed `DEPLOY_PRIME_URL`.
- CORS helper and existing endpoint tests:
  - exact generated deploy origin accepted;
  - another `*.netlify.app` origin rejected;
  - explicit valid origin accepted;
  - malformed configured entry ignored and sanitized count returned;
  - empty valid allowlist fails closed for Origin-bearing requests;
  - no-Origin request remains available;
  - preflight uses endpoint-specific methods/headers;
  - credentials appear only when requested;
  - accepted response has exact ACAO and `Vary: Origin`;
  - rejected response has neither ACAO nor credentials.
- Static headers: consistent global and route-specific CSP/XFO pairs, catalog coverage, and no security-policy duplicates in `netlify.toml`.
- Run the complete repository test command and build before opening the PR.

Deploy Preview manual verification:

1. Load portal, account, admin, leaderboard, profile, XP, poker lobby, and poker table flows.
2. Confirm root/account/admin responses use `DENY` and `frame-ancestors 'none'`.
3. Confirm every catalog game launches inside `play.html`; game/poker document responses use `SAMEORIGIN` and `frame-ancestors 'self'`.
4. Exercise normal and OPTIONS calls with the exact preview origin, an unrelated Netlify origin, an explicit configured origin, and no Origin. Verify both status and complete CORS header sets.

The shared CORS helper is imported by `supabase-admin.mjs`, which is packaged into the WS runtime for ledger dependencies. Docker/workflow copy lists and existing image guards therefore include `api-cors.mjs` and the generated deploy-context module. The WS protocol and poker behavior do not change, but a WS Preview Deploy is required to prove the packaged module graph resolves before merge.

## Acceptance criteria

- Non-game pages cannot be framed, including by the same origin.
- Only current game document route families can be framed by the same origin; cross-origin framing remains blocked.
- `_headers` is the only CSP/XFO source and every route has a consistent XFO/frame-ancestors pair.
- Current catalog games still launch through the game shell.
- Arbitrary Netlify deploy origins are rejected by all migrated browser-facing functions.
- The exact current deploy origin and explicit valid allowlist entries work with each endpoint's existing methods, headers, and credentials policy.
- Requests without Origin keep their existing server-to-server behavior.
- No DB migration, WS change, new secret, inline script, or CSP script hash is introduced.

## Breaking impact and rollback

- Same-origin pages outside the game route exceptions can no longer be embedded. This is intentional clickjacking hardening.
- Browser clients hosted on stale preview URLs, unconfigured custom origins, or arbitrary Netlify sites lose cross-origin API access. This affects every function using `supabase-admin.corsHeaders()`, not only XP.
- `XP_CORS_ALLOW` changes from an XP-oriented compatibility name to the additional-origin input for the shared API contract; existing valid values continue to work.
- No XP, CH, poker, auth, ledger, database, or WebSocket semantics change.
- WS packaging gains two required support files; deploying an artifact that contains the updated `supabase-admin.mjs` without them would fail module loading, so the packaging changes must ship together.
- Task A can be rolled back by restoring the header sources. Task B can be rolled back independently by restoring the previous CORS helpers/build export.
