# XP System and Progression

This document preserves the XP-related technical details that previously lived in `README.md`.

## XP guardrails
- Run `npm run check:all` to validate lifecycle centralization, XP badge placement, and XP bridge wiring.
- Use `npm run check:xpbadge -- --fix` for auto-remediation when there’s exactly one badge anchor.
- See [docs/guards.md](guards.md) for details on the badge and lifecycle checks plus the XP hook validator.

## Authoritative award path and identity

- Gameplay XP is awarded through `/.netlify/functions/calculate-xp`. `award-xp` remains the status/legacy compatibility endpoint and must not be used by new playable integrations.
- The XP badge and `+N XP` overlay animate only after `calculate-xp` returns a positive authoritative `awarded` value. Status reads, auth refreshes, focus changes, cache hydration, zero awards, and rejected windows update state without award animation.
- `calculate-xp`, `award-xp`, and `start-session` must use the shared Supabase auth verifier from `_shared/supabase-admin.mjs`. This keeps HS256/HS512 and Supabase ES256 remote verification aligned with profile, chips, and poker APIs. A request without Authorization may use the browser anon id; a request that supplies an invalid Bearer token fails with `401` and must never fall back to anonymous XP.
- Both award endpoints share XP policy values (`XP_DAILY_CAP`, `XP_SESSION_CAP`, `XP_DELTA_CAP`, `XP_SESSION_TTL_SEC`) and identity resolution: a valid Supabase JWT subject wins over the browser anon id.
- On an authenticated request carrying the browser anon id, both endpoints run the same atomic one-time conversion before reading or awarding totals. The Redis migration marker is the idempotent receipt; zero anon XP does not consume conversion eligibility.
- Canonical server game IDs include `tetris`, `2048`, `pacman`, `t-rex`, and `cats`. Existing aliases such as `open-tetris`, `block-stacker`, `trex`, `open-pacman`, `catch-cats`, and `game_cats` remain supported.
- `XPClient` clears its cached JWT, signed server session, and identity-bound XP cache on `SupabaseAuth.onAuthChange`, then refreshes status for the new identity.
- Non-game pages that render `#xpBadge` perform an initial authenticated status read. The server response is the only value rendered for an authenticated badge. Before that read, the client defensively inspects the legacy `kcswh:xp:last` value; if it is higher than the server total, it shows a one-time, per-user synchronization notice and never uploads the local value. Legacy cache keys are removed only after a successful authenticated response, while a failed response leaves the cache and marker untouched. Game hosts keep their existing `GameXpBridge`/core lifecycle and do not run this migration UX.

## Legacy local XP synchronization

The old `kcswh:xp:last` and `kcswh:xp:regen` entries are not an account ledger. They can contain an optimistic or anonymous value from one browser and are never accepted as authenticated XP. On a non-game page with an authenticated session, `XPClient` sends a `statusOnly` request with the Supabase bearer token, applies the canonical server `totalLifetime`, and then removes those legacy entries. If the defensively parsed legacy value is greater than the server total, the user sees a localized non-blocking notice once per Supabase user and browser under `kcswh:xp:server-migration-notice:v1:<userId>`. A status/network failure does not force `0 XP`, delete the legacy entries, or set the notice marker. The public profile uses the same canonical server total and does not read browser storage.

## GameXpBridge API
`js/xp-game-hook.js` exposes a `window.GameXpBridge` helper so every game page can wire into the XP service without duplicating lifecycle code.

| Method | Description |
| --- | --- |
| `auto(gameId?)` | Detects the current game (or accepts an override), starts a session, and attaches visibility/idle listeners. Use this from the bootstrap snippet that `npm run wire:xp` injects. |
| `start(gameId?)` | Begins or resumes the XP session for the provided identifier. Calling this implicitly schedules the next flush window so the service starts awarding XP immediately. |
| `stop(options?)` | Halts the active session and flushes the pending payload by default. Pass `{ flush: false }` only when you intend to resume instantly and can afford to drop the final window. |
| `add(delta)` | Queues XP toward the next server window. Fractional values are accumulated and clamped to the server’s 10000 point safety rail (mirroring `XP_SCORE_DELTA_CEILING`) before being sent. |
| `nudge()` | Signals foreground activity. Games should call this alongside user input to keep the bridge active during long idle stretches. |

The clamp reflects the server configuration: the bridge reads `window.XP.scoreDeltaCeiling` (exported by `xp.js`) so any server-side change to `XP_SCORE_DELTA_CEILING` is mirrored client-side.

When embedding the bridge manually:

