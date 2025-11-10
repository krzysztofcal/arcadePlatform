[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
# Arcade Platform

A lightweight arcade hub (static HTML/CSS/JS) with a sample game (Łap koty — Arcade). The code is structured for clarity and SOLID-ish separation using small services.

## Live Preview
- Open `index.html` locally or host via any static server.

## Structure
- `index.html` – Hub landing page
- `game_cats.html` – Game page (canvas)
- `css/portal.css`, `css/game.css` – Styles
- `js/config.js` – Centralized constants (aspect ratio, storage keys, etc.)
- `js/core/*` – Small services (Storage, Audio, Fullscreen, Input)
- `js/features/cats/CatsRules.js` – Game rules/level parameters
- `js/game.js` – Game wiring using services
- `tests/index.html` – Browser-based tests page (with a tiny harness)

## Development
- Open `index.html` directly in a browser.
- Game page: open `game_cats.html`.

### XP guardrails
- Run `npm run check:all` to validate lifecycle centralization, XP badge placement, and XP bridge wiring. Use `npm run check:xpbadge -- --fix` for auto-remediation when there’s exactly one badge anchor. See [docs/guards.md](docs/guards.md) for details on the badge and lifecycle checks plus the new XP hook validator.

### GameXpBridge API
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
2. Load `/js/debug.js`, `/js/xp.js`, and `/js/xp-game-hook.js` (in that order) using root-absolute paths.
3. Include the bounded inline bootstrapper that calls `GameXpBridge.auto()` exactly once. The template retries up to ~500 ms with a gentle backoff and sets `window.__xpAutoBooted` after a successful call so network failures never spin in a tight loop.

The helper survives soft navigations—if you’re swapping views inside an SPA, call `GameXpBridge.start(newGameId)` for each routed surface; you do **not** need to re-inject the scripts.

#### XP delta guard
- The XP bridge consolidates raw score updates and clamps deltas locally using `window.XP_DELTA_CAP_CLIENT` (default 300). The clamp can tighten at runtime when the server advertises a stricter ceiling.
- Timestamps are monotonic per page so BFCache restores or retries never replay stale payloads. When a 422 `delta_out_of_range` arrives the bridge backs off briefly, fetches status, and adopts the advertised cap before retrying.
- Metadata excludes core identifiers (`userId`, `sessionId`, `delta`, `ts`) automatically and still flows when `localStorage` or `crypto.randomUUID` are blocked (private browsing fallbacks).

#### XPClient contract (important)
- `XPClient.postWindow(payload)` returns the parsed success payload on **2xx** responses.
- The helper **throws** an `Error` on non-2xx HTTP responses (for example `422 delta_out_of_range`, `500`) and on transport failures. The error message includes the server-provided `error` field when available.
- Callers must wrap invocations in `try/catch` if they need to handle failures gracefully.

#### Server gates & debug
- `award-xp.mjs` validates the JSON body, tolerates legacy `scoreDelta` / `pointsPerPeriod` fields, and enforces `XP_DELTA_CAP` plus the daily (`XP_DAILY_CAP`) and per-session (`XP_SESSION_CAP`) ceilings.
- Requests are rejected when the timestamp is stale (`status: "stale"`), another tab owns the lock (`status: "locked"`), metadata is malformed/oversized, or the optional activity guard blocks idle deltas.
- Flip `XP_REQUIRE_ACTIVITY=1` to require input/visibility thresholds (`XP_MIN_ACTIVITY_EVENTS`, `XP_MIN_ACTIVITY_VIS_S`). When disabled the function skips those checks entirely.
- Metadata must remain shallow: depth ≤ 3 and serialized size ≤ `XP_METADATA_MAX_BYTES` (default 2048 bytes). Larger payloads return `413 metadata_too_large` without mutating totals.
- Session keys refresh their TTL (`XP_SESSION_TTL_SEC`, default 7 days) whenever deltas are accepted or a zero-delta heartbeat advances `lastSync`, keeping Redis tidy.
- Enabling `XP_DEBUG=1` adds `{ delta, ts, lastSync, status, dailyCap, sessionCap }` to responses for diagnostics.

### Diagnostics logging
- Unlock the client recorder for 24 hours by visiting any page with `?admin=1` or tapping the About page title five times within three seconds. The flag is stored in `localStorage["kcswh:admin"]` and expires automatically.
- Once unlocked, the recorder auto-starts (`window.KLog.start(1)`) and the About page surfaces a **Dump diagnostics** button. Clicking it opens a new tab populated with the recent buffer (up to 1000 lines) and falls back to downloading `kcswh-diagnostic-<timestamp>.txt` when the popup is blocked.
- The buffer captures the XP lifecycle breadcrumbs (`xp_init`, `xp_start`, `xp_stop`, `block_no_host`, `block_hard_idle`, `award`) so you can confirm that accrual only happens on game hosts and is suppressed on idle or non-host pages. Check `window.KLog.status()` for the active level and line count.

### Wiring commands
- `npm run wire:xp` walks committed game HTML, injects the bridge scripts (`xp.js`, `xp-game-hook.js`), and adds the inline auto-bootstrap. Run this after adding a new playable surface or whenever the bridge snippet drifts from the template. The command is idempotent and will not duplicate bridge tags.
- `npm run check:games-xp-hook` validates every committed playable page includes exactly one copy of the XP bridge trio. Use it in isolation for quick checks or rely on `npm run check:all` during CI. The inspected paths live in [`scripts/check-games-xp-hook.mjs`](scripts/check-games-xp-hook.mjs) (`shouldInspect()`); keep that list and this doc in sync when you add new playable folders.

If the wire script reports an already-injected page it leaves the markup untouched, making it safe to re-run while you iterate.

### Multi-game rollout checklist
1. Add or update the game entry (for example under `games/` or `games-open/`) and ensure the HTML exports a unique `data-game-id` or uses the conventional filename.
2. Run `npm run wire:xp` to inject or refresh the GameXpBridge snippet.
3. Open the page locally to verify the badge renders and `GameXpBridge.auto()` appears once in the markup.
4. Execute `npm run check:games-xp-hook` (or `npm run check:all`) so the guard confirms every playable HTML file is wired.
5. Commit the changes together with any assets so CI exercises the bridge with Playwright.

### P1.1 rollout & rollback
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

### Message contract: `postWindow`
Client → server payload (minimal set, extras allowed):
  - `userId` (string)
  - `sessionId` (string)
  - `delta` (integer ≥ 0) – requested XP increment for the active session
  - `ts` (ms since epoch) – last activity timestamp used for ordering/lastSync persistence
  - `metadata` (object, optional) – any additional context (gameId, instrumentation, etc.)

Server behavior:
  - Requests with `delta` outside `0…XP_DELTA_CAP` (default 300) are rejected. Legacy clients can continue sending `scoreDelta` / `pointsPerPeriod` and the server will coerce them once per request.
  - XP is granted directly from `delta` while enforcing per-session (`XP_SESSION_CAP`, default 300) and per-day (`XP_DAILY_CAP`, default 600) ceilings. Partial grants surface `reason: 'daily_cap_partial' | 'session_cap_partial'`.
  - Responses remain backwards compatible: `{ ok, awarded, totalToday, cap, totalLifetime }` plus `sessionTotal`, `lastSync`, and `capDelta` so clients can rehydrate badge state and mirror the server cap.
  - When `XP_DEBUG=1`, the payload includes `debug` with the requested delta, caps, lastSync, and status code.

Response status values:
  - `ok` – full grant
  - `partial` – partial grant (daily or session)
  - `daily_cap`, `daily_cap_partial`, `session_cap`, `session_cap_partial`, `stale`, `locked`, `inactive`
  - `statusOnly` – status probes without awarding XP

Client hooks:
  - `window.XP.addScore(delta)` — queues XP locally; the bridge now forwards consolidated deltas via the simplified payload above and lets the server enforce rate limits.

## Tests
There are two layers of tests:

1) In-browser tests (no tooling)
- Open `tests/index.html` in a browser. You’ll see a summary and assertion results.

