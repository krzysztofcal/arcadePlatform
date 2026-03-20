# Operations and Configuration

This document preserves the operational and rollout details that were previously embedded in `README.md`.

## Server gates & debug
- `award-xp.mjs` validates the JSON body, tolerates legacy `scoreDelta` / `pointsPerPeriod` fields, and enforces `XP_DELTA_CAP` plus the per-session (`XP_SESSION_CAP`) ceiling and the Warsaw-local daily (`XP_DAILY_CAP`, default 3000) window that runs from 03:00 to 03:00 (CET/CEST aware).
  - Every response surfaces Redis-sourced `totalToday`, `remaining`, `dayKey`, and `nextReset` (epoch ms of the next Warsaw reset). The signed `xp_day` cookie is rewritten on each call so stale or missing cookies self-heal automatically.
  - The cookie pre-clamps each award before Redis executes, so once the server reports `remaining: 0` the next calls immediately short-circuit until the advertised `nextReset`. Redis still tracks session/lifetime totals for analytics, and any session caps stack on top of the daily allowance.
  - The cookie is HttpOnly + SameSite=Lax, signed with `XP_DAILY_SECRET`, and its payload mirrors the response totals (`granted` equals the legacy `awarded` field but should be preferred going forward and `awarded` will be phased out in a future update). When `XP_COOKIE_SECURE=1`, the cookie is also marked Secure for HTTPS deployments.
  - `awarded` and `granted` are equal today; clients should migrate to `granted`.
  - Local Playwright runs inject `XP_DAILY_SECRET=test-secret` (and `XP_DEBUG=1`) so the preview server matches the production contract; set `XP_DAILY_SECRET` (32+ chars) when running the function manually to avoid `500 server_config/xp_daily_secret_missing`.
- Requests are rejected when the timestamp is stale (`status: "stale"`), another tab owns the lock (`status: "locked"`), metadata is malformed or oversized, or the optional activity guard blocks idle deltas.
- Flip `XP_REQUIRE_ACTIVITY=1` to require input and visibility thresholds (`XP_MIN_ACTIVITY_EVENTS`, `XP_MIN_ACTIVITY_VIS_S`). When disabled the function skips those checks entirely.
- Metadata must remain shallow: depth ≤ 3 and serialized size ≤ `XP_METADATA_MAX_BYTES` (default 2048 bytes). Larger payloads return `413 metadata_too_large` without mutating totals.
- Session keys refresh their TTL (`XP_SESSION_TTL_SEC`, default 7 days) whenever deltas are accepted or a zero-delta heartbeat advances `lastSync`, keeping Redis tidy.
- Enabling `XP_DEBUG=1` adds `{ delta, ts, lastSync, status, dailyCap, sessionCap }` to responses for diagnostics.

## Diagnostics logging
- Unlock the client recorder for 24 hours by visiting any page with `?admin=1` or tapping the About page title five times within three seconds. The flag is stored in `localStorage["kcswh:admin"]` and expires automatically.
- Once unlocked, the recorder auto-starts (`window.KLog.start(1)`) and the About page surfaces a **Dump diagnostics** button. Clicking it opens a new tab populated with the recent buffer (up to 1000 lines) and falls back to downloading `kcswh-diagnostic-<timestamp>.txt` when the popup is blocked.
- The buffer captures the XP lifecycle breadcrumbs (`xp_init`, `xp_start`, `xp_stop`, `block_no_host`, `block_hard_idle`, `award`) so you can confirm that accrual only happens on game hosts and is suppressed on idle or non-host pages. Check `window.KLog.status()` for the active level and line count.

## P1.1 rollout & rollback
Operators rolling out the P1.1 XP bridge should stage the following environment toggles alongside their Netlify/Functions deployment:

| Variable | Suggested value | Purpose |
| --- | --- | --- |
| `XP_USE_SCORE` | `0` or `1` | Enables score-mode XP awarding for the new bridge. Leave at `0` during smoke tests, then flip to `1` when the rollout passes QA. |
| `XP_SCORE_TO_XP` | `1` | Conversion rate from accepted score deltas to XP. Increase gradually if the event feed under-counts awards. |
| `XP_MAX_XP_PER_WINDOW` | `10` | Caps XP per window in score mode to guard against spikes. Lower this temporarily if telemetry detects runaway grants. |
| `XP_SCORE_RATE_LIMIT_PER_MIN` | `10000` | Rolling per-minute ceiling for score deltas. Tighten to throttle abuse or loosen if a featured game legitimately needs more throughput. |
| `XP_SCORE_BURST_MAX` | `10000` | Single-window burst limit that stacks with the minute gate. Lowering this curbs short-lived spikes. |
| `XP_SCORE_MIN_EVENTS` | `4` | Minimum input count for a score-bearing window. Raise during investigations of scripted input farms. |
| `XP_SCORE_MIN_VIS_S` | `8` | Minimum focused play time (seconds) for score windows. Increase when you need longer engagement before XP accrues. |
| `XP_DEBUG` / `XP_SCORE_DEBUG_TRACE` | `0` or `1` | Surface debug payloads during staged rollouts. Enable during P1.1 validation, disable once the bridge stabilizes to reduce response size. |

