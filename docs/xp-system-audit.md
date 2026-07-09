# XP System Audit

**Scope:** readiness and stability audit before XP leaderboards. This is a code and documentation review only: no production data was queried, no code was changed, and no tests were added or run.

## Executive summary

The XP system has a usable client-to-server path for both guest and authenticated play, with valuable protections already in place: host-page gating, an explicit game bridge, server-side atomic cap updates, stale-window rejection, rate limits, and a one-time anonymous-to-account transfer in `award-xp`.

It is **not leaderboard-ready**. XP is stored as Redis counters, not an append-only, queryable gain history. There is no global index, weekly aggregate, user presentation snapshot, or privacy model for rankings. The more immediate stabilization concern is that production hosts select `calculate-xp`, while anon conversion is implemented only in `award-xp`; the two award paths also differ in locking and behavior. This must be consolidated or made intentionally equivalent before XP becomes competitive.

Recommended order: make the authoritative award path explicit and secure, make identity transitions deterministic, introduce durable event/history storage and aggregates, then build ranking reads. Do not build the leaderboard against Redis key scans or the browser cache.

## Current XP architecture

### Client and UI

- `js/xp/combo.js` owns deterministic client combo state.
- `js/xp/scoring.js` batches local score deltas and exposes generic flush helpers. Its configured endpoint is normally absent, so the core path sends windows through `XPClient`.
- `js/xp/core.js` is the primary runtime. It gates activity to documents marked as game hosts, tracks trusted input/visibility/score pulses, creates windows, maintains local badge/cache state, and reconciles totals from the server.
- `js/xp.js` boots `XpCore`; `js/xp-game-hook.js` exposes `window.GameXpBridge` and manages the per-playable bootstrap, game-id detection, nudge forwarding, score queueing, and duplicate auto-boot protection.
- `js/xpClient.js` creates a browser anon identity and session id in `localStorage`, obtains a Supabase access token when available, creates a signed server session, calls the XP endpoints, and fetches status for badge/page refresh.
- `js/ui/xp-overlay.js` is presentation-only for combo/boost state. It attaches only to a visible active game window.
- `xp.html` calls `XP.refreshStatus()` through `js/xp-page.js`, then renders the `XP.getSnapshot()` response. The badge is populated by `core.js` from local cache and later server status.

### Playable surfaces

- Root shells `game.html` and `play.html`, direct game pages such as `game_cats.html` and `game_trex.html`, `games/t-rex/index.html`, and `games-open/*/index.html` load the prescribed bridge stack and one inline `GameXpBridge.auto()` bootstrap.
- `play.html` resolves a catalog game, sets `window.__GAME_ID__`, starts the bridge, and forwards same-origin iframe activity through `postMessage`.
- Direct playable pages supply their own `data-game-id`/`data-game-slug`; catalog identifiers differ from slugs in several cases, for example `open-tetris` versus `tetris`.

### Server and storage

- `netlify/functions/start-session.mjs` issues a signed, fingerprint-bound server session stored in Upstash Redis.
- `netlify/functions/award-xp.mjs` is the legacy/direct award endpoint. It validates request shape, handles anonymous-to-account migration, enforces daily/session/delta caps with a Redis Lua transaction and lock, writes counter keys, and updates a Redis user-profile snapshot for authenticated users.
- `netlify/functions/calculate-xp.mjs` is the server-calculated endpoint. It receives activity inputs, calculates a delta by game rules and server-side combo state, then atomically updates the same Redis daily/session/lifetime counters.
- `js/xpClient.js` enables server calculation automatically for localhost, `play.kcswh.pl`, `landing.kcswh.pl`, and Netlify hosts. Thus production gameplay normally selects `calculate-xp`; status reads still use `award-xp`.
- Supabase is used for client authentication and JWT identity. XP itself is not stored in Supabase tables: authoritative counters and the small authenticated profile snapshot live in Upstash Redis.

## Data flow

### Guest and authenticated award flow

