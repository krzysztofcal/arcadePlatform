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

## T013–T014 minimal continuation

- `offline-game.mjs::stampClock` always stamps20s live turn and separately stores botDueAt/botRemainingMs. `pendingTimer` selects the earlier decision/deadline; `tick` first consults canonical decideTurnTimeout, then permits strategy only for a due bot decision before timeout. `pause/resume` persist/rebase both budgets; legacy short clocks upgrade in place.
- New Game imports only existing pure computeTargetBotCount; persist member roster. `core/read/newGame/nextHand/snapshot` use that roster for deal seed count, stacks, seats and maxSeats. Browser reaction actor/bot seats derive from persisted members. No shared module edits/WS Preview replay.
- Fundamental20s+delay/late-timeout/pause/idempotence tests plus3–6 player showdown/conservation/Resume/Leave. One focused Netlify smoke validates actual20s bot indicator, early strategy timing, roster/Resume/auto-next/PC and network isolation; build current Stage APK and retain Draft for owner.

## T015–T016 integration

1. Generator no longer removes V2 preaction wrappers. After mergeSnapshot, reset queue if handId changed, call existing maybeExecuteQueuedPreaction only while local coordinator active, then render. This matches Online snapshot ordering; canonical projection already includes projectedLegalActions. No Online renderer/WS modifications.
2. `browser-entry.mjs::start` accepts local pause callback; park/Leave clear renderer queue, act captures lifecycle epoch plus rendered token. Renderer readiness reads coordinator active state, not an Auth token or fabricated login. Existing local participant identity and canonical legality stay authoritative.
3. Existing lobby quick-tier buttons with aria-pressed and shared tile-action/quick-resume-shell replace radios. Rename visible text/errors to Offline Chips, retain PC/v1 technical storage. Remove redundant Offline-only button/balance CSS; secondary tools inherit existing Poker button typography. Keep isolated hashed CSP/SRI and absence of remote bootstraps.
4. Two fundamental intent tests load existing V2 queue rules without DOM framework: wait/legal exactly-once, changed legality invalidation, stale manual/timer token, pause/Resume/reset. Existing targeted preaction tests reused. One Preview portrait/landscape smoke and visual comparison to original Online renderer/lobby; current-SHA Stage APK, retain Draft for owner. No WS Preview rerun with shared runtime unchanged.