> **Tip:** Environment variables are strings—use plain integers such as `10000` when setting ceilings so the server parser can coerce them cleanly.

**Rollback plan:**
1. Immediately set `XP_USE_SCORE=0` and redeploy the function—this forces the bridge back to time-based awards while keeping the new client live.
2. If issues persist, redeploy the previous stable function build (tagged prior to P1.1) and run `npm run wire:xp` against that commit to ensure the HTML snippet matches.
3. Disable the badge entry point for the affected game(s) or temporarily remove the inline `GameXpBridge.auto()` snippet to halt client-side sends while you investigate. If you must ship that change, commit with `[guard-skip]` in the message (the bridge guard will fail otherwise) and revert as soon as the incident ends.
4. Re-run `npm run check:games-xp-hook` before re-enabling to confirm the guard is satisfied and the rollback did not leave partial bridge markup behind.

Document every toggle change in your incident timeline—the bridge guard expects the environment to match the table above when P1.1 resumes.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `XP_DEBUG` | `0` | Include the `debug` object in responses for easier staging diagnostics. |
| `XP_DAILY_CAP` | `3000` | Maximum XP a user can gain per Warsaw local day (03:00–03:00 CET/CEST). |
| `XP_SESSION_CAP` | `300` | Maximum XP a single session can accumulate before further deltas are rejected. |
| `XP_DELTA_CAP` | `300` | Largest delta accepted from the client in a single request. |
| `XP_LOCK_TTL_MS` | `3000` | Duration of the per-session Redis lock that guards concurrent writes. |
| `XP_SESSION_TTL_SEC` | `604800` | TTL (seconds) for session counters; refreshed on each award/heartbeat to curb key bloat. |
| `XP_DRIFT_MS` | `30000` | Maximum allowed future drift for client `ts`. Requests beyond this tolerance are rejected. |
| `XP_REQUIRE_ACTIVITY` | `0` | When `1`, enforce minimum input/visibility thresholds before awarding XP. |
| `XP_MIN_ACTIVITY_EVENTS` | `4` | Minimum `metadata.inputEvents` required when `XP_REQUIRE_ACTIVITY=1`. |
| `XP_MIN_ACTIVITY_VIS_S` | `8` | Minimum `metadata.visibilitySeconds` required when `XP_REQUIRE_ACTIVITY=1`. |
| `XP_METADATA_MAX_BYTES` | `2048` | Maximum serialized metadata size; larger payloads return `413 metadata_too_large`. |
| `XP_DAILY_SECRET` | _(required)_ | 32+ character HMAC secret used to sign the `xp_day` cookie. |

Set these variables in tandem so the client and server agree on throughput; the server enforces the cap and surfaces `capDelta` so clients can mirror it without redeploying.

## Server Session Enforcement (Production)
Server-side session validation prevents session hijacking and token forgery attacks. Roll out in two phases:

| Variable | Phase | Purpose |
| --- | --- | --- |
| `XP_SERVER_SESSION_WARN_MODE` | Monitoring | Set to `1` to log session validation failures without blocking requests. Use this to identify legitimate clients that may not be sending tokens correctly. |
| `XP_REQUIRE_SERVER_SESSION` | Enforcement | Set to `1` to reject requests without valid session tokens (returns 401). Only enable after warn mode shows minimal false positives. |

**Rollout procedure:**
1. **Phase 1 - Monitoring:** Set `XP_SERVER_SESSION_WARN_MODE=1` in Netlify environment variables. Monitor function logs for `[XP] Session validation failed (warn mode)` entries. Review any patterns of legitimate failures.
2. **Phase 2 - Enforcement:** Once satisfied that clients are correctly sending session tokens:
   - Set `XP_SERVER_SESSION_WARN_MODE=0`
   - Set `XP_REQUIRE_SERVER_SESSION=1`
3. **Rollback:** If enforcement causes issues, immediately set `XP_REQUIRE_SERVER_SESSION=0` and re-enable warn mode while investigating.

**Session validation checks:**
- HMAC signature verification on session tokens
- User ID matches token claims
- Browser fingerprint matches (anti-hijacking)
- Session exists and is valid in Redis

See `netlify.toml` for the complete environment variable reference.
