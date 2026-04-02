[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
# Arcade Portal

Arcade Portal is a browser-based gaming hub that combines quick arcade games with real-time online poker. Play in the browser, earn XP, manage chips, and move between solo sessions and live tables without installs.

## Features
- 🎮 Multiple arcade-style games available from one hub.
- ♠️ Online poker with real-time multiplayer tables.
- 🪙 Chips system with tracked balances, buy-ins, and cash-outs.
- ⭐ XP progression across supported games.
- 🤖 Bot players to help keep poker tables active.
- 🌐 Runs in the browser with a static frontend and live backend services where needed.

## How to Play
### Arcade
- Open `index.html` to launch the main portal locally.
- Browse the catalog and jump into any available game.
- Example entry points include `game_trex.html`, `game_cats.html`, and the games under `games-open/`.

### Poker
- Open `poker/index.html` for the lobby.
- Join a table, take a seat, and play hands in `poker/table.html`.
- Live table updates are supported by the poker API functions and the WebSocket server in `ws-server/`.

## Live Preview
- For a quick local preview of the arcade portal, open `index.html` directly in a browser.
- Poker, XP, and chips flows also rely on the supporting services in `netlify/functions/` and `ws-server/`.

## Screens / Gameplay
- Main hub: `index.html`
- Poker lobby: `poker/index.html`
- XP page: `xp.html`

## Project Structure
- `index.html` — Arcade hub and main entry point.
- `games-open/` — Browser-playable game pages and assets.
- `game_*.html` — Standalone game pages used by the portal.
- `poker/` — Poker lobby, table UI, and browser client logic.
- `js/` — Shared portal, XP, auth, chips, and UI scripts.
- `netlify/functions/` — Serverless endpoints for poker, XP, chips, favorites, and sessions.
- `ws-server/` — Real-time poker WebSocket server.
- `tests/` — Browser, unit, integration, and end-to-end coverage.

## Development
- Frontend: static HTML, CSS, and vanilla JavaScript.
- Backend: Netlify Functions for poker, XP, chips, and supporting flows.
- Realtime: `ws-server/` handles live poker messaging.
- Useful commands:
  - `npm run test`
  - `npm run check:all`

## Testing
- Open `tests/index.html` for browser-based checks.
- Use `npm run test` for the scripted suite.
- Use `npm run check:all` for the project guard checks.

## Documentation
- XP system and progression: [docs/xp-system.md](docs/xp-system.md)
- Poker realtime architecture: [docs/poker-realtime.md](docs/poker-realtime.md)
- Development and wiring: [docs/development.md](docs/development.md)
- Operations and configuration: [docs/operations.md](docs/operations.md)

## CI Status
- GitHub Actions workflow: tests

[![Tests](https://github.com/krzysztofcal/arcadePlatform/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/krzysztofcal/arcadePlatform/actions/workflows/tests.yml)
