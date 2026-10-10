# Presentation data model — Variant A review v3

No database model, migration, player appearance storage or live reward state is introduced.

| Entity | Fields / source | Validation / transition |
| --- | --- | --- |
| Mode card | online/single/world/seasons/sitgo; label, original v2 art, status, description, destination | Fixed order; Online links existing lobby, four Coming Soon details |
| Player presentation | existing identity, XP, CH; UserUiState | Preview unset; existing runtime remains authority |
| Progression | balance, tiers, availableBuyIns; buyIn/stakes/available/unlocked/unlockBankroll/progressPercent | Existing available versus unlocked semantics |
| Theme catalog (future #800) | six existing TABLE_THEME_CATALOG IDs and seven-resource asset lists | All FREE; Classic native scene; fixed V1 mapping order in plan.md |
| Table assignment (future #800) | canonical authoritative tableId → resolvedThemeId | Non-empty string, reject whitespace/control characters; no identity/seat/hand input. FNV-1a unsigned hash modulo fixed six. Immutable table ID means immutable assigned ID for table lifetime |
| Apply request (future #800) | resolvedTableId, resolvedThemeId, generation in memory | Resolve once per accepted table identity, idempotent on snapshots; full preload applies atomically only if generation/table still match. Missing art → readable Classic, no different assignment |
| Daily concept | Day 1 completed, Day 2 current, Days 3–4 upcoming, all EXAMPLE STATE | No amount/timestamp or state transition; disabled claim, Not configured availability |
| Future daily status (#1079) | existing campaign code/title/claimPolicy/amount/eligible/alreadyClaimed/reason; approved history/timing contract later | GET omits claimed entries; absence cannot imply completed days or countdown. Independent economic/status approval |

Prototype state consists only of carousel position and open dialog. No theme assignment is executed here. New table may hash to the same or a different theme; fairness/economic randomness is not implied. V1 list/hash cannot be reordered or extended while retaining lifetime stability. Event precedence/weekly transitions are future #1075 design.

## Implementation authorization — 2026-10-10 (#1069 after merged #1078)
Owner explicitly requests T009–T015 on current main c4f26e4c. Reuse approved V3 art and portrait/landscape composition; no redesign. The earlier design-only restrictions describe historical #1078 and do not block this focused implementation. #800/#1079 and future playable modes remain excluded.

`poker/index.html`, `poker/poker.css`, `poker/poker.js:initLobby()` retain one controller, existing IDs, auth/guest/topbar/sidebar, Online Tables/Create/Join/Refresh and Progress Roadmap. Promote approved art to `poker/assets/lobby/`. Daily Bonus is honestly Coming Soon, with no sample account history, reward or claim. Remove Poker lobby AdSense only; preserve consent.

`renderProgression()` renders at most two actual `availableBuyIns`, defaults to highest on first view, retains a still-available explicit choice, resets safely on availability/account changes; one option is a label. `quickSeat()` sends optional numeric `buyIn` plus existing `maxPlayers`, keeps loading/error gates and navigates with existing `autoJoin=1`. `rejoinableTableIds` enables Resume Game regardless of tier availability; server always rechecks active seat first. Failed progression clears playable choices.

`netlify/functions/poker-quick-seat.mjs:handler()` validates a supplied positive safe integer `buyIn` (400 invalid_buy_in), then after resume-first and fresh progression/class validation restricts `selectCandidate()` to that exact available tier and `createAndRecommend()` to the same buy-in. Fresh unavailable selection returns existing 409 buy_in_tier_locked with bankroll metadata. Omitted property preserves legacy matching/default Create. Existing advisory lock order, canonical stakes, WS capability check, transactional table caps, authoritative JOIN funding, anti-farming and pool rules remain. No debit/seat write in Quick Seat.

Readiness: `ws-server/poker/handlers/join.mjs:handleJoinCommand()` already calls `tableManager.bootstrapHand()` after validated/funded JOIN and runtime membership; changed state is persisted with expected version, then broadcast and bot scheduling. Guest JOIN in `ws-server/server.mjs` already bootstraps. `bootstrapHand()` uses eligible human/member/readiness gates and returns unchanged for live/settlement/waiting states. Reuse this mechanism; no `autoStart` consumer, new client command, WS/protocol change or WS deployment. If runtime smoke demonstrates a gap, propose a separate readiness change for approval rather than forcing a hand.

Constitution Check: fundamental deterministic backend tests only in existing `tests/poker-quick-seat.behavior.test.mjs`: exact-tier match/create/mismatch fallback, fresh tier/class policy, resume/no debit and legacy defaults/capability/caps. Presentation uses temporary browser smoke; no new UI suite/dependencies/config/ignore cleanup. JSP IIFE/global JS, physical one-line CSS rules, klog and existing CSP; no added inline script or hash required. No migrations, Stage configuration/campaign changes, Production deploy or merge. Preview gameplay smoke may use existing isolated guest runtime only.

Breaking impact: optional API property is additive; supplied malformed values now fail 400. Exact-tier calls cannot silently switch tiers; legacy omitted calls unchanged. DOM relocation/CSS are scoped to lobby body and preserve IDs/handlers; ad removal intentional. No economy, DB or WS/protocol breaking change. Authenticated runtime verification requires a test account; do not invent credentials or use Production.
