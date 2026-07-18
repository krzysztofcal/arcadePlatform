# XP required server sessions — implementation plan

Status: accepted implementation plan for issue #382, PR A only.

## Goal

Require a valid server-issued session for XP award operations without changing game rules, activity gates, score/event handling, caps, combo, boosts, or existing XP. `operation: "status"` remains outside the session gate.

## Scope

### 1. Shared session contract

Add `netlify/functions/_shared/xp-server-session.mjs` with one secret resolver, stable request fingerprint, and shared signing/verification helpers.

- Prefer `XP_SESSION_SECRET`.
- Temporarily fall back to `XP_DAILY_SECRET` when the new secret is absent.
- Treat a missing or shorter-than-32-character secret as invalid configuration.
- Build the fingerprint from normalized `user-agent` and `accept-language` only; exclude unstable `accept-encoding` and IP.

### 2. Fail-closed session issuance

Update `netlify/functions/start-session.mjs` to use the shared contract. Return controlled `server_config` for an invalid secret and `503 session_unavailable` when Redis cannot persist the session. Replace `console.error` with allowlisted `klog` telemetry and never log tokens, identities, fingerprints, IP addresses, or secrets.

### 3. Fail-closed award validation

Update `netlify/functions/calculate-xp.mjs` so an award session validation produces one of `valid`, `invalid`, `unavailable`, or `misconfigured`.

- Invalid sessions return `401 invalid_session`, public reason `missing|expired|invalid|mismatch`, and `requiresNewSession: true`.
- Redis validation failures return `503 session_unavailable`, `requiresNewSession: false`, and `Retry-After`.
- Invalid configuration returns `500 server_config`.
- No failure path may read or mutate award session state, the XP ledger, leaderboard, combo, profile projection, or `lastWindowEnd`.
- Status reads return before this gate.

### 4. One controlled client renewal

Update `js/xpClient.js` so `postWindowServerCalc()` handles one `401 invalid_session` by clearing the stored server session, obtaining a new session, rebuilding the body with the new token, and retrying the identical award window once. A second invalid-session response stops. A `503` does not clear or rotate the token.

### 5. Configuration and operations

Update `netlify.toml`, `docs/operations.md`, `docs/xp-service.md`, and `docs/xp-system.md` to document `XP_SESSION_SECRET`, the temporary fallback, environment scoping, staged rotation, enforcement, observation, and rollback.

## Verification

Run the existing XP/session suites and adjust existing expectations only where the response contract changes. Do not add a new test framework or a broad new matrix.

Manual Deploy Preview verification must confirm:

1. a valid session awards XP;
2. an invalid session renews and retries once;
3. missing/short secret blocks awards;
4. session-store `503` does not clear the token;
5. status reads still work;
6. authenticated and anonymous flows remain functional;
7. retry cannot double-award the same window.

## Rollout and secret rotation

1. Deploy the renewal-capable client and shared server contract while retaining the current fallback.
2. Verify renewal on Deploy Preview.
3. Deploy the renewal-capable client to production before setting a new secret.
4. Set a production-scoped `XP_SESSION_SECRET` and avoid another secret rotation during rollout or rollback.
5. Observe `invalid_session`, `start-session`, and rate-limit telemetry.
6. Enable `XP_REQUIRE_SERVER_SESSION=1`, disable warn mode, and perform a fresh deploy.

Rollback changes only the enforcement flags (`XP_REQUIRE_SERVER_SESSION=0`, `XP_SERVER_SESSION_WARN_MODE=1`) followed by a fresh deploy. It does not rotate or remove the secret.

## Breaking impact

- Award clients without a valid server session stop receiving XP after enforcement is enabled.
- Tokens signed by the previous fallback secret or old fingerprint contract renew once.
- Session-store outages temporarily block awards instead of failing open.
- Existing XP, game rules, events, activity gating, ledger, replay, caps, boosts, leaderboard, DB, WS, CSP, JSP, and CSS remain unchanged.

## Follow-ups excluded from PR A

- PR B: basic malformed award payload and supported-game allowlist validation.
- PR C / separate issue: evidence policies per game after observing legitimate production payloads.
