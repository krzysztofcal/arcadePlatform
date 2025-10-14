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

## Tests
There are two layers of tests:

1) In-browser tests (no tooling)
- Open `tests/index.html` in a browser. You’ll see a summary and assertion results.

2) Playwright (CI) test
- Validates that the in-browser tests pass by loading `tests/index.html` in a headless browser.

Run locally:
- `npm i`
- `npx playwright install --with-deps`
- `npm test`

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
