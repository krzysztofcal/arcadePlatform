# T009–T012 physical review changes — implementation awaiting focused Preview and new APK

Owner Galaxy S24+ PASS: cold Offline gameplay, several full hands, human actions, Resume, Leave. Rebuy/Refill physically NOT VERIFIED. Prior browser layout acceptance did not establish correct physical framing; clipping reported by owner is addressed by removing the extra banner and sharing Online viewport/inset ownership. Physical layout acceptance remains pending re-test.

Current changes: PC in existing HUD; rebuy/refill in menu/shared bust panel; automatic3s canonical rollover; Hero20s canonical CHECK/FOLD timeout; random1–2s bot turns, shared avatar clocks; durable token-guarded timer/action writes, local pause budgets and backward-compatible v1 initialization; local dialogs replace system confirm. Online renderer/CSS, shared WS rules/strategy and finance unchanged. Android initializer merely adds Offline to existing table-mode path and same inset substitutions; package rehashes modified renderer CSP/SRI. No new renderer/framework/runtime/config/dependency.

Fundamental14/14PASS (Offline8,mobile3,shared timeout3), including simultaneous rollover callbacks, FOLD/CHECK, stale timer rejection, pause/old v1 resume, bust/rebuy and write failure. Temporary412×915/915×412 probe: scene starts at0 and fits viewport, both Hero cards within bounds, active avatar clock present. No maintained layout suite. Independent review found stale rendered-action token and failed-Leave deactivation gaps; both addressed in local controller. Runtime Preview/actual APK results will be linked in PR after build; physical re-test still required. No WS Preview replay: shared runtime unchanged.

---
## Earlier owner review and implementation history

# Owner review follow-up — menu and Back semantics (2026-10-25)

REQUEST CHANGES addressed in the existing Draft PR. Generator calls the **same V2 `bindMenu()`**, with only its nested destination-link seam routed to local `PokerOffline.backToLobby()`. The shared Online renderer is unchanged. Back to lobby and native App `backButton` clear the local bot timer and navigate **without Leave/cashout/session mutation**; Resume retains the committed hand/tableId/theme. Bot scheduling now requires the table snapshot listener so lobby visibility/storage events cannot advance a parked session. Explicit menu Leave (with existing confirmation) and explicit session Leave still resolve/refund/remove session through the existing local path. No auth/WS/gifts/CH path activated.

Local Offline header was intercepting the fixed hamburger: scoped CSS lowers only the header layer below V2 menu/settings and reserves left padding for the hamburger. One-line selector formatting preserved; no Online/global CSS changes.

Temporary Playwright probe (outside repo): hamburger→Table settings→toggle reaction-bubbles option→Back→Resume→native Back callback→Resume→explicit menu Leave PASS. Back snapshots including wallet/revision/session match exactly; explicit Leave closes session and restores5000PC in the fresh100PC test. JS errors0. Native bridge callback was a browser probe, **not physical Android acceptance**. No new maintained UI test. Fundamental Offline+mobile security7/7PASS; syntax229files, CSP and SHA/SRI verification PASS. Generated artifacts rebuild deterministically. No `ws-server/**`/`shared/**`/online protocol/configuration changes, so no WS Preview replay; prior shared-WS proof354af80c retained.

Build the Stage debug APK from this exact PR HEAD via the existing Android Poker M0 APK workflow. Artifact/run, exact SHA and SHA256 are linked in the PR and owner handoff once complete. No further docs-only commit is needed after that build. Still Draft, no merge/Production; **await owner physical device test**.

Physical checklist: install Stage debug APK (a different ephemeral debug signature may require uninstall; uninstall loses local data). For cold-start verification clear only Stage app data, enable airplane mode before launching, and do not log in. Existing lobby→Offline→New Game;100/500/1000PC, legal actions/showdown/next hands, refill/rebuy. Back returns to lobby with Resume and no cashout; explicit Leave refunds once and removes Resume. Kill process during a session and Resume; test Android Back, background/foreground and rotation. Fresh tableID chooses existing theme, Resume keeps it. Restore internet and confirm Offline remains local with no CH/XP/gifts/sync. This is not authorization for Online funded play or real Account Deletion.

---
## Previous implementation evidence (retained)

# T003–T008 — implementation ready for review; physical Android gate pending

2026-10-25 continuation in **existing Draft PR #1147**, branch `feat/1145-offline-poc`. Owner GO supersedes historical T002 stop. No merge/Production/migration/manual finance or Offline/Online currency synchronization.

## Result and runtime

