# XP mechanism complexity audit

> Status update (2026-07-12): `docs/xp-unification-plan.md` supersedes the historical inventory below. Status and gameplay writes now use only `calculate-xp`; `award-xp`, its redirects, the duplicate browser transport, and `server-calc.js` have been removed.

## Executive summary

The XP system is more complex than the product behavior requires. It does not have three functions that calculate XP:

- `calculate-xp.mjs` is the authoritative gameplay calculator and award path.
- `award-xp.mjs` was the older client-delta award and status-read endpoint; it has been removed.
- `start-session.mjs` creates and validates signed anti-abuse sessions; it does not calculate or award XP.

Keeping a separate session endpoint is reasonable. Keeping two independently implemented award paths is the main source of unnecessary complexity. The recent ES256 incident demonstrated the risk: three copied JWT verifiers drifted from the shared Supabase verifier, causing authenticated awards to be stored under browser-anonymous identities.

The recommended target is two public responsibilities:

1. One authoritative XP endpoint, retaining the `calculate-xp` route initially, with explicit `award` and `status` operations.
2. One signed-session endpoint for session creation and validation.

`award-xp` should become a compatibility adapter and then be retired after usage telemetry confirms that no clients still award through it. This should be a staged stabilization effort, not a rewrite.

## Current architecture

The primary implementation surface is approximately 5,200 lines after the first four stabilization PRs:

| Component | Approximate size | Current responsibility |
| --- | ---: | --- |
| `netlify/functions/calculate-xp.mjs` | 1,013 lines | Validate activity windows, calculate XP, apply caps, update Redis totals and serve status reads |
| `netlify/functions/award-xp.mjs` | removed | Compatibility cycle completed; guarded against reintroduction |
| `netlify/functions/start-session.mjs` | 374 lines | Create, sign, store, validate and refresh server sessions |
| `js/xpClient.js` | 893 lines | Auth, status, signed-session acquisition, one award transport, retries and cache synchronization |
| `js/xp/core.js` | 2,828 lines | Gameplay lifecycle, scoring windows, badge state, buffering and server reconciliation |

Related shared modules already provide useful foundations:

- `_shared/supabase-admin.mjs`: authoritative Supabase JWT verification, including ES256 remote verification.
- `_shared/xp-identity.mjs`: identity selection, game aliases, policy and atomic anonymous conversion.
- `_shared/store-upstash.mjs`: Redis transport and canonical account XP reads.
- `_shared/time-utils.mjs`: Warsaw daily-window handling.

## Current data flow

### Gameplay award

1. A game reports semantic activity to `GameXpBridge` and `js/xp/core.js`.
2. The core builds a bounded activity window.
3. `XPClient` acquires a signed server session and a Supabase bearer token when authenticated.
4. `calculate-xp` resolves the identity, validates the session/activity, calculates the grant and atomically updates Redis.
5. The response updates the badge and emits a confirmed award animation.
6. Public profiles read the same canonical Redis total using the internal Supabase user ID.

### Status read

1. `XPClient.fetchStatus()` currently sends `statusOnly` to `award-xp`.
2. `award-xp` resolves the same account identity and returns canonical totals.
3. Badge state is replaced with the server total.

### Anonymous-to-account conversion

An authenticated request carrying the browser anon ID runs the shared atomic conversion. Redis markers make conversion idempotent. This behavior is required but should execute from one authoritative service boundary rather than being independently orchestrated by both award handlers.

## Necessary complexity

The following parts are justified and should remain:

- Server-authoritative XP totals.
- Semantic gameplay activity instead of arbitrary clicks.
- A daily cap of 3,000 XP.
- A short per-session cap with client session rotation.
- Atomic Redis updates for daily, session and lifetime totals.
- Signed server sessions for anti-abuse controls.
- Supabase JWT identity for authenticated accounts.
- Atomic one-time anonymous conversion.
- Canonical game ID normalization.
- Idempotency/stale-window protection.
- A separate public-profile projection that never exposes UUIDs.