1. A playable document's inline bridge bootstrap calls `GameXpBridge.auto()`.
2. `GameXpBridge` resolves and slugifies a game id, starts `XP.startSession()`, binds activity forwarding once, and asks `XPClient` to create/reuse a server session.
3. `core.js` accepts only visible, game-surface trusted input, visibility time, and score pulses. It forms a bounded window with `gameId`, `windowStart`, `windowEnd`, `inputEvents`, `visibilitySeconds`, and optional `scoreDelta`.
4. `XPClient` loads the browser's `kcswh:userId` and `kcswh:sessionId`. When a valid Supabase JWT exists, the server uses JWT `sub`; otherwise it uses the browser anon id.
5. On normal production hosts, `XPClient.postWindowServerCalc()` sends the raw window to `calculate-xp`. Other hosts or an explicit disabled mode use `award-xp` with a client-supplied bounded delta.
6. The selected backend rate-limits, validates timestamps/session configuration, applies caps and stale-window protection, increments Redis keys, and returns total/day/session values.
7. `core.js` applies the response to its cache and badge. `xp.html` explicitly fetches status from `award-xp` and renders the returned lifetime/day totals.

### Anonymous to account conversion

1. The browser always sends its anon id as `userId` even when it also sends a Supabase bearer token.
2. `award-xp` selects the JWT subject as the authenticated identity and atomically moves up to `XP_ANON_CONVERSION_MAX_XP` from the anon lifetime counter to that user's lifetime counter. Redis migration markers prevent another conversion for either the `(anon, user)` pair or the user.
3. `calculate-xp` selects the authenticated identity but does **not** call this migration. A later status request to `award-xp` can perform it; a calculation-only flow cannot.
4. The implementation differs from `docs/xp-anon-to-account-conversion.md`: it does not require verified email, does not track active days, does not apply the documented `dailyCap * activeDays` cap, does not write a conversion message, and may place a zero-value migration marker.

### Refresh, logout/login, tabs, and devices

- Refresh: totals and runtime state are cached in `localStorage`; a new page rehydrates cache and refreshes when `xp.html` or a running game requests status. An unsent window is best-effort only.
- Logout/login: the XP client caches an access token for 60 seconds and does not subscribe to Supabase auth changes. During that cache period, an award may retain the identity selected before the auth transition.
- Same-browser tabs share anon id, browser session id, server-session token, and local cache. `storage` events rehydrate display cache. Per-session stale timestamps prevent replay of an exact/older window, but two tabs can still generate distinct newer windows.
- Multiple devices get distinct browser session ids. They share authenticated lifetime and daily counters, but each device has an independent session cap and server session.

## Guardrails currently present

- `npm run check:all` runs lifecycle, badge, and playable bridge guards.
- `scripts/check:lifecycle.js` limits `pageshow`, `pagehide`, `beforeunload`, and `visibilitychange` listeners to configured files. `js/xp/core.js` and `js/ui/xp-overlay.js` are currently allowed.
- `scripts/check-xpbadge.js` requires exactly one `a#xpBadge.xp-badge` per tracked HTML page.
- `scripts/check-games-xp-hook.mjs` requires each recognized playable shell to have `data-game-host`, exactly one each of combo/scoring/core/xp/hook scripts, and one `GameXpBridge.auto()` bootstrap.
- Client side: host-page gating, duplicate auto-bootstrap guards, normalized positive score deltas, local cap pre-clamping, visible/idle gates, and same-origin iframe message checks.
- Server side: CORS allowlist, JWT-derived authenticated identity, per-identity and IP rate limits, timestamp drift checks, delta/session/daily caps, Redis Lua atomic increments, stale-window rejection, metadata size/depth checks, and optional signed server-session enforcement.
- Server-calculated path: raw activity window calculation, capped score/events, server-side combo state, and optional minimum input/visibility gates.

## Risk register

### Critical

1. **No durable XP gain history or ranking read model.** Redis has lifetime counters and per-user/per-day keys, but no immutable event stream, no date/game/user index, no weekly aggregate, and no materialized leaderboard. This makes correct `today`, `this week`, and audit/rebuild queries impractical and unsafe to implement by scanning keys.
   - Recommendation: create an append-only, authenticated XP award ledger in Supabase/Postgres, plus idempotency keys and indexed daily/weekly aggregates. Redis can remain a fast cap/session cache.

2. **The production route and identity-conversion route diverge.** Production hostname detection sends awards to `calculate-xp`; anon conversion exists only in `award-xp`. The product cannot state a deterministic conversion point or guarantee that the documented conversion semantics are applied on the path that produced the XP.
   - Recommendation: choose one authoritative award service or extract shared identity/conversion/cap logic used by both endpoints before leaderboard work.

