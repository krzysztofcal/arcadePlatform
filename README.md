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
- Run `npm run check:all` to validate lifecycle centralization and XP badge placement. Use `npm run check:xpbadge -- --fix` for auto-remediation when there’s exactly one badge anchor. See [docs/guards.md](docs/guards.md) for details.

#### XP windows & idle guard
- XP windows only send while the tab stays visible and the game loop is running.
- Each window needs at least a second of visibility and a few input events before it counts.
- Going idle or switching tabs resets the window timers so no XP is awarded for background play.

#### Server gates & debug
- `award-xp.mjs` enforces multiple gates before points are granted:
  - **Visibility gate** – requests must report more than a second of visibility, and the minimum rises with the requested chunk (60% of the chunk length, clamped by `XP_MIN_VISIBILITY_S`).
  - **Input gate** – each window must include several inputs (`ceil(chunkMs / 4000)`, clamped by the `XP_MIN_INPUTS` baseline and never below two in the early guard).
  - **Timing gate** – windows shorter than the requested chunk (minus drift) or ending in the future fail with `error: "invalid_window"`.
  - **Spacing gate** – the server remembers the last accepted window end and rejects requests that arrive before another full chunk has elapsed (`reason: "too_soon"`).
- Set `XP_DEBUG=1` (environment variable for the Netlify function or via `npm run serve:xp`) to receive a `debug` object alongside successful responses.
  - Status-only probes get `debug: { mode: "statusOnly" }`.
  - For early idle rejections the debug payload includes `{ chunkMs, minInputsGate, visibilitySeconds, inputEvents, reason }`.
  - For validated windows the payload includes `{ now, chunkMs, pointsPerPeriod, minVisibility, minInputs, visibilitySeconds, inputEvents, status, reason?, scoreDelta? }`.
  - When `XP_DEBUG=1`, `scoreDelta` is echoed in **statusOnly**, **insufficient-activity**, and **validated** responses. `debug.reason` can surface `insufficient-activity`, `too_soon`, `invalid_window`, and the existing server reasons: `capped`, `locked`, `idempotent`.

### Message contract: `postWindow`
Client → server payload (subset; required unless marked optional):
  - `gameId` (string)
  - `windowStart` (ms since epoch)
  - `windowEnd` (ms since epoch)
  - `visibilitySeconds` (number)
  - `inputEvents` (integer)
  - `chunkMs` (integer)
  - `pointsPerPeriod` (integer)
  - `scoreDelta` (integer, optional) — **incremental** score earned since the last sent window. The client **accumulates** during play and **resets after a send**; omitted when 0.

Server behavior (P0.5):
  - `scoreDelta` is **accepted and validated** but **ignored for awarding**.
  - Validation clamps to `[0, SCORE_DELTA_CEILING]` (env; default `10_000`). With `XP_DEBUG=1`, responses may include `debug.scoreDelta`.
  - Backwards compatible: older clients simply omit `scoreDelta`; older servers ignore the unknown field.

Client hooks:
  - `window.XP.addScore(delta)` — accepts a number; internally rounded and accumulated (non-negative). The sample “Cats” game calls `addScore(1)` on each catch.

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
| `XP_DEBUG` | `0` | Include the `debug` object in responses (and echo `scoreDelta` when present). |
| `XP_SCORE_DELTA_CEILING` | `10_000` | Maximum accepted `scoreDelta` per window. |
| `XP_USE_SCORE` | `0` | Enable score-driven XP grants instead of time-driven awards. |
| `XP_SCORE_TO_XP` | `1` | Conversion rate from accepted score delta to XP (per request). |
| `XP_MAX_XP_PER_WINDOW` | `15` | Cap on XP converted from a single window when score mode is enabled. |
| `XP_SCORE_RATE_LIMIT_PER_MIN` | `10_000` (falls back to `XP_SCORE_DELTA_CEILING`) | Per-user rolling minute limit for accepted score deltas. |
| `XP_SCORE_BURST_MAX` | `10_000` (falls back to `XP_SCORE_RATE_LIMIT_PER_MIN`) | Maximum score delta accepted in a single window while respecting the rate limit. |
| `XP_SCORE_MIN_EVENTS` | `4` | Minimum input events required before a score-bearing window is considered. |
| `XP_SCORE_MIN_VIS_S` | `8` | Minimum foreground visibility (seconds) required for score-bearing windows. |
| `XP_SCORE_DEBUG_TRACE` | `0` | Forces score-mode debug fields even when `XP_DEBUG` is unset. |

#### Enabling score-driven awards
Score-driven XP awards are currently experimental and disabled by default to support a safe rollout. Enable the mode by setting
`XP_USE_SCORE=1`; when unset or false, the service falls back to time-based XP grants even if `scoreDelta` is provided.

When score-driven awards are enabled:

- `XP_USE_SCORE` (default `0`) toggles whether `scoreDelta` is considered when calculating XP.
- `XP_SCORE_TO_XP` (default `1`) controls the conversion rate: XP gained per request is `scoreDelta * XP_SCORE_TO_XP`, rounded and
  clamped. Negative values are ignored by the server-side guardrails.
- `XP_MAX_XP_PER_WINDOW` (default `15`) caps the XP converted from a single window regardless of the incoming score.

If a window is submitted without a `scoreDelta` value (including zero) or the feature is disabled, XP awards continue to use the
existing time-based path.

#### Score mode safeguards

Score-driven windows are additionally throttled and validated:

- **Rate limit & burst control** – each account has a rolling per-minute allowance (`XP_SCORE_RATE_LIMIT_PER_MIN`) and a per-window burst ceiling (`XP_SCORE_BURST_MAX`). Requests that exceed either bucket are rejected before any XP is granted.
- **Stricter minimum activity** – score windows must meet higher baselines before they are accepted: at least `XP_SCORE_MIN_EVENTS` interactions and `XP_SCORE_MIN_VIS_S` seconds of focused play.
- **Expanded debug fields** – when `XP_DEBUG` or `XP_SCORE_DEBUG_TRACE` is enabled, responses include score-mode diagnostics such as the active rate limit, burst cap, visibility, and input thresholds to help tune client behavior.

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
