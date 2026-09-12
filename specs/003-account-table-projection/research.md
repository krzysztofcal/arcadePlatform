# Research

- `netlify/functions/profile-me.mjs` already owns the authenticated owner-profile response and can be extended without changing the existing GET/PATCH path for callers that omit the opt-in query.
- `netlify/functions/_shared/chips-ledger.mjs:getUserBalance` is the existing balance authority. The opt-in response must read its numeric `balance` independently of the optional WS call so a WS failure cannot overwrite it with a default.
- `netlify/functions/_shared/poker-ws-runtime-notify.mjs` already centralizes the internal WS base URL, token, timeout, abort, and klog patterns. The account projection GET belongs in this existing adapter seam.
- `ws-server/poker/table/table-manager.mjs` owns materialized runtime tables and already exposes `listTableIds`, `tableSnapshot`, `tableMeta`, and authoritative member normalization. A narrow `projectUserTables(userId)` method can compose those mechanisms without querying persistence or exposing private state.
- `ws-server/server.mjs` already has token-protected internal HTTP handlers and `sendInternalJson`. A read-only `GET /internal/account/poker?userId=...` route can delegate directly to the table manager.
- `js/profile-client.js` and `js/account-page.js` are classic global/IIFE scripts. The opt-in query must be represented as a request option, and Account-only rendering must keep full IDs in DOM values while shortening visible labels.
- Existing fundamental coverage is in `tests/public-profiles.behavior.test.mjs`, `ws-server/poker/table/table-manager.behavior.test.mjs`, and `ws-server/server.behavior.test.mjs`. Account presentation is verified on the real preview, without extending UI/VM rendering tests.

## Verified PR #983 runtime cause (2026-09-12)

Deploy Preview `POKER_WS_INTERNAL_BASE_URL` correctly targets
`https://ws-preview.kcswh.pl`; its internal token matches the preview runtime.
The local authenticated route returned HTTP 200 JSON, while the public route
returned HTTP 200 `text/plain` body `OK`. Preview Caddy lacked an exact Account
route, so its catch-all response intercepted the request before WS. The adapter
therefore logged `invalid_json` and returned `poker: null`. Adding the exact
preview-only reverse proxy route restores token-protected JSON. No Netlify env
change or DB fallback is needed. The previous 66 E2E ran a localhost test-server
configuration and did not exercise the actual Netlify → public WS boundary.

## Decisions

- Use a best-effort WS projection: successful WS data becomes `poker`, while transport, timeout, auth, validation, and unavailable failures become `poker: null`.
- Resolve profile and balance as the required Account response data; resolve the optional WS projection independently and never use the database to reconstruct a second current-table list.
- Return a compact sanitized table row with `tableId`, lifecycle `status`, `seatNo`, `seatStatus`, public `stack`, `stakes`, `maxPlayers`, `stateVersion`, and public `handStatus`. Omit private cards, decks, hand seeds, and other users' private branches.
- Treat only an authoritative non-bot member matching the authenticated user as membership. `inPoker` is derived from the returned table rows, not from a UI guess or a database-only seat query.
- Keep `tableId` unchanged across WS, Netlify, and shared code. Add one Account-page-only display helper for the abbreviated text.

## Alternatives rejected

- A direct `poker_seats`/`poker_tables` query from Netlify would make persistence a competing authority and can show stale membership.
- A new broad Account/poker test suite would exceed the repository's fundamental-test rule; existing behavior files cover the contract at their current seams.
- A separate browser module or a client-side WS scan would violate the JSP/global-script and authority boundaries.