### High

1. **Anonymous conversion does not match the published contract.** The backend transfers only the anon lifetime total capped by `XP_ANON_CONVERSION_MAX_XP`; it does not check verified email or active days, does not impose the documented daily-times-active-days cap, does not archive all anon state, and does not return/show the documented one-time notice. It also writes the one-time user marker for a zero balance, potentially permanently consuming conversion eligibility before the guest has convertible XP.
   - Recommendation: define one shipped conversion contract, implement its predicates and atomic transaction together, and add an explicit conversion receipt/idempotency record.

2. **Auth transition is not immediate in XPClient.** `js/xpClient.js` caches the JWT for 60 seconds and does not react to `SupabaseAuth.onAuthChange`. Login/logout in a live page can attribute windows to the prior guest/account identity until the cache refreshes.
   - Recommendation: invalidate XP auth/session state on every Supabase auth change; define whether pending guest windows flush, migrate, or are discarded before switching identity.

3. **Server-calculated XP is not fully server-observed.** The server calculates points, but the evidence (`inputEvents`, `visibilitySeconds`, score delta, game events, and game id) is still supplied by the browser. If `XP_REQUIRE_SERVER_SESSION` is not enabled in production, an attacker can create arbitrary anonymous identities and submit fabricated active windows subject to caps and rate limits. Even with sessions enabled, a browser session can submit fabricated measurements.
   - Recommendation: confirm enforcement configuration, use server-issued session/window nonces, make game ids allowlisted, and treat XP as non-competitive until stronger attestation or server-authoritative game telemetry exists.

4. **Session cap is per browser session rather than per authenticated player.** Separate devices use separate session keys and can each consume `XP_SESSION_CAP`; only the daily cap is globally shared. This is not a duplicate-write bug, but it weakens the intended session limit and can distort future rate-based rankings.
   - Recommendation: specify whether the cap is per device, game run, account, or rolling time window and encode that identity in the storage key.

### Medium

1. **Two backend paths have different concurrency behavior.** `award-xp` wraps its Lua increment with a short lock/retry; `calculate-xp` relies on its Lua operation and stale value but has no equivalent lock or shared session-state transaction. A concurrent calculate request can race on separately read/saved combo state even though total counters remain atomic.
   - Recommendation: use a shared transactional award primitive and make combo/session-state update part of a defined idempotency model.

2. **Cross-tab and multi-device activity is additive.** Same-tab duplicate boot is guarded, and older windows are rejected per session. Different tabs/devices can nevertheless submit distinct current windows and accumulate toward the shared daily cap. This is acceptable only if simultaneous play is permitted.
   - Recommendation: decide policy, then add a per-user active-session lease or explicitly accept concurrent sessions and expose it in anti-abuse monitoring.

3. **Game-id namespace is not canonicalized end-to-end.** The bridge slugifies ids; catalog uses ids and slugs that differ (`open-tetris`/`tetris`, etc.); direct pages choose their own attributes; server rules include aliases. Current defaults prevent a crash, but analytics and per-game ranking data would fragment without a canonical registry.
   - Recommendation: publish one catalog-derived canonical game id and validate/map aliases only at the server boundary.

4. **Refresh/unload can lose a pending window.** Runtime state is written to local storage, but normal game windows use asynchronous requests; unload attempts `keepalive`/beacon only best-effort. A refresh between local accumulation and a successful response can lose awarded display state or resend a value depending on timing. Server stale keys prevent exact replay, but there is no durable client outbox or request id.
   - Recommendation: add a bounded outbox with idempotency keys, or deliberately accept best-effort XP and document it.

5. **Badge and page may show cache before authoritative status.** Guest rendering intentionally uses monotonic local display while authenticated rendering uses server totals. This avoids visual regressions but can show stale account/guest values briefly across auth changes or after server rejection.
   - Recommendation: invalidate cache on identity changes and label status/badge readiness by identity, not only by local persistence.

6. **Operational docs are stale/incomplete.** `docs/xp-service.md` describes a minimal API-key/30-second endpoint that no longer describes the current session/JWT/calculate architecture. The anon conversion document is presented as an implementation spec but materially differs from code.
   - Recommendation: update documentation only after selecting the authoritative service and conversion contract.

### Low

