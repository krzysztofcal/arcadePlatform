# T001–T002 review handoff — STOP

Subsequent authorized WS verification: [deployment/smoke/CodeQL report](ws-verification.md). CodeQL neutral has since resolved to success; human Online smoke stopped at joined-snapshot timeout, so runtime regression risk remains open.

Draft PR: https://github.com/krzysztofcal/arcadePlatform/pull/1147

Verified runtime SHA: **ddb21224d99e07dead0164bf14dcbfb52356dec4**.
Netlify deploy **6add25770b2d070b30946a10**, ready / deploy-preview / exact commit_ref confirmed through Netlify API.

- Immutable tested Preview: https://6add25770b2d070b30946a10--playkcswh.netlify.app/poker/offline/poc.html
- Latest PR Preview: https://deploy-preview-1147--playkcswh.netlify.app/poker/offline/poc.html
- [Browser network/state evidence](evidence/preview-offline-hand.json)
- [V2 showdown screenshot](evidence/preview-showdown.png)

## What actually runs from common sources

- `ws-server/poker/engine/poker-engine.mjs::buildBootstrappedPokerState`: deal, blinds, initial turn/stacks.
- `ws-server/poker/shared/poker-primitives.mjs::deriveDeck`, `computeSharedLegalActions`: identical SHA-seeded shuffle and legality. Browser-only crypto adapter precomputes SHA-256 via Web Crypto; rules remain untouched.
- `ws-server/poker/shared/poker-action-reducer.mjs::applyAction`: betting and street/turn progression, settlement trigger.
- `ws-server/poker/shared/settlement/{poker-materialize-showdown,poker-showdown,poker-payout,poker-side-pots,poker-eval,poker-state-utils}.mjs`: evaluation/payout/side pots. No copied reducer or payout engine.
- `ws-server/poker/shared/poker-bot-strategy.mjs::{chooseBotActionProfiled,enrichBotLegalActions}`: existing accepted adapter block moved byte-for-byte, including TIGHT/NORMAL/LOOSE thresholds and diagnostics. Both WS and Offline import it. Netlify legacy bot implementation is not the PoC strategy.
- `ws-server/poker/read-model/room-core-snapshot.mjs::projectRoomCoreSnapshot`: actual WS presentation projection including showdown reveals, private human cards, legal amounts.
- `poker/table-v2.html`, `poker/poker-v2.js::{mergeSnapshot,render,resolveTableThemeId,applyTableTheme}` and existing CSS/art: generated isolated DOM/renderer, no separately maintained table implementation. Generator changes explicit init/transport/logging/HUD function bodies, removes queued preactions for the spike and changes completed-hand copy. Original Online HTML/renderer are unchanged.

## Browser proof

2026-10-24, Chromium headless through Playwright (temporary diagnostic, no maintained UI test suite). Fresh context, no login/account. Instrumented `fetch`, WebSocket constructor, XHR `open`, and `sendBeacon` before navigation without blocking/replacing their behavior. Recorded all browser request and WebSocket events. Loaded immutable Netlify Preview, waited for network idle and initialized state, then `browserContext.setOffline(true)`. Clicked the existing V2 Call/Check button through real bot decisions, showdown and payout. Screenshot taken while offline; restored network and observed another second. No request routes/mocked game state/mock transport/local WS server used. PoC script itself contains no networking. Scoped hash/SRI CSP additionally blocks all connections, frames and Netlify-injected review toolbar, without changing global Online headers.

Result: board **8C 2C JC 6S 9D**, human **2D 9H** wins with two pair (nines and twos). Payout **12 PC**; stacks **108 / 96 / 96**, pot **0**, conserved **300 PC**. Bots visibly reveal compared cards through the canonical WS projection. Invalid RAISE amount 0 rejected with `invalid_amount`; inspected state/history unchanged.

| Network phase/transport | Observed |
| --- | --- |
| Initial load | 53 same-origin static requests: 1 HTML, 1 CSS, 2 JS, 49 images (chips, scene, Emerald Palace theme, bot avatars) |
| Disconnected play through settlement | 0 requests |
| Restored connectivity observation | 0 requests |
| WebSocket creations/connections | 0 |
| fetch / XHR / beacon attempts, including initial load | 0 / 0 / 0 |
| Supabase / Auth / Netlify API / external asset requests | 0 |
| JS page errors / HTTP responses >=400 | 0 / 0 |

The complete URL list and action history are in the JSON. Final fresh ID selected Emerald Palace; earlier Preview runs exercised Classic and Neon Vegas. All six existing themes remain selected by the unchanged hash/catalog. This does not establish all-theme Android packaging, cold browser offline startup, Resume or complete-session acceptance.

## Verification

- Existing accepted-bot-adapter tests + one new focused shared strategy case: **39/39 PASS**. Case: NORMAL + AA + injected roll 0.2 selects legal RAISE to 8. No broad new test infrastructure.
- Existing engine/bootstrap/action/rollover/timeout and shared legality/reducer tests: **79/79 PASS**.
- Existing shared snapshot projector tests: **20/20 PASS**.
- CSP guard, generated JS syntax, whitespace check and rebuilding artifacts without diff: PASS.
- Independent source review: preaction issue found and resolved by omitting queue UI in this spike; final review found no further concrete correctness/privacy/Online regression issues. This is not live WS runtime verification.

## CI caveat at handoff

CodeQL reported two high alerts against regex-based script removal in the build generator (incomplete removal/case handling). The generator now removes the supported checked-in single-line script format and rejects remaining script markup, rather than using an HTML-sanitization regex; regenerated browser artifacts are byte-identical. After the fix, the CodeQL check is **neutral**, reporting missing default JavaScript/TypeScript configuration relative to main, not a clean full security scan. The available token cannot list branch code-scanning alerts (403). This is an unresolved CI verification limitation; do not call the PR fully green or merge-ready. CI configuration was not changed to silence it. Existing runtime SHA 453e8991 had passing CI, Tests, WS PR Checks and WS Server Deploy validation; none of those deploys WS on PR events.

## Risks and recommendation

Architecture is feasible without a major rewrite of Online. Recommend the common-source approach for T003–T008 **only after owner review and separate explicit GO**; resolve the CodeQL verification caveat and WS runtime gate before asserting Online safety/merge readiness. They remain unstarted. The spike does not implement a wallet, durable sessions, next-hand/leave/rebuy lifecycle, lobby, local reactions, audio, Android release packaging or PWA/service worker. Full session serialization and crash consistency still need design/implementation in the authorized later slices.

Moderate Online risk: moving strategy functions changes WS module imports even though their bodies are byte-identical. Online reducer/protocol/ledger/renderer are unchanged. Browser-generated artifacts must be rebuilt when their canonical sources change; the small crypto adapter supports prepared SHA seed reads only, not arbitrary Node crypto. Web Crypto requires a secure context. Generated bundle is approximately 105 KB plus 356 KB renderer before compression; this is not an AAB size/performance measurement.

**Not merge-ready. WS runtime verification pending.** No WS/Production deployment, migration or financial operation performed. Before merge, exact runtime SHA must pass manual `WS Preview Deploy` (workflow definition `main`, application `ref=ddb21224d99e07dead0164bf14dcbfb52356dec4`) and relevant Online/Single Player smoke from Deploy Preview to WS Preview. Green Netlify/CI validates neither deployed WS revision nor runtime behavior. Later runtime/artifact/config changes require a new exact-SHA deploy; evidence-only docs commits do not invalidate a verified runtime per agents.md. This task has no authorization for WS deployment; request it separately if required before further work.

No merge. STOP for owner review.
