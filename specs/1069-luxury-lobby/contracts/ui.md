# UI contracts — review v2 and unchanged platform

## Mode availability
| Entry | Initial destination | Future owner |
| --- | --- | --- |
| Poker Online | Prototype /poker/; final pokerQuickSeat + existing Online Tables | Existing Poker |
| Single Player | Coming Soon information; online vs bots | #1077 |
| World Tour | Coming Soon information | #1075 |
| Seasons | Coming Soon information; weekly designated-table visuals | #1075 |
| Sit & Go | Coming Soon information | #797 |

Bottom shortcuts: Online Tables, Progression, Daily Bonus, Cosmetics, Profile. Daily Bonus is not an extra game. Prototype links remain `/poker/` and `/account.html`.

## Preserved DOM/action contract (future #1069)
`poker/index.html` IDs exist once: pokerError, pokerAuthMsg, pokerLobbyContent, pokerQuickSeat, pokerRefresh, pokerCreate, pokerBuyIn, pokerMaxPlayers, pokerSignIn, pokerGuestPlay, pokerTableList, pokerWelcomeBonusBanner, pokerWelcomeBonusClaim, pokerProgressBankroll, pokerProgressRoadmap, pokerProgressCelebration.

Actions stay `poker/poker.js:initLobby()` quickSeat/createTable/playAsGuest/handleClick/checkAuth/renderTables/renderProgression/refreshLobby. Navigation stays buildPokerTableUrl/navigateToPokerTable → `/poker/table-v2.html` with tableId/seatNo/autoJoin/autoStart/guest. Keep guest session `poker:guestSession`, lifecycle/reconnect and existing NORMAL/SLOW/RESTRICTED/fixed-buy-in access.

Topbar/sidebar retain xpBadge, avatar/menu IDs, sbToggle/sidebar, normalizeTopbarBadges, UserUiState and existing XP/CH refresh. Profile/welcome bonus → account. No endpoint/request/authorization/ledger/WS message changes.

## Proposed #800 free local appearance contract
One proposed global IIFE PokerCosmetics shares the six existing IDs/catalog/apply loader. Design-only API: catalog, readPreference(identity), savePreference(identity,choice), resolveTheme(choice,identity,tableId), applyTheme(screen,themeId,identity).

All six FREE for everyone. Choice is Auto/Random default or explicit named manual theme; no canSelect entitlement check, VIP requirement or paid lock. Known ID/mode validation is not an ownership check. Paid/VIP SKUs must be future distinct content. Keys and deterministic stable auto proposal are in data-model.md; policy approval remains required before implementation.

Same participant/table resolves same auto art on reload/reconnect. Never reroll on hand, bet, snapshot or redraw. Manual overrides auto. Identity transitions cancel pending loads, reset safely; full preload atomically applies local art. Missing assets → Classic/static dealer. Never mutate snapshots/seats/actions/tier/another player's scene. Diagnostic isThemePreviewBuild remains diagnostic. Final data-poker-theme/catalog extraction updates internal consumers together in separate #800 PR.

## Daily Bonus contract
Review-only dailyDialog has four hardcoded EXAMPLE STATE cards under SAMPLE JOURNEY · NOT YOUR ACCOUNT, no amounts/timestamps and no claim listener. Claim disabled, availability Not configured. `#daily-bonus` deep links open landscape/portrait dialogs. Future live lobby unavailable until real approved campaign/status is present.

#1079 owns economic GO, real authenticated claims/eligibility, atomic ledger/idempotency and any bounded progression/history/timer contract. Existing GET only returns eligible unclaimed items; empty list cannot be treated as completed Day 1. No fake timer, jackpot, lucky draw, sale or VIP multiplier.

## Prototype code contract
preview.js is an IIFE with goTo/updatePosition/openPanel/showTheme; no fetch/auth/WS/storage/timer reward code. showTheme preloads seven actual art resources before replacing visual samples; late response ignored. Auto shows fixed labeled Neon Vegas sample only. Classic retains default native styling, other themes reference their own SVG felt/rail plus room/dealer/card/frame assets.

Existing self-origin CSP covers scripts/styles/images; no inline JS/handlers or new SHA. One selector rule per physical CSS line, media braces on separate lines. No application logging needed. Review-only Netlify drawer wrapper hidden to prevent bottom touch interception; no deployment setting change.