1. **Inactive and unsupported game ids receive default calculation rules.** This supports broad game coverage, but it means a catalog typo does not fail closed and can silently use default economics.
2. **The Redis profile snapshot contains only `userId`, total XP, and timestamps.** It is insufficient for ranking display, naming, account deletion workflow, or privacy controls.
3. **`XpServerCalc` exposes an alternative standalone recorder API.** It is not auto-initialized by the normal bridge, but a future game calling `XpServerCalc.init()` alongside core would add a second sender/listener path. The guards do not prohibit that API.

## Leaderboard readiness assessment

| Requirement | Current state | Assessment |
| --- | --- | --- |
| All-time XP total | Redis `total:<identity>` counter | Available for an individual identity; not globally queryable/rankable. |
| Today XP gain | Redis `daily:<identity>:<Warsaw day>` counter | Available for a known identity; no global index or durable history. |
| This-week XP gain | Not materialized | Missing. Cannot be derived efficiently or reliably for all players. |
| Idempotent award history | Per-session `lastSync` only | Missing durable event/request record. |
| Ranking display identity | Supabase auth exists; XP profile has no name/privacy fields | Missing. |
| Privacy / opt-out / visibility | No leaderboard policy or data model | Missing. |
| Anti-cheat confidence | Capped client-observed activity, optional session enforcement | Insufficient for competitive ranking. |
| Rebuild/backfill | Counter-only storage | Missing. |

**Conclusion:** do not expose rankings until the XP ledger, idempotency, aggregate strategy, canonical game ids, and user-display/privacy contract exist. A direct leaderboard over Redis counters would create correctness, privacy, and operational risks.

## Recommended stabilization phases

### Phase 0: Establish the contract and production configuration

1. Confirm deployed values for `XP_REQUIRE_SERVER_SESSION`, `XP_SERVER_SESSION_WARN_MODE`, `XP_REQUIRE_ACTIVITY`, CORS allowlist, Redis availability, JWT verification configuration, and cap values.
2. Declare `calculate-xp` or `award-xp` as the sole authoritative gameplay path. Keep the other only as an adapter until removed or made equivalent.
3. Define canonical identity transition semantics: sign-in, sign-out, refresh, verified email requirement, conversion timing, zero-balance behavior, and what happens to pending XP.

### Phase 1: Identity and award-path stability

1. Invalidate/rebuild XP auth and server-session state on Supabase auth changes.
2. Move anon conversion into shared server logic and execute it exactly once within the same authoritative transaction/receipt model.
3. Define server-session and session-cap scope across tabs and devices.
4. Add server-side canonical game-id validation and alias mapping from `js/games.json` or an equivalent server-owned registry.
5. Remove or fence the standalone `XpServerCalc.init()` path so no game can accidentally emit a second stream.

### Phase 2: Ledger and aggregates

1. Add a Supabase/Postgres append-only `xp_awards` ledger owned by a server/RPC path. Include authenticated account id when present, an ephemeral anon identity only where policy permits, award timestamp, Warsaw day key, canonical game id, source/version, granted XP, and idempotency key.
2. Award counter/cache and ledger entry must commit atomically, or the ledger must be the source of truth and counters derived from it.
3. Add indexed account/day and account/week aggregates, with a clear week boundary and time zone. Keep all-time account totals derived or atomically maintained.
4. Persist a conversion receipt that ties the anon source to destination account without exposing raw anon identifiers in public reads.

### Phase 3: Read model, privacy, and operations

1. Add a profile/public-ranking model separate from Supabase auth: display name, avatar choice if applicable, visibility/opt-out, moderation/ban state, and stable public id.
2. Implement internal reconciliation: ledger sum versus aggregates/counters, daily cap anomalies, duplicate idempotency keys, and migration discrepancies.
3. Define retention/deletion behavior for XP events and anonymous data; ensure ranking reads exclude private/deleted users.
4. Document operational rollback and backfill procedures before public ranking UI.

### Phase 4: Leaderboard implementation (out of scope)

Only after phases 0-3: read from indexed aggregates, paginate deterministically, define tie-breaking, cache reads, and show an explicit time window. Do not add this UI earlier.

## Files/methods/properties likely affected

### Client

