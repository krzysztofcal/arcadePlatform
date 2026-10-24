# T001–T002 review handoff — STOP

Draft PR: https://github.com/krzysztofcal/arcadePlatform/pull/1147

Verified runtime SHA: **453e89910c8d34bd02ca7dd2925512d1c555a3fd**.
Netlify deploy **6add24ba621945a5e4d143aa**, ready / deploy-preview / exact commit_ref confirmed through Netlify API.

- Immutable tested Preview: https://6add24ba621945a5e4d143aa--playkcswh.netlify.app/poker/offline/poc.html
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

Result: board **3S KH 2D KC 6D**, human **KS AC** wins with three kings. Payout **24 PC**; stacks **116 / 92 / 92**, pot **0**, conserved **300 PC**. Bots visibly reveal compared cards through the canonical WS projection. Invalid RAISE amount 0 rejected with `invalid_amount`; inspected state/history unchanged.

| Network phase/transport | Observed |
| --- | --- |
| Initial load | 46 same-origin static requests: 1 HTML, 1 CSS, 2 JS, 42 images (chips, scene, bot avatars) |
| Disconnected play through settlement | 0 requests |
| Restored connectivity observation | 0 requests |
| WebSocket creations/connections | 0 |
| fetch / XHR / beacon attempts, including initial load | 0 / 0 / 0 |
| Supabase / Auth / Netlify API / external asset requests | 0 |
| JS page errors / HTTP responses >=400 | 0 / 0 |

The complete URL list and action history are in the JSON. Final fresh ID selected Classic; an earlier Preview run exercised Neon Vegas. All six existing themes remain selected by the unchanged hash/catalog. This does not establish all-theme Android packaging, cold browser offline startup, Resume or complete-session acceptance.

## Verification

- Existing accepted-bot-adapter tests + one new focused shared strategy case: **39/39 PASS**. Case: NORMAL + AA + injected roll 0.2 selects legal RAISE to 8. No broad new test infrastructure.
- Existing engine/bootstrap/action/rollover/timeout and shared legality/reducer tests: **79/79 PASS**.
- Existing shared snapshot projector tests: **20/20 PASS**.
- CSP guard, generated JS syntax, whitespace check and rebuilding artifacts without diff: PASS.
- Independent source review: preaction issue found and resolved by omitting queue UI in this spike; final review found no further concrete correctness/privacy/Online regression issues. This is not live WS runtime verification.

## Risks and recommendation

Architecture is feasible without a major rewrite of Online. Recommend proceeding to T003–T008 **only after owner review and separate explicit GO**. They remain unstarted. The spike does not implement a wallet, durable sessions, next-hand/leave/rebuy lifecycle, lobby, local reactions, audio, Android release packaging or PWA/service worker. Full session serialization and crash consistency still need design/implementation in the authorized later slices.

Moderate Online risk: moving strategy functions changes WS module imports even though their bodies are byte-identical. Online reducer/protocol/ledger/renderer are unchanged. Browser-generated artifacts must be rebuilt when their canonical sources change; the small crypto adapter supports prepared SHA seed reads only, not arbitrary Node crypto. Web Crypto requires a secure context. Generated bundle is approximately 105 KB plus 356 KB renderer before compression; this is not an AAB size/performance measurement.

**Not merge-ready. WS runtime verification pending.** No WS/Production deployment, migration or financial operation performed. Before merge, exact runtime SHA must pass manual `WS Preview Deploy` (workflow definition `main`, application `ref=453e89910c8d34bd02ca7dd2925512d1c555a3fd`) and relevant Online/Single Player smoke from Deploy Preview to WS Preview. Green Netlify/CI validates neither deployed WS revision nor runtime behavior. Later runtime/artifact/config changes require a new exact-SHA deploy; evidence-only docs commits do not invalidate a verified runtime per agents.md. This task has no authorization for WS deployment; request it separately if required before further work.

No merge. STOP for owner review.
