# UI contracts — review v3 and unchanged platform

**Current scope:** #1078 is merged and #1069 implementation is authorized. The implementation authorization section at the end supersedes historical design-only restrictions in this document. T009–T015 and validation evidence are recorded in tasks.md/self-review.md; #800/#1079 remain separate.

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

## Implementation authorization — 2026-10-10 (#1069 after merged #1078)
Owner explicitly requests T009–T015 on current main c4f26e4c. Reuse approved V3 art and portrait/landscape composition; no redesign. The earlier design-only restrictions describe historical #1078 and do not block this focused implementation. #800/#1079 and future playable modes remain excluded.

`poker/index.html`, `poker/poker.css`, `poker/poker.js:initLobby()` retain one controller, existing IDs, auth/guest/topbar/sidebar, Online Tables/Create/Join/Refresh and Progress Roadmap. Promote approved art to `poker/assets/lobby/`. Daily Bonus is honestly Coming Soon, with no sample account history, reward or claim. Remove Poker lobby AdSense only; preserve consent.

`renderProgression()` renders at most two actual `availableBuyIns`, defaults to highest on first view, retains a still-available explicit choice, resets safely on availability/account changes; one option is a label. `quickSeat()` sends optional numeric `buyIn` plus existing `maxPlayers`, keeps loading/error gates and navigates with existing `autoJoin=1`. `rejoinableTableIds` enables Resume Game regardless of tier availability; server always rechecks active seat first. Failed progression clears playable choices.

`netlify/functions/poker-quick-seat.mjs:handler()` validates a supplied positive safe integer `buyIn` (400 invalid_buy_in), then after resume-first and fresh progression/class validation restricts `selectCandidate()` to that exact available tier and `createAndRecommend()` to the same buy-in. Fresh unavailable selection returns existing 409 buy_in_tier_locked with bankroll metadata. Omitted property preserves legacy matching/default Create. Existing advisory lock order, canonical stakes, WS capability check, transactional table caps, authoritative JOIN funding, anti-farming and pool rules remain. No debit/seat write in Quick Seat.

Readiness: `ws-server/poker/handlers/join.mjs:handleJoinCommand()` already calls `tableManager.bootstrapHand()` after validated/funded JOIN and runtime membership; changed state is persisted with expected version, then broadcast and bot scheduling. Guest JOIN in `ws-server/server.mjs` already bootstraps. `bootstrapHand()` uses eligible human/member/readiness gates and returns unchanged for live/settlement/waiting states. Reuse this mechanism; no `autoStart` consumer, new client command, WS/protocol change or WS deployment. If runtime smoke demonstrates a gap, propose a separate readiness change for approval rather than forcing a hand.

Constitution Check: fundamental deterministic backend tests only in existing `tests/poker-quick-seat.behavior.test.mjs`: exact-tier match/create/mismatch fallback, fresh tier/class policy, resume/no debit and legacy defaults/capability/caps. Presentation uses temporary browser smoke; no new UI suite/dependencies/config/ignore cleanup. JSP IIFE/global JS, physical one-line CSS rules, klog and existing CSP; no added inline script or hash required. No migrations, Stage configuration/campaign changes, Production deploy or merge. Preview gameplay smoke may use existing isolated guest runtime only.

Breaking impact: optional API property is additive; supplied malformed values now fail 400. Exact-tier calls cannot silently switch tiers; legacy omitted calls unchanged. DOM relocation/CSS are scoped to lobby body and preserve IDs/handlers; ad removal intentional. No economy, DB or WS/protocol breaking change. Authenticated runtime verification requires a test account; do not invent credentials or use Production.
