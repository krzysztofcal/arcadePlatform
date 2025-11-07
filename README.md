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
  - For validated windows the payload includes `{ now, chunkMs, pointsPerPeriod, minVisibility, minInputs, visibilitySeconds, inputEvents, status, reason? }`.
  - `debug.reason` can surface `insufficient-activity`, `too_soon`, `invalid_window`, and the existing server reasons: `capped`, `locked`, `idempotent`.

### Message contract: postWindow
- Payload fields:
  - `visibilitySeconds`
  - `chunkMs`
  - `inputEvents`
  - `windowEnd`
  - `scoreDelta` (optional) – represents the incremental score earned during the reported window compared with the previous window.
- The server currently accepts and validates `scoreDelta`. When `XP_DEBUG=1`, successful responses echo the value as `debug.scoreDelta`, but the field does not yet influence XP awards.

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