- Main `892661f44f4e9fdbe3df24f0553fa1191bf1752e` merged preserving history (`2af27654`); only conflict was adjacent adapter tests, retaining both strategy and FIFO fairness cases. No force push/new PR.
- Final tested runtime/artifacts **`354af80c0a93d927fb8cf6f827fa77ffad81988c`**. Later evidence/spec commits contain no runtime/configuration change.
- [Immutable Netlify Preview](https://6ade3e5b7840a0c0a03e244f--playkcswh.netlify.app/poker/) / [isolated table](https://6ade3e5b7840a0c0a03e244f--playkcswh.netlify.app/poker/offline/play.html). Netlify API: ready, deploy-preview, exact commit_ref354af80c. Current route is play.html; historical poc.html links refer to the immutable PoC build.
- [Exact-SHA WS Preview Deploy](https://github.com/krzysztofcal/arcadePlatform/actions/runs/40217453669): workflow from main, application354af80c, SUCCESS. Installed release metadata preview/exactSHA, PID328965 restarted17:39:35UTC, local/public healthzOK. Adapter SHA256 `ea11185645e0ee557adbccb9d22c0b391f007e3241ae166336170154481903ea`; strategy `8e924c2c24d293b3355b753c26f8143b0f9f8eba4190e38e6a2d4320e9a076ec`, source/deployed match.

## Implemented

`offline-game.mjs::createOfflineGame` now exposes newGame/nextHand/act/botStep/rebuy/leave/refill/read/snapshot. Canonical `buildNextHandStateFromSettled` rotates dealer; bootstrap, legality, betting, showdown, side pots and settlement remain the accepted WS sources listed below. All18 moved strategy function bodies are byte-identical to current main; one focused NORMAL/AA strategy case and existing adapter tests pass. Adapter retains maxActions1/WS strict cap from #1149; server/Leave/deletion-runtime/table-manager/initializer byte-match main (#1151/#1153).

Versioned localStorage key `arcade.poker.offline.v1` holds wallet+session+revision in one atomic record: start5000PC, fixed100/500/1000, local free refill, explicit local-only reset. Each action rereads committed data; async deal checks revision; browser Web Locks serialize writers, including reset and bot ticks. Failed writes preserve prior record. Leave resolves current hand through canonical rules then credits only human stack and removes session in one commit; repeat Leave returns0. New Game on an existing session asks before settling/leaving it. Rebuy between settled hands tops human up to buy-in; broke bots replenish from local play currency only, never human wallet/CH. Next hand is explicit; hidden/background page pauses bot timer, Resume continues persisted turn without timeout-folding the human.

`browser-entry.mjs` independently binds Offline card and local controls. Existing lobby has third playable mode regardless Auth; Coming Soon World Tour/Seasons/Sit&Go tiles removed. V2 HTML/source renderer/CSS/animations/six-theme hash reused via generated isolated play.html and IIFEs; no maintained duplicate engine/table. New Game generates fresh local ID; Resume preserves ID/theme. Existing predefined reactions/history and pure contextual bot classifiers run locally, including targeted Nice hand. Gift Shop/paid gifts/online wallet hidden; no arbitrary chat. No second audio engine; **#1146 remains separately OPEN**.

Isolated table loads no auth, WS client, ChipsClient, API, analytics or remote logging scripts. Hash/SRI CSP denies connections/frames/forms, including injected Netlify toolbar. No data enters online profiles/CH/XP/cache/sync. Generic lobby online functionality remains separate; network monitoring below measures the actual isolated session, not a claim that the shared Online lobby is network-free.

## Verification

- **4 fundamental Offline tests PASS**: illegal action leaves committed bytes unchanged, pot/stack/payout conservation, multi-hand/Resume, idempotent cashout, failed write and stale async deal, refill/rebuy, corrupt/version fail-closed, public projection excludes private seed/deck/start-stack map.
- **94 relevant shared/domain/projector/adapter tests PASS**; **full npm test148 runner groups PASS**, syntax228files/CSP56documents/whitespace PASS. Initial full local run lacked existing WS package dependency; locked `ws-server npm ci` fixed environment only, no dependency/config change. Maintenance8/8 then full suite passed.
- Current runtime CI: core, ws-harness, ws-persistence-integration, account-deletion-fundamentals, CodeQL analyses, actionlint, required Netlify checks SUCCESS; expected filter SKIPPED/informational NEUTRAL only. [Tests](https://github.com/krzysztofcal/arcadePlatform/actions/runs/40217366053), [WS PR Checks](https://github.com/krzysztofcal/arcadePlatform/actions/runs/40217366025), [WS validation](https://github.com/krzysztofcal/arcadePlatform/actions/runs/40217366172).
- [Browser session/network proof](evidence/preview-session-2026-10-25.json), [settled screenshot](evidence/preview-session-settled.png): real lobby New Game, local reaction, real V2 Call/Check through five-card showdown while network disabled, Next Hand, restore internet4500ms, reload/Resume, disconnect/manual Fold/bot finish, normal local Leave, fresh New Game. **0 requests and0 fetch/XHR/WS/beacon attempts in disconnected/restored-idle/second-disconnected session phases;0 JS errors.** All transport wrappers only observed, did not mock/block actions. No direct WS commands/forced clicks. The initial lobby/navigation loads are separately recorded and may use normal online bootstrap.
- Board2C KD4H7S QD, stacks108/96/96,pot0,total300. Hand2 Resume same Classic ID `offline-0cc8b490-683e-4c5f-83ee-0c5dcb1d0876`; wallet4900 +106cashout =5006,sessionnull. Fresh ID `offline-089a42f5-e20d-4151-af3e-3d024ef15624` chooses Royal Gold, wallet4906 after new100buy-in. Earlier local diagnostic used Crimson Velvet and same-theme Resume; all six asset sets are packaged, not all visually certified on device.
- Independent code review: reset serialization race fixed before review completion; animation and targeted-reaction integration findings fixed and covered by actual final Preview smoke. No remaining critical/important finding. Earlier temporary local primary-click timeout had no captured state sufficient for attribution; harness now observes committed revision and enabled real control. Final remote scenario PASS does not retroactively label that diagnostic PASS.

## Limited WS observation (no repeated funded smoke)

Read-only preflight17:38UTC:0established WS connections,0human seats/stacks,0pending/deletion operations,0nonzero closed escrow; five OPEN bot tables each300CH =stacks+active contributions. No concurrent workflow/agent test. No environment flag/secret changes.

After exact deploy, naturally running bots produced **21 HAND_SETTLED across5tables by17:42:14UTC,0bad audits**. Sample hands: `ws_hand_fe482114-837e-4d08-aeb1-555eeb55d83a_199_3`, `ws_hand_8ce5b6f0-a3f3-4705-a319-ce6e279f0c9c_271_3`, `ws_hand_6b45940d-7343-4092-8cf6-11f5c77c921e_209_3`: integrityOK,flags[],original300 ending300,pot/stack/payout deltas0. New PID journal shows no errors. This is focused shared-strategy/bot settlement evidence, not a repeated authenticated Online/SinglePlayer/gift campaign. Existing accepted #1152 source-smoke evidence was not replayed.

## Android artifact and remaining owner acceptance

[Android APK workflow40217366017](https://github.com/krzysztofcal/arcadePlatform/actions/runs/40217366017) SUCCESS; artifact `arcade-poker-stage-354af80c0a93d927fb8cf6f827fa77ffad81988c` (7-day retention). Debug APK10318137bytes (~10.3MB), bundled web7474583bytes; SHA256 **`cf45da83cf4a66dfd7c3902386a916e5c3b7ac6c56b2a93fe21a9ba743d2bc86`**. [Package integrity](evidence/android-package-2026-10-25.json): all99Pokerassets included, five theme directories+Classic art; isolated HTML/JS/CSS byte-match repo and both script SRI hashes PASS. Generated engine131755bytes, renderer350246bytes uncompressed. Existing Stage shell/config remains Stage; **not a signed Production Play build**.

**PENDING OWNER — actual Android device, no device attached here.** Install artifact (ephemeral debug signature may require uninstall, which erases local data), clear only this Stage app data, enable airplane mode *before first launch*, open existing lobby→Offline without login,100/500/1000 selection/refill, legal play→showdown, several hands/rebuy/Leave, Resume after process kill, Back/background/rotation, fresh-ID/theme and preserved Resume theme, theme fallback, no gifts/free text; restore internet and confirm session remains local. Do not perform online funded actions/deletion as part of this acceptance. Browser Preview after-load offline proof does not replace cold Android proof.

## Risk / breaking impact / recommendation

**READY FOR IMPLEMENTATION REVIEW; retain Draft, NOT merge-ready pending physical Android acceptance.** No public WS/API/CH/XP/protocol/schema changes, no Production effect. Strategy extraction is behavior-preserving and exact-SHA Preview verified; future common-source changes require regenerating checked browser bundles and rebuilding APK. Storage is origin/device-local, tamperable practice only; clear/uninstall loses it. Requires secure-context Web Crypto and Web Locks (unsupported browsers fail visibly, no online fallback). Next-hand/refill are explicit local controls; no PWA/browser cold-load promise. Intentional UI change: hide deferred Coming Soon modes. Audio remains #1146; no final Play packaging/submission or live Account Deletion. No manual financial repair/mutation.

---
# Historical T001–T002 evidence (superseded stop/readiness labels retained)

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
