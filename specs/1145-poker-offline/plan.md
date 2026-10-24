# Plan — T001/T002 only

1. Move pure strategy block from `ws-server/poker/runtime/accepted-bot-autoplay-adapter.mjs` into `ws-server/poker/shared/poker-bot-strategy.mjs`; keep WS adapter imports and semantics.
2. `poker/offline/offline-game.mjs`: call existing `buildBootstrappedPokerState`, `computeSharedLegalActions`, `applyAction`, shared `chooseBotActionProfiled`/`enrichBotLegalActions`; single-hand coordinator and snapshot adapter only. Inject bot RNG; local crypto seed, no wallet/storage/HTTP.
3. `poker/offline/browser-crypto.mjs`: prehash hand seed using Web Crypto and expose only SHA digest readUInt32BE needed by unchanged deriveDeck; fail on unprepared seed/unsupported operation.
4. `scripts/build-poker-offline-poc.mjs`: pinned esbuild dev dependency, IIFE bundle; generate HTML from `poker/table-v2.html` removing online scripts/external fonts and renderer from `poker/poker-v2.js` with AST-located init/transport/local logging/HUD seams. Produce isolated generated artifacts; no browser ESM imports, no maintained engine/DOM copy. Build checked artifacts before push; regenerate comparison proves freshness.
5. One deterministic strategy test in existing accepted-adapter behavior test; run existing accepted adapter, engine/reducer/settlement tests. Temporary Playwright probe only (no maintained UI suite): Preview load, wait for assets, disconnect, use real buttons to showdown; capture requests/WebSocket/transport attempts, result, screenshot; reconnect and recheck.
6. Draft PR + Netlify Deploy Preview via normal PR build; report SHA/results/limits. No WS/Production deployment, migrations or merge. T003–T008 blocked on separate owner GO.

Generated PoC has no auth bootstrap, chips client, remote telemetry, APIs or online wallet; disabled non-PoC menu/social controls. No config/tool cleanup outside exact esbuild build requirement. No financial Stage effects.
