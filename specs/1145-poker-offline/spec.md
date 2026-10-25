# Current scope: T001–T008 implemented; review-ready, physical Android acceptance pending

The T002 boundary below is historical. The approved continuation at the end supersedes its stop/non-goals.

# #1145 — T001/T002 bounded Offline spike

Baseline: origin/main 6ecbc8a3; read agents.md, skills.md and full issue including owner amendments on 2026-10-24.

Deliver one browser hand: human + two bots, accepted rules, legal V2 controls, showdown and payout. Reuse V2 DOM/theme/renderer and WS strategy source. Independent generated entrypoint; no WS/Auth/Supabase/API bootstrap, telemetry or storage. Disconnect after asset load and prove no attempted remote transport during play and after reconnect. No wallet, persistence, lobby, reactions, audio, Android release, PWA/service worker, migration, WS or Production deployment. Stop for owner review after T002.

Acceptance: real reducer accepts each action; at least one hand reaches five-card showdown and settlement; chips conserved; one focused deterministic shared-strategy test; browser network evidence and Draft PR/Deploy Preview. A fold ending is legal but insufficient for showdown evidence.

## Architecture preflight
- `ws-server/server.mjs::loadAcceptedBotAutoplayExecutor` loads `runtime/accepted-bot-autoplay-adapter.mjs::createAcceptedBotStepExecutor (Autoplay alias)`. Human `handleActCommand` → `table/table-manager.mjs::applyAction` uses `engine/poker-engine.mjs::applyCoreStateAction` → `shared/poker-action-reducer.mjs::applyAction`; accepted bot adapter also calls that reducer. Legacy snapshot-runtime remains a conditional compatibility path; do not use it as Offline rules.
- `engine/poker-engine.mjs::buildBootstrappedPokerState` supplies deal/blinds. `shared/poker-primitives.mjs::deriveDeck` uses synchronous node:crypto SHA-256 then xorshift shuffle; `computeSharedLegalActions` is canonical legality.
- Reducer settlement calls `shared/settlement/poker-materialize-showdown.mjs::materializeShowdownAndPayout`, `poker-showdown.mjs::computeShowdown`, `poker-payout.mjs::awardPotsAtShowdown`, evaluator and side pots. Pure modules, no DB needed.
- Actual accepted bot strategy: adapter's `chooseBotActionProfiled`, `enrichBotLegalActions`, strength thresholds TIGHT/NORMAL/LOOSE. `netlify/functions/_shared/poker-bots.mjs` is related legacy logic, not the chosen WS strategy dependency. Move existing pure block without algorithm changes; WS imports same exported functions as browser.
- Node boundary: primitives crypto hash; engine has createHash/Buffer for other operations. Bundle only bootstrap and reducer; browser crypto adapter precomputes the exact hand-seed digest with Web Crypto before synchronous deal. No replacement poker logic or changed WS shuffle. No embedded WS runtime or persistence/admission code.
- V2 `mergeSnapshot(payload, frame)` consumes table/seats/stacks, hand status/id/dealer, turn, pot, board, private hole cards, legal actions/constraints, showdown/handSettlement. `render()` draws existing table. `handleAction` → `sendCommand` is transport seam; `init` normally initializes auth/live clients. Reuse `read-model/room-core-snapshot.mjs::projectRoomCoreSnapshot` for the real WS projection, including revealed compared hands; add only table/version envelope. Generate isolated renderer from same source with explicit PoC seams, leaving Online source untouched.
- `poker/index.html`/`poker.js` are online lobby/routing: no changes in this slice. `mobile/poker/package-web.mjs` (#1139) packages online pages and recursively poker/assets; no packaging changes now. Themes: fresh local UUID, existing resolveTableThemeId/applyTableTheme; no persistence until separately authorized T003.

## Risk / stop criterion
Moderate WS regression risk from moving strategy functions (import/source-sensitive tests); rules and protocol unchanged. Netlify green is not WS runtime evidence. Exact latest runtime SHA requires manual WS Preview Deploy using workflow definition main and application ref SHA plus relevant Online/Single Player smoke before merge readiness. No WS deploy in T001/T002. Stop if this needs a major Online engine rewrite; current pure imports permit bounded extraction.

## Approved continuation — T003–T008 (2026-10-25)

Owner authorizes completing the existing PR, superseding the T002 stop/non-goals above. Merge current main without rewriting history; preserve #1149 one-step FIFO fairness, #1151 authoritative Leave/recovery, #1153 system-owner guard and common strategy. No World Tour/Seasons/PWA/service worker, migrations, remote financial operations, Production or PR merge.

Local session uses canonical bootstrap/rollover/reducer/settlement/legality and shared NORMAL strategy. Start5000 PC, fixed100/500/1000 PC buy-ins, free refill to at least5000. One versioned localStorage record `arcade.poker.offline.v1` atomically stores wallet/session/revision; synchronous read-modify-write and revision check across asynchronous deal prevent stale writes. Storage errors fail closed, no online fallback. Reset explicitly discards only local practice. Bots replenish only when broke between hands; this is explicit local play funding, never CH. Human Leave folds/resolves current hand canonically before refunding stack once. Reload resumes each committed action; next-hand button advances dealer via canonical rollover. No automatic human timeout fold in Offline.

Existing lobby is shared; its independent Offline card needs neither login nor successful online bootstrap. Isolated generated play.html excludes all online/auth/log/analytics scripts and blocks connections/frames/forms with CSP. Reuse V2 renderer source/controls/themes/animations/social catalog, hide paid gifts and online wallet. Fresh local tableId for New Game; persisted ID/theme for Resume. Practice never enters shared profile, CH cache, telemetry or sync, even after reconnect. Audio remains separate #1146; no new audio engine.

Acceptance: deterministic fundamental sessions, legality/conservation, atomic failure/concurrency, Resume/idempotent Leave, output privacy; relevant existing WS tests/parity. Netlify disconnected after load through real controls and restored-network silence. Package same assets for Android cold airplane launch. Physical device acceptance pending if no device; implementation review-ready does not imply merge-ready without required exact-SHA WS evidence and device acceptance.

## Review clarification — Back versus Leave

Normal Back to lobby, including native Android Back, parks the committed local session unchanged for Resume; it does not invoke Leave or cashout. Only explicit Leave settles/refunds/closes it. Reuse V2 bindMenu/settings through the generator; no Online menu/transport changes.
