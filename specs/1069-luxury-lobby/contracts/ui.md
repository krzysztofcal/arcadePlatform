# UI contracts — review v3 and unchanged platform

## Mode availability
| Entry | Initial destination | Future owner |
| --- | --- | --- |
| Poker Online | Prototype /poker/; final pokerQuickSeat + existing Online Tables | Existing Poker |
| Single Player | Coming Soon information; online vs bots | #1077 |
| World Tour | Coming Soon information | #1075 |
| Seasons | Coming Soon information; weekly designated-table visuals | #1075 |
| Sit & Go | Coming Soon information | #797 |

Bottom shortcuts: Online Tables, Progression, Daily Bonus, Profile. Daily Bonus is not an extra game. Prototype links remain `/poker/` and `/account.html`.

## Preserved DOM/action contract (future #1069)
`poker/index.html` IDs exist once: pokerError, pokerAuthMsg, pokerLobbyContent, pokerQuickSeat, pokerRefresh, pokerCreate, pokerBuyIn, pokerMaxPlayers, pokerSignIn, pokerGuestPlay, pokerTableList, pokerWelcomeBonusBanner, pokerWelcomeBonusClaim, pokerProgressBankroll, pokerProgressRoadmap, pokerProgressCelebration.

Actions stay `poker/poker.js:initLobby()` quickSeat/createTable/playAsGuest/handleClick/checkAuth/renderTables/renderProgression/refreshLobby. Navigation stays buildPokerTableUrl/navigateToPokerTable → `/poker/table-v2.html` with tableId/seatNo/autoJoin/autoStart/guest. Keep guest session `poker:guestSession`, lifecycle/reconnect and existing NORMAL/SLOW/RESTRICTED/fixed-buy-in access.

Topbar/sidebar retain xpBadge, avatar/menu IDs, sbToggle/sidebar, normalizeTopbarBadges, UserUiState and existing XP/CH refresh. Profile/welcome bonus → account. No endpoint/request/authorization/ledger/WS message changes.

## Proposed #800 table-wide appearance contract (not implemented)
Keep one file-local renderer in `poker/poker-v2.js`. Proposed `resolveTableTheme(tableId)` has no side effects and returns one of six fixed IDs (Classic for invalid input). Use existing `hashBotPresentationKey()` with the fixed ordered list in plan.md. Proposed `applyTableTheme(themeId,tableId)` extends existing preload/request-generation logic and sets the coherent scene attribute only for the current canonical table.

Canonical input comes from accepted `mergeSnapshot(payload,frame)` → `state.tableId`, not player identity or URL alone. Preserve wrong-table/reconnect guards. Every compatible client at the same ID computes the same result; joins/hands/redraws/reload/reconnect cannot change it. No draw, preference API, storage, new DB/WS field, scheduler or economy authority. Preserve existing actual Poker V2 assets and static dealer.

Classic on missing art is a safe local fallback, not a re-assignment. Mixed pre-#800 clients still render Classic: compatible rollout is needed. Mapping/hash/list freeze and event precedence boundaries are in plan.md. Remove the diagnostic theme-select fragment in `bindCelebrationPreview()` only in later #800; unrelated FX tools remain.

## Daily Bonus contract
Review-only dailyDialog has four hardcoded EXAMPLE STATE cards under SAMPLE JOURNEY · NOT YOUR ACCOUNT, no amounts/timestamps and no claim listener. Claim disabled, availability Not configured. `#daily-bonus` deep links open landscape/portrait dialogs. Future live lobby unavailable until real approved campaign/status is present.

#1079 owns economic GO, real authenticated claims/eligibility, atomic ledger/idempotency and any bounded progression/history/timer contract. Existing GET only returns eligible unclaimed items; empty list cannot be treated as completed Day 1. No fake timer, jackpot, lucky draw, sale or VIP multiplier.

## Prototype code contract
preview.js is an IIFE with goTo/updatePosition/openPanel/openHashPanel and Coming Soon descriptions. Four shortcuts and only #daily-bonus panel deep link. No theme selectors/loaders, fetch/auth/WS/storage/reward timer. Toolbar stays in document flow to avoid covering Play Now; short screens scroll.

Existing self-origin CSP covers scripts/styles/images; no inline JS/handlers or new SHA. One selector rule per physical CSS line, media braces on separate lines. No application logging needed. Review-only Netlify drawer wrapper hidden to prevent bottom touch interception; no deployment setting change.
