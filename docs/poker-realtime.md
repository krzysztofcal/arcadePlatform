# Poker Realtime Architecture

This document gives a concise map of the poker realtime pieces in Arcade Portal and points to the deeper poker docs already in the repository.

## What it covers
- Browser poker entry points live in `poker/index.html` (lobby) and `poker/table.html` (table view).
- Browser client logic lives under `poker/`, including the realtime client files such as `poker-ws-client.js` and `poker-realtime.js`.
- Active gameplay runtime ownership is WS-only in `ws-server/` (join/start/act/leave/timeout/autoplay/next-hand/disconnect cleanup). Netlify HTTP gameplay endpoints are retired (`410`) and non-authoritative.
- The realtime transport lives in `ws-server/`, which provides the WebSocket server used by poker clients.
- Bot support is part of the poker flow and is covered by the poker tests and supporting docs already in `docs/`.

## Related docs
- Poker system specification: [docs/poker-system-spec.md](poker-system-spec.md)
- WebSocket poker protocol: [docs/ws-poker-protocol.md](ws-poker-protocol.md)
- Poker deployment notes: [docs/poker-deployment.md](poker-deployment.md)
- Poker bots: [docs/poker-bots.md](poker-bots.md)
- Hole-card normalization: [docs/poker-hole-cards-normalization.md](poker-hole-cards-normalization.md)

## Runtime components
- `poker/` renders the lobby and table experience in the browser.
- `netlify/functions/poker-*.mjs` gameplay endpoints are retired/non-authoritative (`410`) for active gameplay commands.
- `netlify/functions/ws-mint-token.mjs` supports websocket authentication token minting.
- `ws-server/server.mjs` runs the realtime poker websocket server.

## Operational note
Treat poker state as server-authoritative. Realtime updates improve responsiveness, but sensitive state and game transitions must remain controlled by the backend services.