- `js/xpClient.js`: `fetchAuthToken`, `clearServerSession`, `ensureServerSession`, `postWindow`, `postWindowServerCalc`, `fetchStatus`; add auth-transition invalidation and a single endpoint contract.
- `js/xp/core.js`: `sendWindow`, `handleResponse`, `applyServerDelta`, cache keys `kcswh:xp:cache`/`kcswh:xp:regen`, lifecycle and identity-bound badge state.
- `js/xp-game-hook.js`: `auto`, `start`, `stop`, `getCurrentGameId`; retain one bootstrap path and feed canonical game ids.
- `js/xp/server-calc.js`: either retire as a second sender or make it a pure helper behind the bridge.
- `js/xp-page.js`, `js/ui/xp-overlay.js`, `js/auth/supabaseClient.js`: identity-aware refresh and presentation state.
- `game.html`, `play.html`, `game_*.html`, `games/**/index.html`, `games-open/**/index.html`: only if canonical id/bootstrap integration changes. Any altered inline script must update the CSP SHA allowlist in `_headers`.

### Server and data

- `netlify/functions/award-xp.mjs` and `netlify/functions/calculate-xp.mjs`: converge identity, validation, idempotency, conversion, cap, and response behavior.
- `netlify/functions/start-session.mjs`: session scope and signed-window/nonce policy.
- `netlify/functions/_shared/store-upstash.mjs`: counters/cache only after a ledger becomes authoritative; profile snapshot should not be the public ranking profile.
- New Supabase migrations/RPCs for ledger, conversion receipts, aggregates, privacy/display profile, indexes, RLS, and retention policy.
- `docs/xp-system.md`, `docs/xp-service.md`, `docs/xp-anon-to-account-conversion.md`, `docs/xp-calculation-rules.md`, `docs/guards.md`: revise after behavior is consolidated.

### Existing guard scope

- `scripts/check-lifecycle.js`, `scripts/check-xpbadge.js`, `scripts/check-games-xp-hook.mjs`, `guard.config.json`, and `scripts/wire-xp.mjs` remain appropriate integration guards, but they do not verify identity consistency, backend parity, ledger idempotency, or ranking data readiness.

## Manual verification checklist

Run these only after stabilization changes; they are not part of this audit.

1. Guest: play one supported game, refresh during and after a successful window, then verify one consistent lifetime/day total on badge and `xp.html`.
2. Guest cap: reach daily cap, refresh, open a second tab, and confirm no additional grant before the Warsaw reset.
3. Login transition: start as guest, earn XP, sign in without reload, then verify exactly one conversion and that subsequent awards use the account identity.
4. Logout transition: log out during a game, verify no post-logout window is attributed to the former account, then verify guest state is explicit.
5. Conversion edge cases: zero anon XP, capped anon XP, repeated account logins, a second account on the same browser, and two devices. Verify the selected policy, receipt, and totals.
6. Tabs/devices: submit activity concurrently in two tabs and two devices; validate session-cap policy, daily cap, stale handling, and absence of duplicate ledger ids.
7. Game ids: test catalog launch and direct launch for `trex`, `cats`, `open-2048`, `open-tetris`, `open-pacman`, and an unsupported/default-rule game. Confirm a single canonical id reaches the backend.
8. Security configuration: verify unauthenticated direct requests, forged activity fields, invalid JWT, missing/invalid server session, CORS mismatch, and rate-limit handling against deployed configuration.
9. Recovery: simulate Redis/network failure during a window and refresh. Confirm the documented loss/retry/idempotency behavior rather than trusting UI cache.
10. Future ranking data: compare daily and weekly aggregate results to ledger sums, validate time-zone boundaries, opt-out behavior, deletion, and deterministic ties before any public UI.

## Breaking impact

- **Identity transition changes can alter visible totals:** invalidating auth immediately and correcting conversion may move or temporarily hide cached guest/account XP that is currently attributed under a stale token.
- **Making server sessions mandatory can block XP until every playable page successfully creates a session:** rollout needs telemetry and a warn-to-enforce plan.
- **Canonical game-id enforcement can reject existing pages or integrations that currently fall back to default rules:** migrate aliases before enabling fail-closed validation.
- **Replacing counter-only storage with a ledger can expose historical counter mismatches:** reconciliation and a defined source of truth are required before backfill.
- **Correcting anon conversion may intentionally prevent previously possible repeat/zero-marker behavior:** support and product messaging need to cover account users affected by the policy change.
- **Leaderboard privacy requires new user-facing settings and deletion semantics:** rankings must not launch until those decisions and data paths are in place.
