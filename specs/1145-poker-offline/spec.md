# #1145 — T001/T002 bounded Offline spike

Baseline: origin/main 6ecbc8a3; read agents.md, skills.md and full issue including owner amendments on 2026-10-24.

Deliver one browser hand: human + two bots, accepted rules, legal V2 controls, showdown and payout. Reuse V2 DOM/theme/renderer and WS strategy source. Independent generated entrypoint; no WS/Auth/Supabase/API bootstrap, telemetry or storage. Disconnect after asset load and prove no attempted remote transport during play and after reconnect. No wallet, persistence, lobby, reactions, audio, Android release, PWA/service worker, migration, WS or Production deployment. Stop for owner review after T002.

Acceptance: real reducer accepts each action; at least one hand reaches five-card showdown and settlement; chips conserved; one focused deterministic shared-strategy test; browser network evidence and Draft PR/Deploy Preview. A fold ending is legal but insufficient for showdown evidence.

## Architecture preflight
- `ws-server/server.mjs::loadAcceptedBotAutoplayExecutor` loads `runtime/accepted-bot-autoplay-adapter.mjs::createAcceptedBotAutoplayExecutor`. Human engine path uses `engine/poker-engine.mjs::applyCoreStateAction` → `shared/poker-action-reducer.mjs::applyAction`; accepted bot adapter also calls that reducer. Legacy snapshot-runtime remains a conditional compatibility path; do not use it as Offline rules.
- `engine/poker-engine.mjs::buildBootstrappedPokerState` supplies deal/blinds. `shared/poker-primitives.mjs::deriveDeck` uses synchronous node:crypto SHA-256 then xorshift shuffle; `computeSharedLegalActions` is canonical legality.
- Reducer settlement calls `shared/settlement/poker-materialize-showdown.mjs::materializeShowdownAndPayout`, `poker-showdown.mjs::computeShowdown`, `poker-payout.mjs::awardPotsAtShowdown`, evaluator and side pots. Pure modules, no DB needed.
- Actual accepted bot strategy: adapter's `chooseBotActionProfiled`, `enrichBotLegalActions`, strength thresholds TIGHT/NORMAL/LOOSE. `netlify/functions/_shared/poker-bots.mjs` is related legacy logic, not the chosen WS strategy dependency. Move existing pure block without algorithm changes; WS imports same exported functions as browser.
- Node boundary: primitives crypto hash; engine has createHash/Buffer for other operations. Bundle only bootstrap and reducer; browser crypto adapter precomputes the exact hand-seed digest with Web Crypto before synchronous deal. No replacement poker logic or changed WS shuffle. No embedded WS runtime or persistence/admission code.
- V2 `mergeSnapshot(payload, frame)` consumes table/seats/stacks, hand status/id/dealer, turn, pot, board, private hole cards, legal actions/constraints, showdown/handSettlement. `render()` draws existing table. `handleAction` → `sendCommand` is transport seam; `init` normally initializes auth/live clients. Generate isolated renderer from same source with explicit PoC seams, leaving Online source untouched.
- `poker/index.html`/`poker.js` are online lobby/routing: no changes in this slice. `mobile/poker/package-web.mjs` (#1139) packages online pages and recursively poker/assets; no packaging changes now. Themes: fresh local UUID, existing resolveTableThemeId/applyTableTheme; no persistence until separately authorized T003.

## Risk / stop criterion
Moderate WS regression risk from moving strategy functions (import/source-sensitive tests); rules and protocol unchanged. Netlify green is not WS runtime evidence. Exact latest runtime SHA requires manual WS Preview Deploy using workflow definition main and application ref SHA plus relevant Online/Single Player smoke before merge readiness. No WS deploy in T001/T002. Stop if this needs a major Online engine rewrite; current pure imports permit bounded extraction.
