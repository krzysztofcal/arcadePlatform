# Review and validation guide

## Prerequisites
Use repository dependencies already declared in package.json, a static HTTP server and the Draft PR Netlify preview. No secrets or authenticated API calls needed for the visual prototype.

## Local review
Run `python3 -m http.server 4173` from the repository root. Open:
- `http://localhost:4173/poker/designs/luxury-lobby/`
- `http://localhost:4173/poker/designs/luxury-lobby/landscape.html`
- `http://localhost:4173/poker/designs/luxury-lobby/portrait.html`

Run existing checks: `npm run syntax`, `npm run check:csp-inline`, `npm run ci:guards`. No new UI test suite.

## Targeted review scenarios
1. Landscape 844×390 and 1280×800: several tall cards, next-card peek, scroll/indicators reach all five; first Online action and bottom shortcuts reachable.
2. Portrait 390×844, 360×640, 320×568: dominant card, next-card peek; short phones may vertically scroll. No accidental page-wide horizontal overflow.
3. Visit four Coming Soon details; no playable links, purchases, fake timetable, reward or offline Single Player. Escape closes; focus returns.
4. Cosmetics: six shipped artworks, room/dealer/felt previews, clear no ownership/persistence statement. Close returns to lobby.
5. Keyboard carousel: focus region, arrows/Home/End; focusable indicators and shortcuts; reduced-motion scrolling; larger text/zoom and safe areas.
6. Observe network: prototype loads only local HTML/CSS/JS/images; zero auth/CH/XP/API/WS calls. No storage write.
7. Open Poker Online/Online Tables/Profile deliberately to verify destinations `/poker/` and `/account.html`; do not create/join/claim as part of design review.
8. Netlify preview: both routes and assets return 200 with existing CSP, JS works under HTTPS headers. Owner checks actual phone orientation/touch and approves visuals before final tasks.

## Later implementation acceptance (not executed in this PR)
After separate approval: authenticated/guest Quick Seat, Create/Join/Refresh, tier locks/insufficient CH, bonus eligibility/account path, signout/account switch, table navigation and reconnect. #800 local permission/fallback/privacy scenarios. Reuse existing critical tests when logic changes; do not generate CSS/render/glue suites. Record exact preview revision and manual evidence. No Production or WS deploy for this design PR.
