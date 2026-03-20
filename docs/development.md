# Development and Wiring

This document preserves the developer workflow details that were previously embedded in `README.md`.

## Local development
- Open `index.html` directly in a browser.
- Game page examples: open `game_cats.html` or other playable pages under `games-open/`.

## Structure overview
- `index.html` – Hub landing page
- `game_cats.html` – Game page (canvas)
- `css/portal.css`, `css/game.css` – Styles
- `js/config.js` – Centralized constants (aspect ratio, storage keys, etc.)
- `js/core/*` – Small services (Storage, Audio, Fullscreen, Input)
- `js/features/cats/CatsRules.js` – Game rules/level parameters
- `js/game.js` – Game wiring using services
- `tests/index.html` – Browser-based tests page (with a tiny harness)

## Wiring commands
- `npm run wire:xp` walks committed game HTML, injects the bridge scripts (`xp.js`, `xp-game-hook.js`), and adds the inline auto-bootstrap. Run this after adding a new playable surface or whenever the bridge snippet drifts from the template. The command is idempotent and will not duplicate bridge tags.
- `npm run check:games-xp-hook` validates every committed playable page includes exactly one copy of the XP bridge trio. Use it in isolation for quick checks or rely on `npm run check:all` during CI.
- The inspected paths live in [`scripts/check-games-xp-hook.mjs`](../scripts/check-games-xp-hook.mjs) (`shouldInspect()`). Keep that list and this doc in sync when you add new playable folders.

If the wire script reports an already-injected page it leaves the markup untouched, making it safe to re-run while you iterate.

## Multi-game rollout checklist
1. Add or update the game entry (for example under `games/` or `games-open/`) and ensure the HTML exports a unique `data-game-id` or uses the conventional filename.
2. Run `npm run wire:xp` to inject or refresh the GameXpBridge snippet.
3. Open the page locally to verify the badge renders and `GameXpBridge.auto()` appears once in the markup.
4. Execute `npm run check:games-xp-hook` (or `npm run check:all`) so the guard confirms every playable HTML file is wired.
5. Commit the changes together with any assets so CI exercises the bridge with Playwright.

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

## Notes
- Fullscreen logic uses `FullscreenService`; inputs are handled by `InputController`.
- Persistent state uses `StorageService` and `localStorage`.
- Polish diacritics and symbols are encoded correctly; canvas text uses Unicode.

## Roadmap
- Optional Renderer service to further separate drawing and resize concerns.
- ESLint/Prettier config for consistent code style.
- Additional game samples and hub features.