The goal is not to remove these controls. It is to make each control have one implementation and one owner.

## Accidental complexity

### High: two award implementations

`calculate-xp` and `award-xp` both implement substantial portions of:

- auth and identity resolution;
- anonymous conversion;
- rate limiting;
- session validation;
- daily/session/lifetime key selection;
- atomic cap enforcement;
- status response fields;
- CORS and error mapping;
- profile snapshot persistence.

Even where helpers are shared, orchestration remains duplicated. A policy change can therefore be correct in one path and wrong in the other.

### High: status is owned by the legacy endpoint

Gameplay writes through `calculate-xp`, while status reads go through `award-xp`. This creates a permanent need to keep both identity and storage contracts synchronized. The public profile exposed the consequences when those contracts diverged.

### High: duplicated authentication previously failed open

The old local JWT implementations treated an unrecognized ES256 token as invalid and silently selected the anon ID. The corrected contract is:

- no Authorization header: anonymous use is allowed;
- valid Authorization header: use the Supabase subject;
- supplied invalid Authorization header: return `401`, never fall back to anonymous identity.

This must remain a system invariant and use only `_shared/supabase-admin.mjs`.

### Resolved: client exposed two transports

`XPClient` now exposes only `postWindowServerCalc` for gameplay awards. The legacy aliases, feature-flag selection, dynamic loader, and duplicate `server-calc.js` implementation have been removed.

### Medium: session concepts are overloaded

The system has browser IDs, in-memory award session IDs, signed server-session IDs, Redis session counters and gameplay lifecycle sessions. These are valid concepts, but similar naming makes mistakes likely. Documentation and eventual internal names should distinguish:

- `anonIdentityId`;
- `awardSessionId`;
- `signedSessionId`;
- `gameplayRunId`.

No public payload rename should happen without a compatibility period.

### Medium: profile snapshots duplicate canonical totals

The canonical value is `kcswh:xp:v2:total:<Supabase user id>`. Secondary user-profile snapshots can be useful metadata, but they must not become another authoritative XP source. Badge, public profile and future leaderboard must read or aggregate from the canonical ledger/total contract.

## Target architecture

### Public endpoints

#### `POST /.netlify/functions/calculate-xp`

Keep the existing route to avoid breaking game clients. Give it an explicit operation contract:

- `operation: "award"`: validate and calculate a gameplay window, then atomically award XP.
- `operation: "status"`: read canonical totals without running gameplay calculation or mutating award/session counters, except a permitted one-time anon conversion.

During compatibility, accept the existing `statusOnly: true` input and normalize it internally to `operation: "status"`.

#### `POST /.netlify/functions/start-session`

Retain this endpoint. Session issuance has different rate limits and security behavior from XP status/award operations. It may share auth/session helpers with the XP endpoint but should not be merged merely to reduce the function count.

#### `POST /.netlify/functions/award-xp`

Convert this endpoint into a thin compatibility adapter:

- status requests delegate to the authoritative status service;
- legacy delta awards either delegate to a clearly isolated legacy adapter or return a controlled deprecation response after telemetry allows it;
- it must not contain independent auth, identity, cap or Redis award logic.

Remove the function only after production telemetry confirms no supported callers remain.

### Internal service boundaries

Prefer a few concrete shared modules over a framework:

- `xp-auth/identity`: shared Supabase verification, anon/account resolution and conversion.
- `xp-policy`: caps, reset windows and canonical game aliases.
- `xp-ledger`: Redis keys and one atomic award operation returning a normalized snapshot.
- `xp-session`: signed-session creation and validation.
- `xp-calculator`: pure gameplay-window-to-delta calculation.
- `xp-response`: one public snapshot/error shape for badge, profile and future leaderboard consumers.

Handlers should parse HTTP, call these services and serialize an allowlisted response. Lua scripts and Redis key construction should have one owner.

## Required invariants

The simplification is acceptable only if all of these remain true:

