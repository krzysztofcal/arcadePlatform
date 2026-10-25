# Current execution: T003–T008 continuation below

The original PoC plan is retained as architectural history; its stop is superseded by owner GO.

# Plan — T001/T002 only

1. Move pure strategy block from `ws-server/poker/runtime/accepted-bot-autoplay-adapter.mjs` into `ws-server/poker/shared/poker-bot-strategy.mjs`; keep WS adapter imports and semantics.
2. `poker/offline/offline-game.mjs`: call existing `buildBootstrappedPokerState`, `computeSharedLegalActions`, `applyAction`, shared `chooseBotActionProfiled`/`enrichBotLegalActions`; single-hand coordinator; reuse `ws-server/poker/read-model/room-core-snapshot.mjs::projectRoomCoreSnapshot` (including compared-hand reveals) with a small table/version envelope only. Inject bot RNG; local crypto seed, no wallet/storage/HTTP.
3. `poker/offline/browser-crypto.mjs`: prehash hand seed using Web Crypto and expose only SHA digest readUInt32BE needed by unchanged deriveDeck; fail on unprepared seed/unsupported operation.
4. `scripts/build-poker-offline-poc.mjs`: pinned esbuild dev dependency, IIFE bundle; generate HTML from `poker/table-v2.html` removing online scripts/external fonts and renderer from `poker/poker-v2.js` with AST-located init/transport/local logging/HUD seams. Produce isolated generated artifacts; no browser ESM imports, no maintained engine/DOM copy. Scope a hash-based CSP to this page (two scripts with SRI, connect/frame/form blocked); this also blocks hosting-injected Preview toolbar. Remove queued preaction labels from PoC because session serialization is deferred; manual V2 actions remain. Build checked artifacts before push; regenerate comparison proves freshness.
5. One deterministic strategy test in existing accepted-adapter behavior test; run existing accepted adapter, engine/reducer/settlement tests. Temporary Playwright probe only (no maintained UI suite): Preview load, wait for assets, disconnect, use real buttons to showdown; capture requests/WebSocket/transport attempts, result, screenshot; reconnect and recheck.
6. Draft PR + Netlify Deploy Preview via normal PR build; report SHA/results/limits. No WS/Production deployment, migrations or merge. T003–T008 blocked on separate owner GO.

Generated PoC has no auth bootstrap, chips client, remote telemetry, APIs or online wallet; disabled non-PoC menu/social controls. No config/tool cleanup outside exact esbuild build requirement. No financial Stage effects.

## T003–T008 continuation (owner approved)

1. `poker/offline/offline-game.mjs::createOfflineGame` owns synchronous atomic record transactions and async revision-checked deal; uses canonical `buildNextHandStateFromSettled`, reducer and existing projector. No persistence service/ledger abstraction.
2. `poker/offline/browser-entry.mjs` bundles global `PokerOffline` and independently binds existing lobby card/Next/rebuy/refill/Leave. One timer advances one bot per persisted action. Existing shared reaction classifiers feed V2 `handleTableReaction`, with local cooldown/history. Storage-event resync rereads current committed state.
3. Extend existing `scripts/build-poker-offline-poc.mjs` generator seams for full local session transport, local Leave, reactions, wallet isolation and silent local diagnostics; generate play.html plus shared-source IIFEs and SHA/SRI CSP. Keep Online renderer unchanged, source remains single V2 DOM/renderer. No preaction transport emulation; manual canonical controls only.
4. `poker/index.html`/`poker.js` third working card; separate PC labels and fixed buy-in radios, Resume, free refill and explicit local reset. Remove Coming Soon modes. Generic lobby online behavior remains independent; no offline data sent to it.
5. `mobile/poker/package-web.mjs` includes generated isolated play page without online/native-auth bootstrap, bundles scripts/CSS/all theme assets; packaging preserves CSP/SRI. Existing Stage Android shell configuration remains Stage; this work does not claim signed Production Play release. Build artifact and record exact SHA/hash; no device means physical cold-airplane gate pending owner.
6. `tests/poker-offline.test.mjs` fundamental domain/storage cases and existing accepted-adapter/settlement/Leave tests. Temporary Playwright (outside repo) only for actual Preview verification, not a maintained UI suite. Exact-SHA WS Preview gate still applies to initial strategy extraction; do not repeat already accepted broad #1149/#1151 smoke. No Stage gameplay/DB writes unless separately authorized.

## T009–T012 owner review execution

1. Generator keeps table-v2 DOM as the only full viewport child; `syncAccountHud` projects PC, menu owns local controls, shared bust panel handles local rebuy/refill. Native `configure-android.mjs` recognizes Offline as existing table mode; `package-web.mjs` applies Online inset substitution and rehashes packaged isolated renderer.
2. `offline-game.mjs::stampClock/tick/pause/resume/pendingTimer/timerToken` persist local budgets, reuse shared stampTurnDeadline/decideTurnTimeout; tick validates revision and identity, stale async rollover returns false. Last-action source retained locally for review; no remote history. Reuse canonical bootstrap/rollover/reducer/strategy.
3. `browser-entry.mjs::run/schedule/activate/park` serializes lifecycle, timers, actions and wallet changes with one timer. Use rendered revision for human actions; fail-safe Leave preserves activation on failed commit. Explicit Back parks before navigation. No WS protocol emulation.
4. Existing lobby provides one confirmation fragment copied into generated table; dialog Cancel/Escape/native Back resolve false. Existing native lobby Back checks this local cancellation hook before minimizing. Remove window.confirm, preserve source CSP and packaged transformed-script SRI.
5. Fundamental timer/conservation/storage tests only. One focused Netlify smoke checks portrait/landscape Hero cards,20s timeout, bot delay,3s auto-next, menu/dialogs/Back. New Stage APK; physical layout/Rebuy/Refill/lifecycle re-test pending owner. No shared WS/runtime change, so no WS Preview repeat or Production effect.
