# T025 execution — exact-SHA WS gate PASS / MERGE-READY for owner rollout decision

2026-10-26, owner-authorized single bounded Preview deployment and smoke. Supersedes the missing-runtime-evidence verdict below; previous failed/blocked observations retained. No runtime change, Production, merge, Account Deletion, manual financial repair or migration. PR remains Draft; issue #1145 stays open.

## Deployment / preflight PASS

[WS Preview Deploy40307557291](https://github.com/krzysztofcal/arcadePlatform/actions/runs/40307557291) SUCCESS. Workflow definition main `892661f44f4e9fdbe3df24f0553fa1191bf1752e`; application input/ref and installed releaseSha/deployRef **8c05fc11b00586e8944480dec76bfd6b4cd3882c**. Process restarted10:28:21UTC, PID379636; /healthz ok. Installed adapter SHA256ea11185645e0ee557adbccb9d22c0b391f007e3241ae166336170154481903ea and strategy SHA2568e924c2c24d293b3355b753c26f8143b0f9f8eba4190e38e6a2d4320e9a076ec match repository. Generated context preview/ws-preview/Redis3/stage; protected LIVE Redis V3 Stage preflight PASS before and after. Process environment not readable by agent; no attempt to bypass protected access. Netlify Preview1147 build-info reports same8c05fc11 SHA, actual login config pins krydukthwdvccggbyjfw, all observed sockets wss://ws-preview.kcswh.pl/ws.

Before restart:0established Preview connections,0active human seats,0pending requests,0unfinished deletions, DB deletion release=false,0escrow mismatch. Five bot-only100CH tables with300CH escrow each. Historical67human seats were CLOSED/INACTIVE/stack0, not active players. No queued/running workflows or conflicting active harness found; no formal reservation service. Dedicated Stage user baseline448CH, no funding/bonus claim. Existing stage account used normal UI email/password Auth; no impersonation/mock transport. Drawer hidden by documented URL parameter; genuine UI clicks, no force or bypass.

## Scenario results

| Scenario | Result / observed timing |
| --- | --- |
| Stage login / Preview identity | PASS |
| Online JOIN during bot-only RIVER | PASS: request join_mvp46q3d_5qqmdmh7 sent10:29:09.151; accepted ACK10:29:10.937 (1786ms); assigned snapshot10:29:10.987 (1836ms), harness detection1880ms. WAITING_NEXT_HAND, same hand,0private cards/no current bet entry; old hand settled10:29:13.978, after admission. No excessive delay. |
| Online real action | PASS: next human hand CALL ws_1a177c20df6_b4f1e1c2 ACK243ms; later manual FOLD ws_1a177c22aec_8e3c005e ACK240ms. Both source human/isBot=false; no timeout FOLD. |
| Online bot continuation / settlement | PASS:22bot actions; HAND_SETTLED10:30:32.469807, version287,5participants, starting/ending500, payout/contributions46, integrity OK/flags[], all3conservation deltas0. |
| Basic reconnect | PASS: normal page reload/new socket, same table/hand/seat4/version287 and2own cards,0additional JOIN/buy-in. Tested at SETTLED boundary, not mid-action transport-fault recovery. |
| Online ordinary UI Leave | PASS for transmission/durable result/exactly1human cashout/closed table. Request ws_1a177c31a09_dfddb7c9 sent10:30:37.324, persisted LEAVE ok=true at10:30:37.334560. **ACK NOT OBSERVED** due existing immediate queued navigation; not claimed as ACK PASS. |
| Single Player JOIN | PASS: join_mvp49giw_e69f27hy sent10:31:16.718, ACK2331ms, assigned snapshot2362ms, ACTIVE/seat1/2own cards/5bots. |
| Single Player Hero + bots | PASS: UI FOLD ws_1a177c3e4eb_5bd9ce25 ACK239ms; persisted source human/isBot=false.24bot actions finish hand. |
| Single Player settlement | PASS: HAND_SETTLED10:32:33.780183, version27,6participants, starting/ending600, payout/contributions32, integrity OK/flags[], all3deltas0. |
| Single Player ordinary UI Leave | PASS for transmission/durable result/exactly1human cashout/closed table. Request ws_1a177c4e37f_c90c1b1f sent10:32:34.433, persisted LEAVE ok=true at10:32:34.439442. **ACK NOT OBSERVED**, same immediate navigation contract. |
| Privacy / final health | PASS: no private starting-map field in observed WS responses/snapshots, no page errors/WS error frames; /healthz ok, no new failed/invalid_identity/error journal match during window. |

UI Leave intentionally calls queueLeaveAndNavigateImmediately; existing tests/poker-v2-live.behavior.test.mjs test “poker v2 queued leave navigates to lobby immediately without waiting for leave ack” documents this unchanged contract. Durable DB receipt is not mislabeled as observed ACK latency. No retry was added to broaden this smoke.

## Identifiers / finance / evidence

Online table07e8e43f-e731-4845-96e9-d8df2c05c080, human handws_hand_07e8e43f-e731-4845-96e9-d8df2c05c080_263_5. Starting map captured during hand:5entries,total500,hash3098c7b8a0ec8726d7d02ddd5048583a. Single tablef1650226-5fa2-40e4-9dcc-d4bc0cd8b54c, handws_hand_f1650226-5fa2-40e4-9dcc-d4bc0cd8b54c_1_6; starting map6entries,total600,hash739653b0829e1e6d29709e6f998dd6ff. Both audits OK/no STARTING_STACK_DERIVED; [audit participant-map hashes](evidence/ws-t025-audit-map-hashes.json) exactly match both original in-hand starting-map hashes. This verifies #1147's strategy integration; not a new destructive/active-hand Leave reproduction of #1150, whose fix #1151 is already inherited from main.

Wallet Online448→348(buy-in100)→442(cashout94), game loss6. Single442→342(buy-in100)→442(cashout100). Human transaction IDs: Online buy-in81f2d1c2-c5b3-45d5-a069-bde4d7a7c9d4 / cashouta3074a2f-c6c5-47b7-91c0-a7dc66dfff76; Single buy-in3d7f8b6c-59a8-4758-9f07-b4902d3c1486 / cashoutdb64d2ec-9500-45fb-b602-c7058b98fa3f. Both table escrows0, CLOSED, all seat stacks0/no human seat. Every recorded transaction sums0, exactly1human debit/cashout per table, bot cashouts separate. Final0active human seats/0pending/0unfinished deletion/0Preview connections. No manual correction.

[Browser summaries](evidence/ws-t025-browser.json), [settlement audits](evidence/ws-t025-audits.json), [reconciliation/transaction IDs](evidence/ws-t025-reconciliation.json), [Single starting map summary](evidence/ws-t025-starting-map.json). No password/JWT/full private snapshot committed. No new maintained test/UI framework, no broad accepted Offline campaign replayed.

**Verdict: MERGE-READY technically, pending owner's explicit merge/rollout decision and fresh required-check/main review.** Exact-SHA gate closed for the bounded paths; no regression/breaking impact identified. Do not merge automatically. A future merge deploys WS and both linked Netlify Production sites unless independently held. For merge without Production, separately authorize/coordinate disable WS Server Deploy, verify disabled state and no running deploy, stop builds on both Netlify sites and verify no in-flight publish; preserve required CI/rules. No controls changed now; skip-netlify is not WS protection. Hold procedure/official references remain in T025 preflight below. Simplest option is retain Draft until explicit combined rollout GO.

---

# T025 — final preflight: NO-GO for merge, required WS evidence OPEN

2026-10-26. Owner physically accepted T024 on Samsung Galaxy S24+: **PASS**. All previously reported Offline issues accepted. This supersedes the T024 physical-pending notes below; historical runs remain unchanged. No additional cosmetic/gameplay change, deployment, funded JOIN, merge or issue closure performed. Documentation-only local update; reviewed PR HEAD remains unchanged.

## Revision/check evidence

- PR #1147 remains Draft, HEAD `8c05fc11b00586e8944480dec76bfd6b4cd3882c`; current main `892661f44f4e9fdbe3df24f0553fa1191bf1752e`, live API verified and fetched. Main is an ancestor; GitHub MERGEABLE / CLEAN. No update/rebase/conflict fix needed.
- Active main ruleset 12958021: strict required checks `netlify/playkcswh/deploy-preview` and `actionlint`, plus code-owner review rule. Both named checks SUCCESS. All reported CI/CodeQL/Android execution checks SUCCESS; expected nonapplicable jobs SKIPPED, Netlify summary annotations NEUTRAL. No failing/pending check. Review decision empty/latest review COMMENTED; owner acceptance is recorded here, not misreported as GitHub APPROVED. Recheck applicable review/rules before merge; never bypass.
- Complete main diff: 71 files, 16582 additions/241 deletions, dominated by generated renderer/bundle and retained evidence. Runtime sources inspected along with generator, packaging, mobile bootstrap, lobby, dependencies and test registration. No changes to workflows, Netlify config/functions, shared rules, WS server/Leave/Account Deletion/table-manager or Online renderer/HTML/CSS versus main. No migrations. One pinned dev-only build dependency esbuild 0.25.12; lockfile adds its platform packages, not a new WS runtime library.
- Fresh fundamental tests: 99/99 accepted-bot adapter + Offline + mobile security + WS client. Engine/bootstrap/action/rollover 36/36 PASS. CSP inline guard PASS for56served documents; diff whitespace clean. Local reconnect suite could not observe server-start readiness and timed out; stopped temporary test processes rather than count this as PASS. Cause of local startup observation failure remains UNKNOWN; no application/config change attempted. Exact-HEAD CI run40296472017 independently reports reconnect/resync20/20 PASS (0fail). The bounded live reconnect remains required, not substituted by CI. Strategy equivalence checked structurally: all 18 function declaration bodies in the new module exactly equal their main adapter originals; six exports/imports preserve all callsites.

## Queue cap: PASS, inherited #1149 rather than new #1147 behavior

`f39d9695da5c00ee1ff59498aeba3806d2483cd8` (#1149, already in main) removed `getBotAutoplayConfig`'s POKER_BOTS_BOTS_ONLY_HAND_HARD_CAP consumption and fixed accepted WS `botsOnlyHandCompletionHardCap:1`. Current PR keeps it unchanged. `runBotAutoplayLoop` otherwise raises maxActions to that cap when no participating human remains; the WS adapter's maxActions:1 plus cap:1 ensures one action per FIFO entry. Existing cascade/scheduler requeues subsequent steps. Online JOIN/Leave can run between steps, including Single Player after human FOLD. Existing deterministic tests use env cap80 and prove bot/admission/bot ordering, one action/persist per step, legal completion and chip conservation.

The env knob remains ineffective in accepted WS, exactly as on current main; do not restore it. Generic domain autoplay/Leave callers keep their own caps. No new hand-duration, DB/queue-write or strategy change relative to Production main; per-action queue/persist costs were introduced/accepted in #1149. Extraction adds one local module import only. Strategy hash `8e924c2c24d293b3355b753c26f8143b0f9f8eba4190e38e6a2d4320e9a076ec`; adapter hash `ea11185645e0ee557adbccb9d22c0b391f007e3241ae166336170154481903ea`.

## WS runtime gate: OPEN, merge blocker

Historical ws-verification.md deployed `ddb21224d99e07dead0164bf14dcbfb52356dec4`; Online JOIN eventually seated after ~37.5s, smoke stopped before player action/reconnect/Single Player. Later #1149 diagnosis/fix explains FIFO starvation; #1152 proves those fixes together, but does not prove this extracted-strategy runtime end-to-end. New main fixes also changed WS files after ddb21224 (13 WS/shared/function files differ). Neither the old failed smoke nor accepted #1152 nor green Netlify closes #1147 exact-SHA gate.

Read-only current Preview: installed release metadata `354af80c0a93d927fb8cf6f827fa77ffad81988c`, PID328965 active; public /healthz ok. Last deploy workflow definition ran from main892661f; application ref must be read from installed metadata, not workflow head. Preview is not running #1147. No availability/funding clearance inferred from health alone.

After separate GO, deploy application **8c05fc11b00586e8944480dec76bfd6b4cd3882c**, workflow definition from then-current main, Stage Redis V3. The earlier WS-specific merge commit2af27654 is insufficient as the selected full PR artifact; use current reviewed full revision. Docs-only later commits can retain this evidence after proving no deployable/config changes. Bounded plan is in ws-verification.md. No broad Offline/WS campaign, Account Deletion or fault injection needed.

## Breaking impacts / deployment safety

No public WS protocol, strategy decisions, online CH/XP/ledger, Account Deletion, storage-v1 schema or dependency runtime break identified. Intentional visible changes: Offline lobby replaces World Tour/Seasons/Sit&Go coming-soon cards; mobile startup/status/Back presentation changes; local PC wallet/session and Web Locks/Web Crypto require a capable secure browser. Stage APK remains Stage identity/debug delivery, not Play release certification. Offline table CSP connect-src none and no Auth/WS bootstrap; online lobby retains its existing online initialization. Generated artifacts must be regenerated when source seams change; generator fails closed on known seams. Physical accepted APK remains valid; T025 adds no executable change.

**Merge is a Production action here.** Classifying actual diff sets deploy_ws=true. Active workflow241316948 (`WS Server Deploy`) accepts main push; deploy job runs after validation and atomically switches release then restarts ws-server.service. No environment approval barrier is declared. PR validation/deploy-skipped is not a future deployment hold. Netlify linked playkcswh and landing-kcswh both build previews; a main merge can publish web/functions Production. No config change in this PR disables either path. `[skip netlify]` does not stop GitHub WS deploy.

Verified supported hold method (proposal only, not executed): before an authorized merge-only window, disable **only WS Server Deploy** in GitHub Actions and read back state disabled_manually; ensure no queued/running prior deployment (disable does not cancel existing runs). Stop builds on **both** linked Netlify projects through their normal Continuous deployment > Build settings > Build status=Stopped builds, verify both stopped and no in-flight publish. Keep CI/required checks/rules unchanged. Stop builds blocks automated builds including build hooks; auto-publish lock alone is weaker and does not stop builds. No manual deploys while held. Re-enable later only under Production GO and an explicitly selected current revision; no assumptions about deferred publication. This site-wide temporary hold affects other work and needs owner coordination/approval; no hold was applied during this read-only task. If hold cannot be verified, do not merge. Simplest safe current method remains no merge until explicit combined rollout approval.

Sources: [GitHub disable/enable workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows), [Netlify stop/activate builds](https://docs.netlify.com/build/configure-builds/stop-or-activate-builds/). Verified against official documentation and current repository trigger/impact code; controls were not experimentally toggled on shared services.

**Verdict:** Offline owner acceptance PASS; source compatibility/local fundamentals/CI/conflicts PASS; exact-SHA WS integration evidence OPEN (merge blocker); any merge/deployment authorization OPEN. **NO-GO for merge now.** Next decision is only permission for the bounded WS Preview preflight/deploy/funded smoke described below; Production approval remains separate.

---

# T024 — table theme loading packaged readiness PASS; physical owner review pending

Owner physical T023 PASS retained. Root cause confirmed: generated init called markBootReady before first offline.start snapshot and before asynchronous applyTableTheme finished. Reuse same splash/hidden-screen styles; now prepareOfflineFrame waits actual theme/common-scene decode, first paused snapshot/current img decode and2layout frames before calling existing guarded markBootReady. Theme loader is the original V2 body with guarded Offline-only transformations: Promise return/decoded assets/bounded fallback. Source Online renderer/HTML/CSS unchanged. No new loader framework or artificial success delay.

New Game browser action pauses before document navigation. startView publishes paused state and gates generic activate until view readiness; unpaused cold legacy state rebases saved budget before pause. No hidden bot action/actor time while graphics wait. Reveal then activate;20s/1–2s/3s rules preserved. Existing15s image guard leads to stable Classic fallback; late loads cannot activate rejected theme. Startup errors return canonical lobby; Back/Reset/recovery unaffected.

Three fundamental tests RED26pass/3fail → GREEN35/35 cover paused snapshot before deferred ready, preserved20s despite60s loading/foreground attempt, theme+frame ordering/single completion, success/failure/timeout fallback/no late switch. No protocol/v1 format/finance breaking impact. Internal Offline start accepts a readiness callback; only generated renderer consumes it. Actual APK/CI evidence follows; retain Draft, physical owner acceptance pending.

## T024 actual APK results

Runtime `d673ffa6a20dba4355c28425217ab96fca70b2a6`, Android build40295066697 SUCCESS; current runtime CI/CodeQL PASS. [Five-case packaged proof](evidence/apk-t024-theme-readiness.json), [held graphics/loading](evidence/apk-t024-loading.png), [Sapphire portrait](evidence/apk-t024-sapphire.png), [Royal Gold landscape](evidence/apk-t024-gold-landscape.png). Actual APK assets, pinned Capacitor routes/external network offline. Temporary test UUID pins theme for genuine UI New Game; deck/bots/actions remain actual shared engine. Resume uses unmodified record saved via real confirmed Back, opened in a fresh browser context (cold cache/process simulation). No app artifact edits.

PASS: Classic New Game portrait, Sapphire New Game portrait, Royal Gold New Game landscape, existing Sapphire Resume landscape, failed Sapphire artwork→stable Classic. Local artwork held300ms/2300ms; until release table visibility hidden, splash visible, coordinator inactive and full persisted state unchanged. At first reveal correct target/fallback,2Hero cards, clock paused and exactly1boot completion. No post-reveal theme changes,0JS errors/0WS. Sample budgets: Sapphire New Game20000→20000 after2300ms wait; Resume19135→19135 after2300ms; Gold19999→19999. The1ms initial creation elapsed before pause is not loading consumption;20s duration unchanged. Forced image failure resolves fallback without endless spinner, and fundamental simulated15s timeout/late completion remains stable.

35/35fundamentals (29Offline/3mobile/3canonical timeout), generator/CSP56documents/whitespace PASS. Independent review no critical/important findings or material simplification required. Original Online renderer/CSS/HTML, WS/shared rules, PC schema/refill/settlement and native config unchanged. Final evidence-only HEAD/source-identical APK and checksum/CI linked in PR after build. Native physical first-frame acceptance still pending owner; do not call this physical Android PASS. No merge/Production/WS replay.

---
# T023 — Offline storage recovery packaged recovery PASS; owner review pending

Review confirmed the dead end: read rejects corrupt/unsupported records, lobby no longer has ordinary Reset, and former Table Reset used run's pre-read. Added an emergency button hidden by default, shown only on OFFLINE_STORAGE_INVALID validation errors. Other errors do not expose deletion UI. Existing read messages/fail-closed behavior retained, primitive/array sessions explicitly classified as invalid rather than leaking TypeError.

One resetOfflineProgress handler requests existing STORAGE_KEY Web Lock without run/read, asks existing custom confirmation, then invalidates local timers/preactions, removes only STORAGE_KEY and navigates explicit lobby. Cancel does not remove data. Table Settings and recovery share handler. Invalid initial table read redirects to lobby recovery instead of leaving an unbound table. No automatic deletion, new modal, normal-lobby control, financial/refill/WS/config/dependency/schema change. T022 automatic threshold and all previous navigation rules unchanged.

Fundamentals RED24pass/2fail → GREEN32/32. Actual core validation + actual fail/reset function bodies verify invalid/schema/primitive records, code-specific recovery UI, business/quota exclusion, Cancel/no deletion, Confirm/only-key deletion under lock, no read/run during reset and default5000/New Game100 after recovery. Existing healthy Table reset/auto-refill/navigation checks retained. No public protocol/v1 format breaking impact; internal validation errors gain code property, UI gains error-only recovery option. Actual APK/CI evidence follows; physical owner acceptance pending.

## T023 packaged evidence

[Previous APK reproduction](evidence/apk-t023-reproduction.json): d14ca4f6 with corrupt JSON displays error but has0recovery controls. New runtime `20607142af37f77e754b34acb7cac71057abfcdc`, hosted Android build40278351892 SUCCESS, CI/CodeQL PASS. [Actual APK smoke](evidence/apk-t023-recovery-smoke.json), [error-only UI](evidence/apk-t023-recovery.png). Temporary Chromium reads unchanged APK assets with pinned Capacitor routes/external network offline; no directory-index substitution or app edits.

PASS for corrupt JSON and unsupported schema: visible error/recovery, Cancel leaves raw record intact, Confirm removes only Offline record and preserves unrelated data, canonical lobby/default5000, then actual New Game100→wallet4900. Shared Table Settings Reset Cancel/Confirm works on recovered healthy session. Corrupt initial table URL redirects to recovery lobby. Healthy wallet100 remains100 under T022 and recovery stays hidden.0JS errors/0WS. Native physical behavior remains owner acceptance.

32/32fundamentals (26Offline/3mobile/3canonical timeout), generator/CSP56documents/whitespace PASS; independent review no important/critical findings. No T022 refill logic, shared WS/Online, native config, dependencies, CH or schema change. Final evidence-only HEAD is source-identical to tested runtime; exact-current-HEAD APK/checksum/CI published in PR after build. Retain Draft; no merge/Production or broad WS replay.

---
# T022 — automatic Offline Chips refill Preview/packaged smoke PASS; new APK pending owner acceptance

Owner replaces manual refill UX. Minimal change: guarded existing refill logic participates in save's single wallet/session record commit after revision check. Startup runs conditional refill under existing Web Lock. New Game/Rebuy can use a valid old wallet<100 before affordability; post-debit save normalizes below100 in the same commit. Leave still returns only Hero stack, then enforces threshold; already-left retry does not write/refill again once normalized. read remains pure and failed writes preserve previous record. Never funds Hero or triggers automatic Rebuy.

Intentional local behavior change: wallet below100 becomes5000 automatically, replacing manual refills; stack+wallet total may increase by exactly the local refill grant. Poker stake conservation/rules unchanged; no online CH/XP/bankroll/API/Supabase/WS operation, schema or migration change. Valid v1 saves retain session/cards/stacks/roster/table/clock; refill only changes wallet and revision. Existing internal refill() now no-op at>=100; no remaining manual UI consumers.

Lobby only keeps balance/tiers/play/resume. Reset/disclosures moved into Table settings using existing shared styling/confirmation. Free Refill removed from lobby/menu/rebuy and stale handlers/scoped CSS removed. Rebuy remains explicit; default timing, splash/artwork and canonical lobby routing unchanged.

RED21pass/3fail demonstrates old refill semantics; GREEN30fundamentals covers threshold0/99/100, pure read/no-op revision, write failure, competing deals/stale deal versus refill, unchanged Hero stack/legacy Resume, explicit Rebuy/Leave; existing Reset tests retained. Focused Preview/actual APK and CI results recorded after build. No public protocol or v1 format breaking impact; physical owner acceptance pending after new APK.

## T022 verification

Runtime `85f6c4cdf8f461fbfe44fa5875393122cb13eba5`; [immutable Preview](https://6adeaa1c8d8778789ef413f2--playkcswh.netlify.app/poker/?ntl-drawer-state=hidden), hosted Android build40253484068 SUCCESS, CI/CodeQL PASS. [Preview proof](evidence/preview-t022.json), [actual APK assets proof](evidence/apk-t022-smoke.json), [simplified bundled lobby](evidence/apk-t022-lobby.png). Temporary two-page smoke seeded a valid old v1 wallet99/session without roster: exactly one refill commit/revision+1 to5000, unchanged session/Hero stack, Resume preserves hand/table/stacks, no manual refill controls, lobby copy removed, Table settings disclosures and Reset Cancel/Confirm PASS. Actual APK assets use Capacitor routes with external network offline.0JS errors/0WS/API calls during isolated table; local bundled image loads are permitted and not network transport. No physical Android claim.

The temporary fixture initially reseeded itself after Reset navigation; corrected to seed once. APK probe also initially counted legitimate bundled avatar file requests as network; corrected to check non-asset transport. No app behavior changes to bypass either assertion. Visual QA found the Reset button inherited menu-only styling outside that menu; final generated HTML uses shared poker-live-btn. Final current-HEAD APK, hash/CSP/SRI and this visual correction are checked/published in PR after build. No change to engine/financial logic after functional smoke.

30/30 fundamentals, generator/CSP56documents/whitespace PASS. Independent review found no critical/important issues. Intentional local change only: manual top-up replaced by automatic threshold grant, which may increase wallet+table total by that local grant; no increase to Hero stake and no effect on online CH. Existing v1 storage and canonical navigation unchanged. Retain Draft; physical owner review pending, no merge/Production/WS deploy.

---
# T020–T021 — packaged Return to lobby blocker packaged smoke PASS; physical acceptance pending

Owner reported a947151d Android blank screen after confirmed menu/native Back, plus Stage PoC banner. [Reproduction](evidence/apk-t020-reproduction.json), [blank view](evidence/apk-t020-blank.png): actual APK assets with pinned Capacitor route semantics, confirmed Back→/poker/→root entry→loader hidden→0tiles/empty body. Native code WebViewLocalServer maps extensionless routes to root index.html; launch.js wrongly accepted /poker/ as the real lobby. Earlier Python directory-index smoke masked this routing difference. No game/PC loss observed; session remains paused.

Canonical /poker/index.html now used for all local exits/fallbacks/generated anchor, while loader redirects legacy paths before hiding. Normal Stage PoC/SHA and connectivity notices removed from runtime, not hidden with CSS. Retain auth feedback via accountStatus and contextual mobileError for bridge failures; engineering logs via klog. No shared Online/WS, rules/strategy, PC finance/schema, dependencies or migration changes. Intentional route/UI changes only; existing v1 sessions compatible.

Fundamental RED20pass/4fail confirmed old destination/banner behavior; GREEN and actual new APK smoke recorded after build. No extra maintained rendering suite, no restart workaround. Previous physical passes remain historical, but T020 physical owner acceptance is required; do not mark merge-ready.

## T020–T021 results

Runtime `e04b699f9f8d7db42031bf77e2fb63f89d05eca2`; hosted Android build40248297456 SUCCESS. [Actual packaged smoke](evidence/apk-t020-t021-smoke.json), [lobby after Confirm](evidence/apk-t020-confirm-lobby.png), [clean lobby/artwork](evidence/apk-t021-clean-lobby.png). Temporary Chromium loads APK assets with identical pinned Capacitor extensionless root fallback, navigator offline before first load and all remote requests aborted. This replaces the misleading directory-index test server for navigation verification. Native App callback supplied through temporary bridge stub, not physical Android proof.

PASS: menu Confirm, Keep playing, native Back callback Confirm, Resume preserving hand/cards/stacks/members/table/remaining actor budget, explicit UI Leave and one cashout, reload without another cashout, Reset Cancel/Confirm, legacy /poker/ redirect and missing-session fallback. All land at explicit /poker/index.html with real lobby visible and loader hidden. Normal UI contains neither mobileStatus nor mobileError; normal startup/connectivity does not insert developer banner. Existing fundamental tests also confirm auth failure and unavailable bridge still surface messages.

Local PC observations: initial5000 → buy-in100 leaves4900; Hero cashout100 →5000; reload unchanged5000; reset5000/sessionnull. No CH/backend mutations.0WebSockets,0JS errors; only a blocked unauthenticated Stage API host attempt from existing lobby startup, no remote connection success. Table remains isolated. Splash/artwork retained.

27/27 fundamentals PASS (21Offline/3mobile/3canonical timeout); syntax/CSP56documents/rebuild/whitespace PASS. Independent review: no critical/important findings. Source Online renderer/lobby runtime and all shared WS/engine modules unchanged; no WS Preview replay. Final evidence-only HEAD source-identical to tested runtime, new exact-current-HEAD APK/CI and checksum published in PR. Physical Galaxy S24+ Confirm/Leave/Reset acceptance pending; retain Draft, no merge/Production.

---
# T018–T019 — launch polish and Offline artwork browser/Preview PASS; awaiting physical cold start

Owner physical T017 and earlier fixes accepted. Confirmed source of raw blue link: package-web generated default white entry body containing Open Poker Lobby before redirect. Replaced with branded inline-painted loading document, shared into mobile lobby only. Android already depends on core-splashscreen; install its compat API, dark launch/window/WebView surfaces and chip/spade vector. Lobby readiness waits local styles/DOM/fonts/main artwork and layout frames without login/network. No new dependency or Online bootstrap/runtime behavior change. Offline tile now uses dedicated portable-table teal/gold artwork; Single Player unchanged.

No financial/schema/protocol breaking impact. Intentional presentation changes only, existing v1 saves and T001–T017 untouched. New launch files CSP/SRI, native compile and focused browser/Preview checks recorded after build. Native first-frame/cold-start claim remains PENDING physical Android owner verification; browser screenshot is not proof of Android compositor behavior. No emulator/local Android build, WS replay, merge or Production.

## T018–T019 evidence

First runtime `fc9e7cb726504f6f1211dd3231ab90fdb89ac979`; [immutable Preview](https://6ade8c174872188a6acd41ab--playkcswh.netlify.app/poker/?ntl-drawer-state=hidden). [Preview result](evidence/preview-t018-t019-2026-10-25.json), [launch](evidence/preview-t018-launch.png), [lobby comparison](evidence/preview-t019-lobby.png), [mobile tile](evidence/preview-t019-tile.png). Normal launch redirect verified; no fallback link, inline dark surface and styled mark/loader. Offline artwork decoded768×1152 and differs from Single Player. Zero JS errors.

Hosted APK build40243453428 SUCCESS (native splash compiles). Actual APK assets/public extracted unchanged for temporary Chromium startup probe: hold entry script → branded screen/no raw link; defer lobby stylesheet/artwork → overlay remains; release assets → overlay hides after readiness. [Packaged proof](evidence/apk-t018-web-smoke.json), [loading screenshot](evidence/apk-t018-loading.png). No native device/compositor claim. The probe initially expected the splash background color after lobby reveal; corrected temporary assertion to the existing dark lobby color. This was a harness mismatch, not an app failure. Visual QA additionally scopes normal font-style/text-shadow for the splash heading so lobby typography cannot change its appearance; final APK carries that presentation-only adjustment.

26/26 existing fundamental checks PASS, syntax/CSP56documents/whitespace PASS; CI/CodeQL/Android PASS for first runtime. Independent review no critical/important findings. No new maintained simple-glue/layout tests. Final current-HEAD APK, checksum and checks linked in PR after build; T018 physical cold start and T019 artwork acceptance pending owner. No merge/Production/WS Preview. Asset created with built-in imagegen (prompt in plan), saved at poker/assets/lobby/offline-v1.webp, encodedWebP without content changes.

---
# T017 — Back confirmation: focused Preview PASS; awaiting owner APK acceptance

Owner S24+ physical PASS for T015–T016 retained. New immediate-navigation report confirmed: former backToLobby parked then navigated directly. Updated only local controller/generator and generated artifacts: existing offlineConfirm now asks `Return to lobby?` with saved/Resume message and Keep playing/Return to lobby labels. Same styles; ask defaults reset for New Game/Reset.

First Back claims single request and parks once before showing dialog. Cancel/Escape/repeat Back resume saved budgets once; rapid Back during pending park suppresses modal and resumes once. Confirm navigates with session parked and no cashout; duplicate navigation latched until unload. Generic wake events cannot resume timers behind pending modal. Existing park/epoch invalidation clears preactions. Explicit Leave unchanged; handler errors shown locally. No Auth/WS/CH/online data/config/dependency/CSS changes.

Three fundamental tests reproduce the old behavior/BFCache edge and now pass, reusing actual Back/ask/cancel functions with minimal dialog interface and real local game/fake clock. Cover Cancel60000ms modal wait restoring15000ms budget, Confirm preserving hand/cards/stacks/bots/table/wallet for Resume, duplicate Confirm-then-Back navigation fence and rapid Back before/after modal with one park/show/resume and no refund. Review found the confirmed-navigation latch surviving BFCache; restorePage clears it only on a persisted return and resumes through existing lifecycle. A regression test covers confirmed departure/restoration/fresh confirmation. No maintained DOM/layout suite. Focused Preview results below; final exact-HEAD Stage APK linked in PR after build. Intended behavior change only: Offline Back now requires confirmation; no public API/schema/protocol break, no WS replay.

## T017 runtime evidence

Runtime `4fe03732221c4ea75add47948cf2f58a0845bfd8`; [immutable Preview](https://6ade83c6a6eee469e69364da--playkcswh.netlify.app/poker/?ntl-drawer-state=hidden), [result](evidence/preview-t017-2026-10-25.json), [dialog](evidence/preview-t017-dialog.png). Normal UI clicks verified menu Back, exact dialog labels, unchanged persisted state during 1.8s confirmation, Cancel/resume, Confirm/lobby/Resume preserving table/hand/roster/theme/wallet, cleared preaction, separate explicit Leave. Capacitor callback probe verified one native Back registration, second Back cancellation and foreground event unable to resume behind modal; this is browser callback verification, not a physical Android claim. No JS errors. Screenshot visually reviewed at412×915. No Online/WS operations.

26/26 fundamental tests PASS (20Offline,3mobile security,3canonical timeout); generator, CSP56documents and whitespace checks PASS. Runtime Android build40240772632 SUCCESS. Final evidence-only commit changes no runtime; current-HEAD APK/CI status published in PR. Physical S24+ verification of T017 pending owner; previous accepted physical evidence retained.

---
## Previously accepted physical/UI evidence

# T015–T016 — focused Preview PASS; new Stage APK for owner review

Owner T013–T014 Galaxy S24+ PASS retained. New reported empty action panel traced to historical generator removal of V2 checkbox wrappers. Those wrappers are now unchanged source markup; existing buildQueuedPreaction/resolveQueuedPreactionExecution/maybeExecuteQueuedPreaction and canonical projectedLegalActions reused. Snapshot callback merges first, clears changed-hand intent and invokes queued execution as Online does. No second action engine or renderer.

Queue remains volatile. Park/Leave clear it via local renderer callback; an epoch guard plus existing rendered revision/hand/actor token prevents delayed requests surviving pause/Resume. Renderer transport-ready seam reads actual local active state; isSignedIn/Auth methods are not overridden or supplied fake JWTs. Local human is the genuine local participant, not an online authenticated user. Manual/preaction/timer mutations use one existing Web Lock.

T016 supersedes earlier visible Practice Chips requirement: **Offline Chips**, Poker Offline/OFFLINE and discreet local/independent-CH disclosure. Existing quick-tiers, tile-action, quick-resume-shell and Poker secondary buttons replace radio controls/custom Practice balance styling. Existing V2 menu buttons/modals/slider/fonts/animations/themes unchanged; isolated CSP denies transport, no online clients/gifts enabled. Technical PC key/schema/session unchanged. Issue #1145 decision/title updated, historical requirements retained with supersession notice.

Fundamentals23/23PASS (17Offline+3mobile+3canonical timeout); existing targeted V2 preaction cases4/4PASS. New tests evaluate common queue rules without a DOM framework and verify wait/legality/invalidation/exactly-once/stale timer+manual token/pause reset. Local actual-control probe: selecting Fold leaves revision unchanged until Hero, then one legal human FOLD. Independent review: no critical/important findings. Temporary Playwright uses visible checkbox label, not forced clicks on the intentionally non-interactive styled input.

Source Online renderer/CSS for table and all shared WS modules unchanged; no WS Preview replay needed. Poker lobby CSS delta is scoped only to local tools and inherits existing button typography. No public protocol/finance breaking impact. Intended Offline UI changes: restored preactions and renamed visible currency. v1 records unaffected; queue is not persisted and cannot restore. No new dependency/framework/DB change. Preview/APK proof will be linked after completion; retain Draft, no merge/Production.

## Current runtime evidence

Tested `01c80359c3471ae443248c1dc3d9a23ed29ea39d`; [immutable Preview](https://6ade792e895465f3e23b5e56--playkcswh.netlify.app/poker/). [Session proof](evidence/preview-t015-t016-2026-10-25.json), [lobby comparison](evidence/preview-t015-lobby.png), [portrait preactions](evidence/preview-t015-portrait.png), [landscape preactions](evidence/preview-t015-landscape.png), [original Online presentation reference](evidence/preview-t015-online-reference.png).

- Original three queue function bodies (`buildQueuedPreaction`, `resolveQueuedPreactionExecution`, `maybeExecuteQueuedPreaction`) byte-identical in generated renderer. Canonical projector unchanged. Source original Online table HTML/JS and all shared WS files unchanged.
- Actual UI selected buy-in500 using `.quick-tier`, wallet5000→4500; no radio controls or visible Practice text. Hero turn showed normal buttons, opponent turn showed original four checkbox wrappers; normal button hidden when corresponding checkbox visible. Selecting Fold did not fold immediately; one unique later human FOLD committed in that hand. No force clicks/direct action handler/WS command. Styled input is deliberately covered by its normal label, so temporary probe clicks label as users do.
- Another checkbox intent selected before Back; parked JSON contains no preaction. Resume reset checkbox, preserved hand/roster/wallet; Hero reached a legal turn without unexpected fold. Explicit Leave closed session, wallet4998/sessionnull (local only). No remote data mutation.
- Portrait412×915 and landscape915×412 reviewed visually; Hero cards/frame/controls remain visible and source V2 action slider/checkbox styling retained. Lobby reviewed with Online/SinglePlayer/Offline cards side by side. Online table reference used its existing built-in demo with no tableId/login/JOIN in a separate fresh context: visual comparison only, **not a replay or claim of authenticated WS smoke**.
- Disconnected table phase0requests/0fetch/XHR/WS/beacon attempts,0JS errors. Public lobby/reference loads outside this isolated phase. Timing/roster accepted S24+ results preserved.
-23fundamental tests,4existing targeted Online V2 preaction tests, syntax/CSP/rebuild/whitespace PASS. Runtime CI/CodeQL/required Netlify/initial APK workflow40237214741 SUCCESS. Final evidence-only HEAD APK linked in PR once built; no further runtime change implied by evidence commit.

Current verdict: ready for final owner review/new APK, **retain Draft**, no merge/Production. Offline Chips is a UI-only rename, no PC wallet/session migration or financial/protocol break. Existing data,20s clocks/1–2s bot decisions,2–5persisted bot composition,3s auto-next, reactions and six themes unchanged. Outstanding acceptance is owner confirmation of restored preactions and unified Offline UI on the new APK. No shared-runtime WS repeat.

---
## Prior accepted physical review/evidence

# T013–T014 — physical PASS retained, bot clock/roster corrections

Owner S24+ PASS: airplane mode, both orientations/cards, auto-next, dialogs, Back/Resume and other exercised cases. Retain Draft; these two corrections require new Stage APK/owner confirmation.

T013: all live actors have exactly20s stamped via existing shared timeout module; bot strategy independently scheduled1000–2000ms. Deadline expiry chooses canonical CHECK/FOLD before strategy, including delayed bot callback. Both remaining budgets persisted on pause/Resume;3s rollover and existing Web Locks/token guards retained. Existing V2 renderer/clock functions unchanged.

T014: audited `shared/poker-domain/bots.mjs::computeTargetBotCount` and join.mjs first-human selection/default2–5. Reuse pure helper with6seats/1human/min2/max5; do not call funding/admission. Persist roster and use it for core, seeds, stack maps, snapshot maxSeats and reactions. Each member receives buy-in stack; only human debits wallet once. Legacy v1 infers original two bots; old short bot clock upgrades to20s without changing tableId/handId/cards/stacks/wallet/theme. Bad roster/timer metadata fails closed.

Fundamental coverage includes15Offline cases plus existing mobile/security/shared timeout checks:20s versus early strategy, canonical late bot fallback, independent paused budgets, stale callbacks,2/3/4/5 bots with five-card showdown and totals300/400/500/600, Resume/rollover/Leave and old v1. A formerly random CHECK-timeout fixture could legally end by folds before reaching CHECK; its seed is now deterministic rather than changing production rules. Independent review found no critical/important issue in this delta.

No shared runtime/strategy/Online CSS/protocol/finance change, so no WS Preview replay. No migration/dependency/config change. One focused Netlify proof and current-SHA APK are linked in PR after verification. Existing accepted physical evidence is not replayed as a WS campaign.

Deferred replacement assessment: `replaceBrokeBotsForNextHand()` already returns a pure state/replacement plan, but is not a drop-in Offline call: its generated IDs conflict with current local roster validation, its UUID helper uses Node crypto/Buffer beyond the prepared-seed adapter, and replacementFunding descriptors must never invoke CH bankroll/ledger paths. A later small reviewed browser-safe identity/local-issuance adaptation could reuse the planning semantics. It is **not implemented here**; current roster remains stable and broke bots retain existing local top-up behavior between hands.

## Focused Preview PASS / new APK gate

Tested runtime `f41b82e1c576a7a54260a47c5c16c58766bf4112`; [immutable Preview](https://6ade67d9f2cddc8fd73253f2--playkcswh.netlify.app/poker/), ready/exact commit_ref; later commits are evidence-only. [Measured session](evidence/preview-t013-t014-2026-10-25.json), [six-seat clock](evidence/preview-t013-six-seats.png).

- Random New Game selected5bots+Hero: seats1–6, all100PC, wallet4900 (only human buy-in). Existing V2 shows active bot20,000ms clock; sampled remaining19,870ms/progress0.99975. All25observed bot decisions had20,000ms turn limit, scheduled1010–1909ms, observed1011–1911ms. Example1535ms decision leaves18,465ms. Deadline CHECK/FOLD for delayed bot is deterministically tested, not a live fault injection.
- Board9S AH4S JC8H; stacks92/92/92/96/92/136,total600,pot0, canonical showdown/settlement. Auto-next3004ms. Back/Resume kept roster/seat assignments/tableId/theme and parked stacks. Ordinary Leave wallet4900+92cashout=4992,sessionnull. No second debit for bot stacks.
- Network disabled after initial assets:0requests/0fetch/XHR/WS/beacon attempts,0JS errors. No forced clicks/direct action handlers/mocked game state. One focused Preview smoke, no WS/funded remote campaign.
- Fundamental21/21PASS:15Offline+3mobile+3canonical timeout; syntax/CSP/rebuild/whitespace PASS; runtime CI/CodeQL/required checks and initial APK workflow40231415322 SUCCESS. Final documentation-head APK receipt/SHA256 linked in PR once build completes. No further runtime change after this evidence.

Current recommendation: **ready for owner physical re-test; retain Draft, no merge/Production**. No public Online breaking impact; new Offline behavior is20s bot avatar clock with separate short decision and random persistent2–5 bot roster. v1 legacy two-bot and short-clock compatibility tested. Debug signing may require uninstalling only Stage, which erases local data; no Android signing/release/configuration change in this task. All prior S24+ PASS remains recorded; owner should specifically confirm countdown pacing and3–6player seating/Resume in the new APK.

---
## Previous physical review and evidence

# T009–T012 — focused Preview PASS; awaiting owner Android re-test

Owner Galaxy S24+ PASS: cold Offline gameplay, several full hands, human actions, Resume, Leave. Rebuy/Refill physically NOT VERIFIED. Prior browser layout acceptance did not establish correct physical framing; clipping reported by owner is addressed by removing the extra banner and sharing Online viewport/inset ownership. Physical layout acceptance remains pending re-test.

Current changes: PC in existing HUD; rebuy/refill in menu/shared bust panel; automatic3s canonical rollover; Hero20s canonical CHECK/FOLD timeout; random1–2s bot turns, shared avatar clocks; durable token-guarded timer/action writes, local pause budgets and backward-compatible v1 initialization; local dialogs replace system confirm. Online renderer/CSS, shared WS rules/strategy and finance unchanged. Android initializer merely adds Offline to existing table-mode path and same inset substitutions; package rehashes modified renderer CSP/SRI. No new renderer/framework/runtime/config/dependency.

Fundamental14/14PASS (Offline8,mobile3,shared timeout3), including simultaneous rollover callbacks, FOLD/CHECK, stale timer rejection, pause/old v1 resume, bust/rebuy and write failure. Temporary412×915/915×412 probe: scene starts at0 and fits viewport, both Hero cards within bounds, active avatar clock present. No maintained layout suite. Independent review found stale rendered-action token and failed-Leave deactivation gaps; both addressed in local controller. Focused Preview and initial APK build338c3d27 PASS; final documentation HEAD artifact is linked in PR after build. Physical re-test still required. No WS Preview replay: shared runtime unchanged.

The bust panel explicitly offers Rebuy / Free refill / Leave (the old Return-to-lobby button is locally relabeled and opens existing Leave confirmation). Scoped confirmation layer sits above the bust panel in landscape, so Cancel/Escape remain reachable. Ordinary menu/native Back still parks the session.

## Final focused evidence

Tested application SHA `338c3d27555a6201e15ae5e85841fec47774a9ce`. [Immutable Netlify Preview](https://6ade583710baf8078474cb5a--playkcswh.netlify.app/poker/), ready/exact commit_ref confirmed. Later evidence-only commits do not change runtime. [Session evidence](evidence/preview-t009-t012-2026-10-25.json), [portrait](evidence/preview-t009-portrait.png), [landscape](evidence/preview-t009-landscape.png).

- Portrait412×915: screen(0,0,412,915), Hero cards y799.69,h88, two cards visible. Landscape915×412: screen(0,0,915,412), Hero cards y321.90,h68.41. Existing V2 scene/controls/styles, active avatar clock present. Browser geometry is PASS; physical safe-area/rotation is still an owner gate.
- Hero real20s deadline observed with legal FOLD, source=timeout. Canonical CHECK path covered by fundamental test. Auto-next **3003ms** after settlement, hand counter1→2, no button required.
- Bot scheduled delays1016–1877ms; measured1019–1883ms in this run. Shared strategy unchanged. First settled stacks100/104/96,total300,pot0.
- Actual UI Rebuy wallet4900/stack98→wallet4898/stack100 (sum4998 unchanged); free Refill wallet5000; parked clock2796ms persists/resumes without charging lobby time. Explicit Leave produces wallet5100/sessionnull: includes intentional free local refill, not online earnings or CH.
- Custom New Game Cancel, Reset Escape, Leave Escape and explicit Leave confirmation PASS. Back/Resume preserve ID and parked hand budget; physical native Back remains pending owner. No system confirm remains in Offline bootstrap.
- Network disabled after table load: **0 requests/0 fetch/XHR/WS/beacon attempts**,0JS errors. Generic lobby/navigation loads are outside this isolated phase. An initial temporary probe read Refill before its asynchronous locked write; corrected harness waits for committed revision/balance. No wallet fix or extra gameplay infrastructure was needed.
- Runtime CI, CodeQL, required Netlify and initial Stage APK workflow40226152100 SUCCESS. No WS/shared runtime/Online renderer/CSS diff, so no WS Preview rerun. No Production/merge/migrations/remote finance.

Compatibility: Offline v1 key/schema retained; optional clock/last-action fields initialized on Resume without changing tableId/stacks/wallet/theme. Old APK ignores extra fields, can still load the local session, but lacks new timing/UI behavior until updated. This is not bidirectional synchronization. Failed writes preserve prior record; old callbacks cannot apply across revision/hand/table/actor changes. No public Online breaking change; deliberate Offline UX changes are auto-next,20s CHECK/FOLD, paused background budgets and replacing system popup.

New Stage APK uses existing native table-mode inset owner for both Online and Offline paths and the same env→native variable transformation; packaged renderer SRI/CSP is recomputed after that existing transformation. Owner must retest S24+ cold airplane launch, portrait/landscape/cards, countdown/action timing/auto-next/bust stop, PC Rebuy/Refill/Leave, Back/process-kill Resume/background/rotation, themes and reconnect privacy. **Retain Draft; no merge-ready claim before this physical re-test.**

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
