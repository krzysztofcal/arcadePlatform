# UI contracts and unchanged platform interfaces

## Mode availability
| Entry | Initial destination | Future owner |
| --- | --- | --- |
| Poker Online | Prototype `/poker/`; final `pokerQuickSeat` + current Online Tables subview | Existing Poker |
| Single Player | Coming Soon information only, online vs bots | #1077 |
| World Tour | Coming Soon information only | #1075 |
| Seasons | Coming Soon information only; weekly designated-table rotation | #1075 |
| Sit & Go | Coming Soon information only | #797 |

## Preserved DOM/action contract (future #1069)
`poker/index.html` IDs exist once: `pokerError`, `pokerAuthMsg`, `pokerLobbyContent`, `pokerQuickSeat`, `pokerRefresh`, `pokerCreate`, `pokerBuyIn`, `pokerMaxPlayers`, `pokerSignIn`, `pokerGuestPlay`, `pokerTableList`, `pokerWelcomeBonusBanner`, `pokerWelcomeBonusClaim`, `pokerProgressBankroll`, `pokerProgressRoadmap`, `pokerProgressCelebration`.

Actions stay in `poker/poker.js:initLobby()` (`quickSeat/createTable/playAsGuest/handleClick/checkAuth/renderTables/renderProgression/refreshLobby`). Navigation stays `buildPokerTableUrl/navigateToPokerTable`: `/poker/table-v2.html`, existing `tableId/seatNo/autoJoin/autoStart/guest`. Keep guest session `poker:guestSession` and existing teardown/reconnect.

Topbar/sidebar retain `xpBadge`, avatar/menu IDs, `sbToggle/sidebar`, `normalizeTopbarBadges`, `UserUiState` identity slices and existing XP/CH refresh. Profile/bonus → `/account.html`.

No endpoint, request shape, authorization, ledger or WS message changes. NORMAL/SLOW/RESTRICTED and fixed buy-in eligibility remain authoritative and unchanged.

## Proposed #800 local presentation contract
One proposed global IIFE `PokerCosmetics`, sharing existing six-ID catalog and loader between lobby/table settings. API shape is design-only: `catalog`, `readPreference(identity)`, `savePreference(identity, themeId)`, `canSelect(themeId, permissions)`, `applyTheme(screen, themeId, identity)`.

- Classic selectable; other art is preview-only absent explicit permission. Future server entitlement from #1070 may supply `permissions`; local persisted ID cannot supply it.
- Identity-scoped key/value documented in data-model.md; clear scene/reset in existing signed-out/auth-pending lifecycle.
- Atomic scene application after asset preload with identity/generation check; failure Classic/static dealer. Do not mutate snapshot, seats, hand, action gate, table tier or anyone else's scene.
- Existing diagnostic `isThemePreviewBuild()` remains diagnostic; it does not grant paid access.
- Preserve known six IDs; proposed `data-poker-theme` replaces internal preview-only selectors together with loader changes in the separate #800 PR.

## Prototype contract
`poker/designs/luxury-lobby/` has no auth/runtime boot scripts, no analytics/ad SDK and no storage. External scripts/styles/images are same-origin under existing CSP. Inline JavaScript and handlers are absent, so no SHA allowlist delta. Current Poker link navigates out to the unchanged app. Cosmetics HTML samples are review-only, not a runtime catalog or applying settings to table-v2.