2) Playwright (CI) test
- Validates that the in-browser tests pass by loading `tests/index.html` in a headless browser.

Run locally:
- `npm i`
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install` if you rely on a system Chromium.
- `npm run test` (set `CI_NO_E2E=1` to skip the Playwright suite when browsers aren’t available).
- `PLAYWRIGHT=1 npm test` runs the full Playwright end-to-end suite, including the XP idle coverage.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `XP_DEBUG` | `0` | Include the `debug` object in responses for easier staging diagnostics. |
| `XP_DAILY_CAP` | `600` | Maximum XP a user can gain per UTC day. |
| `XP_SESSION_CAP` | `300` | Maximum XP a single session can accumulate before further deltas are rejected. |
| `XP_DELTA_CAP` | `300` | Largest delta accepted from the client in a single request. |
| `XP_LOCK_TTL_MS` | `3000` | Duration of the per-session Redis lock that guards concurrent writes. |
| `XP_SESSION_TTL_SEC` | `604800` | TTL (seconds) for session counters; refreshed on each award/heartbeat to curb key bloat. |
| `XP_DRIFT_MS` | `30000` | Maximum allowed future drift for client `ts`. Requests beyond this tolerance are rejected. |
| `XP_REQUIRE_ACTIVITY` | `0` | When `1`, enforce minimum input/visibility thresholds before awarding XP. |
| `XP_MIN_ACTIVITY_EVENTS` | `4` | Minimum `metadata.inputEvents` required when `XP_REQUIRE_ACTIVITY=1`. |
| `XP_MIN_ACTIVITY_VIS_S` | `8` | Minimum `metadata.visibilitySeconds` required when `XP_REQUIRE_ACTIVITY=1`. |
| `XP_METADATA_MAX_BYTES` | `2048` | Maximum serialized metadata size; larger payloads return `413 metadata_too_large`. |

Set these variables in tandem so the client and server agree on throughput; the server enforces the cap and surfaces `capDelta` so clients can mirror it without redeploying.

## CI Status
- GitHub Actions workflow: tests

[![Tests](https://github.com/krzysztofcal/arcadePlatform/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/krzysztofcal/arcadePlatform/actions/workflows/tests.yml)

## Notes
- Fullscreen logic uses `FullscreenService`; inputs are handled by `InputController`.
- Persistent state uses `StorageService` and `localStorage`.
- Polish diacritics and symbols are encoded correctly; canvas text uses Unicode.

## Roadmap
- Optional Renderer service to further separate drawing/resize concerns.
- ESLint/Prettier config for consistent code style.
- Additional game samples and hub features.
