# Android M1 UI/UX — PR 1 (#1140)

## Contract

One APK bottom navigation, rendered by the existing sidebar renderer on Lobby
and Account: Lobby, Tables, Progression, Bonus, Profile. The actual visible
lobby view determines the active item; denied guest destinations remain Lobby.
Account always marks Profile. The poker table has no application bottom bar.

Account uses ordinary same-origin links to `/poker/index.html` with the bounded
fragments `#modes`, `#tables`, `#progression`, `#bonus`. Lobby consumes them only
in APK after the initial auth check, delegates to `showLobbyView()`, and keeps
existing auth gates. Unknown fragments select Lobby. Same-fragment taps reopen
the destination. This is a view hint, never authentication or authorization.
No SSO, session transfer, router, API, backend or WS changes.

The original static lobby shortcuts remain on WWW. The APK packager removes
that duplicate; the same existing `renderBottomNav()` renders the five items on
both packaged screens, using the accepted shortcut artwork and visual style.
The APK stylesheet reserves 88px and fixes this one bar to the native WebView
bottom. Native margins remain the single owner of system insets. The existing
Account footer stays in document flow above the reserved bar space, so legal
links remain reachable in portrait and landscape rather than being covered.

Opening Daily Bonus only reads/displays status. Both WWW and APK require the
existing Claim button to send a claim. This is the intentional shared-web
behavior change; reward eligibility, amounts and server idempotency are unchanged.
No purchases, automatic JOIN or other financial action is added by navigation.

## Implementation plan and scope boundary

- Extend `js/sidebar.js::bottomNavItems/renderBottomNav` for the APK destinations,
  artwork and actual active state; preserve ordinary portal navigation.
- Compose only one APK bar in `mobile/poker/package-web.mjs`; style it through
  `mobile/poker/mobile.css` without changing global WWW CSS or native inset code.
- Consume bounded fragments in `poker/poker.js::initLobby` after auth resolution;
  delegate to existing `showLobbyView`, `refreshDailyBonus` and Claim handlers.
- Add the five short labels in `js/i18n.js`.
- Extend existing fundamental state-flow and packaging checks. No layout suite.

PR 2 owns broader error wording and Android Back; PR 3 owns browser re-login
explanation and Help/Legal entry. Audio #1146 follows the complete UI acceptance.
Accepted #1155/#1160/#1208 content, Terms, a2/manifest, deletion gates, retention
#1157 and all Stage/Production configuration remain outside this new diff.

Constitution check: reuse existing packages/components, no storage or schema,
JSP-compatible JS, klog, one CSS selector rule per line. No inline script changes;
run the CSP guard. New-scope independent Claude review is mandatory. No merge,
Production release or WS operation is implied by this preparation.

## Physical acceptance — pending OWNER

- Portrait and landscape, Lobby and Account: exactly one bar, same artwork/order,
  all five labels visible, correct active item and usable touch targets.
- Scroll to both ends: bar stays anchored; final content and Account actions stay
  reachable. No double inset, gesture overlap or horizontal page overflow.
- From Account use each destination; repeat same-tab taps and close/reopen Bonus.
  Guest Tables/Progression show the existing login restriction, not an active
  inaccessible tab; authenticated destinations work after auth resolves.
- Bonus opening/closing never claims; explicit Claim remains the sole action.
  Real reward claim requires a separately authorized test, not visual acceptance.
- Table menu/actions remain unchanged with no bottom bar. Existing dialog overlays
  stay above navigation. On Account, keyboard and deletion dialog remain usable;
  do not submit account deletion during this visual acceptance.
- Normal WWW keeps its existing navigation/layout; Bonus requires explicit Claim.

Breaking impact: APK navigation/bookmarked view fragments and web Bonus opening
behavior change; no API/schema/WS break. Installed APKs require a rebuild. A local
fixture or green CI does not replace physical exact-artifact acceptance.