1. Mark the playable shell with `<body data-game-host data-game-id="slug">` (or set `window.XP_IS_GAME_HOST = true` before `xp.js` executes). The guard fails builds that omit the attribute so non-host pages never accrue XP.
2. Load `/js/debug.js`, `/js/xp/combo.js`, `/js/xp/scoring.js`, `/js/xp/core.js`, `/js/xp.js`, and `/js/xp-game-hook.js` (in that order) using root-absolute paths.
3. Include the bounded inline bootstrapper that calls `GameXpBridge.auto()` exactly once. The template retries up to ~500 ms with a gentle backoff and sets `window.__xpAutoBooted` after a successful call so network failures never spin in a tight loop.

The helper survives soft navigations—if you’re swapping views inside an SPA, call `GameXpBridge.start(newGameId)` for each routed surface; you do **not** need to re-inject the scripts.

## XP delta guard
- The XP bridge consolidates raw score updates and clamps deltas locally using `window.XP_DELTA_CAP_CLIENT` (default 300). The clamp can tighten at runtime when the server advertises a stricter ceiling.
- Timestamps are monotonic per page so BFCache restores or retries never replay stale payloads. When a `422 delta_out_of_range` arrives the bridge backs off briefly, fetches status, and adopts the advertised cap before retrying.
- Metadata excludes core identifiers (`userId`, `sessionId`, `delta`, `ts`) automatically and still flows when `localStorage` or `crypto.randomUUID` are blocked (private browsing fallbacks).

## XPClient contract
- `XPClient.postWindow(payload)` returns the parsed success payload on `2xx` responses.
- The helper throws an `Error` on non-`2xx` HTTP responses (for example `422 delta_out_of_range`, `500`) and on transport failures. The error message includes the server-provided `error` field when available.
- Callers must wrap invocations in `try/catch` if they need to handle failures gracefully.

## Daily XP Cap (03:00 Europe/Warsaw)
- Users can earn up to **3000 XP** between consecutive 03:00 Europe/Warsaw instants (handles CET/CEST automatically). Responses include `nextReset` (epoch ms) so clients can render countdowns or pause scheduling until the boundary passes.
- The `xp_day` cookie stores `{ k: <dayKey>, t: <awardedToday> }`, is signed with `XP_DAILY_SECRET`, and expires exactly at the next reset. Deleting the cookie simply causes the server to reissue the authoritative totals on the next award.
- `window.XP.getRemainingDaily()` and `window.XP.getNextResetEpoch()` expose the live allowance for UI surfaces, while the runtime automatically resets the cached totals once the stored `nextReset` elapses.
- `XP.addScore()` and the `GameXpBridge` flush path pre-clamp outgoing deltas based on the server-advertised `remaining` value and emit `award_preclamp` / `award_skip { reason: 'daily_cap' }` diagnostics so operators can confirm when the cap halts awards.

## Legacy compatibility contract: `postWindow`
`postWindow` targets `award-xp` and is retained for status/legacy callers. New gameplay windows use `postWindowServerCalc` and `calculate-xp` instead.
Client → server payload (minimal set, extras allowed):
- `userId` (string)
- `sessionId` (string)
- `delta` (integer ≥ 0) — requested XP increment for the active session
- `ts` (ms since epoch) — last activity timestamp used for ordering and `lastSync` persistence
- `metadata` (object, optional) — any additional context (`gameId`, instrumentation, etc.)

Server behavior:
- Requests with `delta` outside `0…XP_DELTA_CAP` (default 300) are rejected. Legacy clients can continue sending `scoreDelta` / `pointsPerPeriod` and the server will coerce them once per request.
- XP is granted directly from `delta` while enforcing per-session (`XP_SESSION_CAP`, default 300) and per-day (`XP_DAILY_CAP`, default 3000) ceilings. The browser uses an in-memory award session and rotates it automatically when the server reports that the session cap was reached, so play can continue up to the daily limit. The daily cap resets at 03:00 Europe/Warsaw (handles CET/CEST) and partial grants surface `reason: 'daily_cap_partial' | 'session_cap_partial'`.
- Responses remain backwards compatible: `{ ok, awarded, granted, totalToday, remaining, dayKey, nextReset, cap, totalLifetime }` plus `sessionTotal`, `lastSync`, and `capDelta` so clients can rehydrate badge state, countdown to the next reset, and mirror the server cap.
- When `XP_DEBUG=1`, the payload includes `debug` with the requested delta, caps, `lastSync`, and status code.

Response status values:
- `ok` — full grant
- `partial` — partial grant (daily or session)
- `daily_cap`, `daily_cap_partial`, `session_cap`, `session_cap_partial`, `stale`, `locked`, `inactive`
- `statusOnly` — status probes without awarding XP

Client hooks:
- `window.XP.addScore(delta)` queues XP locally; the bridge forwards consolidated deltas via the simplified payload above and lets the server enforce rate limits.