1. Authenticated awards, status, public profile and future leaderboard resolve to the same Supabase user ID and canonical total.
2. A supplied invalid bearer token never falls back to anon.
3. Anonymous conversion is atomic and exactly once.
4. Award updates are atomic across daily, session and lifetime totals.
5. Status reads do not award XP or consume gameplay windows.
6. Badge animation occurs only for a positive confirmed award.
7. Clearing browser storage does not change authenticated account XP.
8. Guest XP remains isolated from account XP until controlled conversion.
9. The daily reset remains Europe/Warsaw aware.
10. Public responses never expose Supabase UUIDs, Redis keys or internal session identifiers.

## Recommended stabilization phases

### Phase 0: observe before removal

- Add structured `klog` counters for endpoint/operation usage without user identifiers.
- Distinguish `calculate_award`, `award_legacy_delta`, `award_status` and session creation.
- Observe production long enough to cover normal browser-cache and deploy cycles.
- Do not change scoring behavior.

### Phase 1: centralize the domain operation

- Extract one atomic XP ledger operation from both handlers.
- Extract one normalized canonical status snapshot.
- Keep both routes, request shapes and response shapes working.
- Make handlers thin and retain existing caps, keys and conversion receipts.

### Phase 2: move status to the authoritative endpoint

- Add explicit status handling to `calculate-xp`.
- Change `XPClient.fetchStatus()` to call it.
- Keep `award-xp` status as a delegating compatibility path.
- Verify badge, refresh, login/logout, multi-tab, public profile and cookie-clearing behavior.

### Phase 3: retire client-delta awards

- Confirm all playable integrations use semantic activity and server calculation.
- Remove production selection of `postWindow` and make `postWindowServerCalc` the only award transport. Completed in PR 4.
- Make legacy award attempts observable before rejecting them.
- Remove legacy delta calculation only after the observation window is clean.

### Phase 4: reduce client state

- Separate transport/auth/session code from badge presentation and gameplay accumulation.
- Keep one server reconciliation function.
- Remove obsolete cache fields only after one release of compatibility reads.
- Preserve plain-script/IIFE and JSP compatibility.

## Verification strategy

Each phase should include existing automated checks plus deterministic manual smoke tests. The critical smoke is identity consistency, not only a successful HTTP status:

1. Sign in with a real Supabase ES256 account.
2. Create a signed XP session and confirm its internal user ID equals the authenticated account ID.
3. Earn a small confirmed XP award.
4. Read authenticated XP status.
5. Read the public profile by handle.
6. Confirm badge XP, public XP and level are equal.
7. Clear site storage, sign in again and confirm the same server total remains.
8. Send an invalid bearer token with an anon ID and confirm `401` with no anon mutation.
9. Reach the 300 XP session ceiling and confirm a new award session continues toward the 3,000 daily ceiling.
10. Confirm guest play still works without Authorization.

## Breaking impact

Potential breaking impacts of simplification:

- Removing `award-xp` too early can break cached clients and non-game status reads.
- Changing response fields can break badge reconciliation and XP overlays.
- Moving status may accidentally apply award rate limits or mutate session state.
- Renaming session identifiers can invalidate signed tokens or Redis counters.
- Replacing Lua operations can introduce duplicate awards or cap races.
- Tightening invalid-token behavior intentionally changes malformed authenticated requests from anonymous success to `401`.
- Removing legacy local cache reads too early can produce confusing one-release UI regressions.

For these reasons, the recommended work is consolidation behind stable contracts, followed by measured retirement. A ground-up rewrite would carry more ledger risk than the current complexity warrants.

## Verdict

The mechanism is too complex, but the security and accounting requirements are not. The correct simplification is not “one Netlify Function for everything.” It is one authoritative XP award/status service, one session service and thin compatibility adapters during migration.

The highest-value next change is Phase 1: centralize atomic ledger/status orchestration while preserving all current HTTP contracts. Leaderboard work should wait until that consolidation is stable, because a leaderboard amplifies any remaining identity or total-source mismatch.
