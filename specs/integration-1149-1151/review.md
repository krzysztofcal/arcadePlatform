# Temporary #1149 + #1151 integration — DO NOT MERGE

**CURRENT — owner-accepted final review: READY FOR ROLLOUT REVIEW. Production rollout BLOCKED by a separate pre-existing supervisor error found in read-only preflight; neither source PR merged.** Prior NOT READY/FAIL/BLOCKED statements below are historical attempt outcomes, preserved with their evidence. The explicit current owner acceptance supersedes the former SP UI ACK gate; ACK remains NOT OBSERVED.

Purpose: test the two approved fixes together. This is not a new feature, replacement source PR, or authorization to deploy. Source PR branches remain unchanged. No Offline code/commits.

## Inputs verified from GitHub

- main: `6ecbc8a36a19952b7e86255436e8be903ea5d646`.
- #1149 HEAD/runtime: `f39d9695da5c00ee1ff59498aeba3806d2483cd8`, Draft.
- #1151 HEAD: `4fd5a2b8f4b2f16333ed7d6d8839a3b086913939`, Draft; latest runtime change `1226167c8fd77d77307f5cb097a4cc9d57e477f9`.
- #1151 runtime includes prerequisites `8ca505906f586878ce2e7ea9b1519510a3db8901`, `cafc87d7b49083065a762c681e26a14f8094133c`, `1226167c8fd77d77307f5cb097a4cc9d57e477f9`; its HEAD adds historical smoke evidence/docs only.

Applied the #1149 commit and all four #1151 commits in an isolated integration worktree. No textual conflict. The published temporary branch is a single integration commit from the pinned main, with these source patches/provenance retained here. Final exact SHA is in the integration PR body and handoff (self-referential commit SHA is not embedded here).

## Historical retry diagnosis — LIKELY, not CONFIRMED

Source evidence: `specs/1150-ws-leave-audit/review.md` and `preview-smoke-2026-10-25.json`. Table `2d200475-11f7-4069-8377-0ab8b9e9590f`; requestId `leave_1151_mvnjth7c`.

| Question | Finding |
|---|---|
| Browser sent retry? | CONFIRMED: framesent at 2026-10-25 08:13:55.909 UTC on authenticated, connected socket3. This is not server-receipt instrumentation. |
| Client deadline? | CONFIRMED: timeout08:14:07.915, elapsed12.006s; existing12s client timeout unchanged. |
| Bots still in current hand? | CONFIRMED: browser received ongoing bot snapshots; bot-only hand `_182_5` settled08:14:29.139390, 33.230390s after retry send. |
| WS received exact frame / enqueue time? | UNKNOWN: no correlated receiver/enqueue event is retained. |
| Waited behind bot_step? | LIKELY: source has one per-table FIFO for bot_step and Leave; #1151 adapter still passed maxActions1 but bots-only hard cap80, shared loop takes their maximum. Recorded bot-only activity outlasts deadline. |
| Server eventually processed/replied to this retry? | UNKNOWN: no retry ACK/handler record; client closed after deadline. Journal window08:13:40–08:15:00 has no entries. Do not infer receipt/completion from a later hand/version. |
| Ledger result? | CONFIRMED: one user cashout, no second payment. Existing poker_requests row and LEAVE_TABLE action both date08:11:15.720292/v146, the original Leave. Idempotent replay does not create a new durable completion event, so their presence proves neither retry receipt nor completion. |

No logging configuration changed, no retry was re-sent and no Stage/Production mutation was performed during this diagnosis. The missing historical transport/queue timestamps cannot be reconstructed honestly. DB/frame-delivery delay or another unlogged failure cannot be categorically excluded.

Local controlled code comparison confirms the **mechanism**, not the particular network event: the same deterministic FIFO test on exact main and on exact #1151 runtime fails both Online and folded-human variants with **12 actions before admission, expected1**. The integrated code serves JOIN, Leave and Leave-retry admission boundaries after **one action**, before settlement, then legally completes the hand. This demonstrates the queue defect already exists in main, not a new queue-budget regression introduced by #1151. It does not retroactively upgrade the historical request outcome to CONFIRMED.

## Exact runtime composition / semantic review

Runtime files were compared byte-for-byte with their source revisions:

| Integration file | Exact source |
|---|---|
| ws-server/poker/runtime/accepted-bot-autoplay-adapter.mjs | #1149/f39d9695 |
| ws-server/server.mjs | #1151/1226167c |
| ws-server/poker/handlers/leave.mjs | #1151/1226167c |
| ws-server/poker/runtime/account-deletion.mjs | #1151/1226167c |
| ws-server/poker/table/table-manager.mjs | #1151/1226167c |

No extra runtime edit beyond their union. Relative to #1151 HEAD: add #1149 adapter/runtime tests + historical1148 specs; relative to #1149 HEAD: add #1151's files. Integration-only additions: this report and a small extension of the existing queue regression's pending callbacks to JOIN + Leave + Leave-retry. No feature code, test framework, dependency, workflow/configuration, migration, ledger, strategy, rules or protocol change beyond the approved source patches.

- #1149 bounds only the accepted WS bot executor (maxActions1, botsOnlyHandCompletionHardCap1). Existing cascade schedules the next FIFO step. Shared loop/global legacy/post-Leave budgets remain unchanged.
- #1151 Leave/retry reloads current canonical state, not a public response. The next queued bot step re-reads version/actor/legality, so a step cannot intentionally use a pre-Leave snapshot. Existing delayed-actor/version and reconnect tests are included.
- Account Deletion V2 is active on Production. Its existing coordinator owns the same FIFO, fences mutations, reloads and unblocks; poker phase resyncs pending reloads before SQL seat scan/BURN. One-action bot yielding permits that command between actions. No nested enqueue was introduced; scheduler follow-up is deferred.
- Lifecycle/lease checks, canonical cashout/BURN idempotency and Auth-last are unchanged. Recovery after committed cashout/failed reload and lost BURN response is exercised by the existing local PGlite regression.
- Folded-human Single Player uses the same one-action cascade, retains current hand universe and finishes with conserved CH; terminal/deferred Leave uses existing authoritative accounting tests. The full browser chain remains part of Preview smoke, not claimed by component tests.
- Public snapshots/Leave responses still strip the private map; full reload uses current hand, never a private-map copy across handIds.

No semantic conflict found within local tested contracts. Main risk remains newly permitted command interleaving and external DB/transport latency, requiring runtime verification. More FIFO entries/re-entry per bot action; per-action persistence count remains unchanged. Full Leave reload still adds the existing bounded reads. Local fake-clock tests do not establish a12-second network SLA.

## Fundamental validation

- Queue + accepted bot adapter: 45/45 PASS. Extended existing two-case regression proves all three queued command boundaries are serviced after1 action; legal/version-ordered bots continue, unique requests, one write/reaction per action, payout/contribution equality, 200/300 CH conserved.
- Control checkouts (local only, no services): same two tests on main and #1151 runtime each give expected RED12≠1. Their production code was not edited; only the integration test fixture was run in a detached control checkout. No source PR ref changed.
- Domain/Leave/private-map/audit/retry/Account Deletion/Redis/avatar/retirement/bootstrap: 118/118 PASS.
- Live-local WS server/reconnect/Leave race: 162/162 PASS.
- Root `npm test`: exit0, **148 groups PASS**; CI results are reported in the integration PR. Existing optional disposable PostgreSQL checks may skip without configured test DB; no hosted DB/provider is used for these tests.
- Queue admission callbacks are deliberately domain-neutral; they do not pretend to fund a JOIN or execute cashout. Real domain behavior is tested separately by existing authoritative Leave/PGlite/handler suites. No broad UI test suite added.

## Breaking impact / boundaries

No additional protocol, economic, schema or environment change. The source #1151 removes unused internal restore APIs after its consumer audit; no new public breaking impact from integration. No Production/WS Preview deployment, real deletion, hosted-data mutation, fault injection, merge or source PR update. A temporary integration Draft PR exists solely for review/CI and must not be merged to main.

## Prepared bounded exact-SHA Preview smoke — separate owner GO required

1. Recheck current main/source heads for drift, shared WS Preview connections, human seats/places, pending Poker/deletion operations, escrow/ledger/state agreement, previous test cleanup and concurrent work. Stop BLOCKED if occupied or ambiguous; never disturb others. Use the approved dedicated Stage identity and100 CH tier; no automatic funding/bonus claim.
2. After separate deploy GO: manual WS Preview Deploy workflow definition main, application **exact integration SHA from handoff**. Confirm workflow input/resolved SHA, installed metadata, restart/PID, all five runtime module hashes and healthz. Do not change configuration/secrets. Netlify preview must correspond to the same source/runtime bytes. No Production.
3. One Online JOIN during an existing bot-only hand. Capture requestId, commandResult/seat timing and WAITING_NEXT_HAND/current-pot exclusion. Require admission before full hand completion, not merely later seat appearance; no UI timeout increase.
4. Automate the next legal human action and in-hand ordinary Leave without an observation pause that lets the human turn timer expire. Capture original map read-only before Leave, leave requestId, server result and client RTT. Preserve existing12s client deadline.
5. Reconnect as observer, then send **one** retry of the same Leave requestId during bot-only play. Require observed accepted ACK **before12s** and no extra buy-in/cashout. A late row or payout is not a PASS. Capture server receiver/queue/bot-step/reload timestamps only if already available; any use of existing table-scoped TTL DEBUG requires explicit owner authorization, never enabled silently. Without it, mark unmeasured spans unavailable, not invented.
6. Observe legal bots/settlement. Require HAND_SETTLED OK, no STARTING_STACK_DERIVED, identical complete original map, all accounting deltas0. Confirm exact cashout tx, before/after wallet, bot funding/escrow/state, no orphaned human claim and no map in public frames. Use reduced evidence only, no JWT/cards/private snapshots. Separate measured whole-command latency from any actual reload span; no improvement claim without comparable measurements.
7. If healthy/safe, one Single Player manual FOLD → bots continue → settlement/audit → ordinary Leave. Verify CLOSED, refund, escrow0, no orphan and unchanged single-refund counts. No Account Deletion test; its local fundamentals suffice for this authorization boundary.
8. On timeout, unclear operational result, audit/CH/privacy discrepancy: stop further gameplay mutations, read-only reconcile, no fault injection, repeats, balance/history repair or silent timeout workaround. Report PASS/FAIL/BLOCKED honestly, retain Draft and stop for review.

Recommendation after green local/CI: **GO for the separately authorized bounded integration Preview test**, not merge-ready and not a deploy authorization. Historical timeout cause remains LIKELY until better evidence; integration smoke can validate the combined behavior, not manufacture missing historical logs.


## Authorized exact-SHA Preview attempt — 2026-10-25

**Verdict: NOT READY. Deployment PASS; required gameplay smoke BLOCKED before JOIN.** Do not interpret the local/CI results or deployment as completed integration verification. Source PRs remain unchanged and Draft; temporary #1152 must not be merged.

Preflight: #1152 HEAD matched approved `33fbe284859884fd2538774ae756f11aee154a04`, CI green. No active Preview port3001 connections, active human stacks or concurrent live agents/deploys. Five OPEN tables contained only three bots/300CH escrow each. No pending Poker requests/deletion work observed. Previous table `2d200475-11f7-4069-8377-0ab8b9e9590f` CLOSED, escrow0. Old harness processes had finished reports and no live WS; not killed. Dedicated Stage wallet454CH. Root workspace unrelated changes untouched.

Manual [WS Preview Deploy run40178548341](https://github.com/krzysztofcal/arcadePlatform/actions/runs/40178548341) used workflow definition from main `6ecbc8a36a19952b7e86255436e8be903ea5d646`, application exact `33fbe284859884fd2538774ae756f11aee154a04`, existing Redis version3 input. SUCCESS. Installed release metadata matches exact SHA/ref/preview. Journald confirms stop/start08:56:16UTC, PID285476→295769; service active. Local/public healthz both200/ok. Five SHA256 module hashes equal source bytes (see evidence JSON). No configuration/secrets/logging changed.

Authenticated browser verified Netlify #1152 build-info commit equals runtime SHA, Preview flag, pinned Stage project and WS Preview URL. Actual browser sockets connected to `wss://ws-preview.kcswh.pl/ws`. No private `handStartStacksByUserId` appeared in observed spectator frames, but funded Leave privacy remains untested.

At08:57:45.021, observer saw table `251abfb6-b333-4791-b446-536f4ff7f09f`, RIVER hand `ws_hand_251abfb6-b333-4791-b446-536f4ff7f09f_106_3`, three bots/no human seat. Playwright selected `#pokerSpectatorJoinIntroBtn`; click timed out after30000ms at08:58:15.077. Browser captured **zero join/act/leave frames**. No JOIN requestId exists; no server ACK latency can be measured. The saved locator error is truncated, so precise DOM/actionability cause is UNKNOWN; do not infer a WS queue regression. This was an automation failure before dispatch, not a measured JOIN/Leave/retry ACK failure. An initial local harness startup also failed before opening a browser because its read-only DB probe could not open the root-owned service env file; no secrets/permissions were changed, and evidence reads used Stage MCP instead.

| Scenario | Result |
|---|---|
| Preflight / exact-SHA deployment / restart / five hashes / health | PASS |
| Matching Netlify source, Stage auth, actual WS Preview transport | PASS |
| Observer bots continue across RIVER settlement/next hand | Observed; not funded audit verification |
| Online JOIN ACK / WAITING_NEXT_HAND / exclusion from pot | BLOCKED — click never dispatched JOIN |
| Legal human action / in-hand Leave ACK | BLOCKED — not run |
| Original private map / target settlement audit / accounting deltas | BLOCKED — target human hand never created |
| Reconnect and same-request Leave retry ACK<12s / single cashout | BLOCKED — not run |
| Single Player FOLD→bots→settlement→Leave | BLOCKED — not run after stop |
| Real Account Deletion | NOT RUN by authorization boundary; local fundamentals only |

Read-only reconciliation after stop: wallet454→454CH; zero user transactions/Poker request records since08:55UTC; no human seat created. Observer table subsequently CLOSED by ordinary lifecycle, escrow0/human seats0. No financial test transaction IDs exist. No cashout, funded escrow or settlement claim can be made for the requested scenario. No later gameplay command, repeat attempt, manual correction, fault injection, real deletion, Production operation, merge or source PR modification followed the timeout.

[Reduced deployment/smoke evidence](preview-smoke-2026-10-25.json). JOIN/Leave/retry ACK timings: **unavailable**, not zero and not PASS. Historical retry diagnosis remains LIKELY/UNKNOWN as above; this attempt does not resolve it.

Next review: correct only the temporary browser harness's join actionability/selector handling, retain complete sanitized locator diagnostics, then seek owner GO for one bounded resumed smoke after fresh preflight. No product/runtime fix is justified by this evidence. The runtime remains installed at the approved SHA. The prospective #1149→main→Production, rebase/verify #1151→merge→Production, close #1152 without merge sequence remains **conditional on all required smoke gates passing and separate owner GO**; no progression is recommended now.


## Authorized single resumed smoke — 2026-10-25, 12:20–12:29 UTC

**LATEST VERDICT: NOT READY. Online runtime gates PASS; required Single Player manual FOLD/ordinary Leave blocked by a confirmed Preview overlay.** This supersedes the earlier pre-JOIN blocker, not its historical evidence. No deployment, Production operation, configuration/secret/permission/log-level change, product code, source PR update or maintained UI test was made in this resumed task.

### Harness correction and historical click diagnosis

Only temporary `/tmp` browser automation changed. JOIN now waits on DOM: intro hidden; standard `#pokerV2JoinBtn` visible/enabled; `poker-join-btn--intro-target` and `--settled` absent. It checks current authoritative spectator/bot-only active hand, button bounding box/computed pointer-events and `elementFromPoint` hit target, then Playwright trial actionability and an ordinary click. No force click, handler invocation or direct WS JOIN. The successful readiness evidence records hidden/disabled/classes/box/pointer-events/interceptor. Failure capture retains the full sanitized Playwright message/stack plus DOM diagnostics; no credentials/JWT/cards/private snapshot stored.

Previous08:58 intro-click timeout cause: **LIKELY temporary-button/animation race; not CONFIRMED**. Source shows1800ms intro+550ms fly+hidden target. Standard-button path now succeeded. Historical truncated error cannot exclude another interceptor. A later **different** FOLD click is conclusively intercepted by Netlify Drawer; that must not be retroactively asserted as the historical JOIN cause.

### Fresh preflight / runtime provenance

Runtime metadata remains exact `33fbe284859884fd2538774ae756f11aee154a04`; PID295769 and start08:56:16UTC unchanged. Rechecked all five module source/deployed SHA256 comparisons PASS and public healthz200/ok. No new deploy. Initial shared-host scan: zero WS connections, active/nonzero human claims, pending Poker requests or deletion requests; five bot-only OPEN tables each300CH escrow/stacks. Previous observer table CLOSED/escrow0. No other live agents/deploy workflows. Dedicated Stage wallet454CH.

Netlify #1152 served docs-only HEAD `4bc5512ea2b9fed618651960753447d8afb67fed`, Preview flag and WS Preview URL. Diff from runtime contains only two spec/evidence files, so deployable/browser bytes unchanged. Auth verified pinned Stage project `krydukthwdvccggbyjfw`; actual sockets `wss://ws-preview.kcswh.pl/ws`. Source heads remain #1149 f39d9695 / #1151 4fd5a2b8, Draft and untouched.

### Online — PASS, with automation limitations below

Table **64bba5ce-7431-45d9-a51c-4bab29a2c1d0**. JOIN `join_mvnsqtri_qn0i883b` sent12:21:05.461; accepted ACK12:21:08.030: **2569ms**. Seat4 observed12:21:08.071 snapshot (2610ms from send; harness assertion completed08.076), `WAITING_NEXT_HAND`, no cards/bet contribution. Same joining hand `ws_hand_64bba5ce-7431-45d9-a51c-4bab29a2c1d0_232_3` remained active; durable settlement12:21:30.142256, over22s after ACK. Existing lifecycle normally funded a fourth bot; this is not a new integration feature.

Next human hand **ws_hand_64bba5ce-7431-45d9-a51c-4bab29a2c1d0_245_5**. Real-turn UI CALL `ws_1a173029d70_34190a2a` sent12:21:53.652, accepted53.887 (**235ms**); no human turn timeout in this Online scenario. In-hand Leave **leave_1152_mvnsrv6v** sent12:21:53.973, accepted12:21:57.795 (**3822ms**, existing12s deadline unchanged).

Private start map captured before CALL/Leave at v250 and after Leave at v253: same target hand, five entries/500CH, identical fingerprint. Target HAND_SETTLED v259 at12:22:15.643127: **integrity OK**, flags[], starting/ending500CH, contributions/payout20CH, pot/stack/payout deltas0. Audited starting stacks reconstruct the identical complete original map. Post-Leave bot actions v254–259: CALL,FOLD,CHECK,CHECK,CHECK,CHECK; FLOP→TURN→RIVER→SETTLED, no illegal-action error. No cross-hand metadata copying was performed.

Cashout after deferred settlement: buy-in tx **38cc2a85-cc22-494b-85fb-f533fa4094e2**100CH; cashout tx **519a02e7-271f-4dd7-b675-53a8c12c4f08**96CH at12:22:20.794567. Wallet **454−100+96=450CH**. Escrow300 initial+100human+100ordinary bot seed=500; after human cashout404CH, all bot liabilities. At12:24:46 read-only runtime-financial persistence386 stacks+18 pot=404 escrow, no active/nonzero human claim.

Normal fresh observer reconnect at12:24:45.149 saw seatnull/bots4; **no JOIN/buy-in** on reconnect. Exactly **one** retry of `leave_1152_mvnsrv6v` sent12:24:46.773 during bot-only PREFLOP hand `_300_4`; actual accepted WS commandResult12:24:48.197 (**1424ms**, before12s). One buy-in and one human cashout still; wallet450/escrow404, pending0. Reused durable request row is not used as ACK proof—the captured received frame is.

Automation limitations, retained transparently: the first harness waited for a settlement snapshot after Leave had unsubscribed the socket; settlement was instead verified read-only. That observer-only wait eventually expired (no outstanding game command). Remaining authorized steps used fresh observer/Single Player harness segments, without another Online JOIN or another retry. The retry segment also made a **false harness assertion** on `p.status`; actual `sendLeave()` resolves `{ok:true,...}` and omits status (poker-ws-client.js handleCommandResult). Its captured WS payload unambiguously contained accepted/1424ms; read-only accounting confirmed no duplicate. No product/protocol change and no command re-send were used to fix that assertion. Do not describe all temporary script exit/assertion results as green.

### Single Player — JOIN PASS; manual FOLD/Leave BLOCKED

Table **30f558a9-3f28-4d26-8cfc-077597215a2c**, hand **ws_hand_30f558a9-3f28-4d26-8cfc-077597215a2c_1_3**. JOIN `join_mvnswpes_w7feiiuq`: sent12:25:39.754, accepted12:25:41.479 (**1725ms**). Human real turn/three-entry300CH map captured. Playwright tried normal `#pokerV2FoldBtn` click; full error confirms **iframe title="Netlify Drawer" intercepts pointer events** repeatedly. At12:26:13.350 click reached30s timeout. No client ACT/FOLD or Leave frame was sent. Actual human FOLD at12:26:01.470487 has `source=timeout` and timeout requestId—**not manual FOLD PASS**. Subsequent bot FOLD settled v4 with integrityOK/flags[]/all deltas0,300CH total and original map fingerprint; observed only, not fulfillment of the requested manual chain.

Stopped further game mutations after click timeout. No manual Leave/ledger repair. Browser closed; ordinary existing lifecycle subsequently settled next hand v16 at12:27:16.833650 (OK,300CH,6CH pot,all deltas0) and auto-cashed out/closed table at12:27:21.977784. Human refund98CH (tx **1a3c476f-22d2-48e4-9edd-ab78f088b928**), bots103+99CH. Wallet **450−100+98=448CH**. All seats INACTIVE/stack0; escrow0. This confirms cleanup/reconciliation, **not ordinary UI Leave PASS**.

### Final reconciliation / privacy / decision

Read-only final12:28:56: both test tables CLOSED/escrow0, zero active/nonzero human claims and pending Poker requests. Online lifecycle refunded remaining bot stacks122+54+107+121=404CH at12:28:47.626586. All captured escrow-related transaction sums0, including normal bot seed transactions. Wallet total **454−100+96−100+98=448CH**: Online loss4CH + subsequent SP lifecycle hand loss2CH. No unexplained discrepancy or duplicate human cashout. No `handStartStacksByUserId` key in any observed incoming WS response/public snapshot across the segments; original maps are represented only by count/total/fingerprint, no cards/JWT/full private snapshots.

| Required gate | Result |
|---|---|
| Runtime/source/Stage/WS/preflight | PASS |
| Standard DOM-ready JOIN during bot-only hand; waiting/exclusion | PASS,2569ms ACK |
| Real legal Online action; active-hand Leave | PASS,235ms/3822ms ACK |
| Original map survives Leave; bot continuation; auditOK/zero deltas | PASS |
| Online cashout/escrow/conservation/no duplicate | PASS |
| Observer reconnect/no JOIN + exactly one same-id retry | PASS,1424ms observed ACK |
| Observed WS/public-map privacy | PASS within captured-frame scope |
| SP JOIN | PASS,1725ms ACK |
| SP manual FOLD → bots → ordinary Leave | **BLOCKED**, Netlify Drawer interception; auto-FOLD not substituted |
| SP eventual lifecycle settlement/refund/closure | PASS read-only cleanup, not ordinary Leave verification |
| Real Account Deletion | NOT RUN; existing local fundamental coverage only |

[Reduced resumed evidence, full sanitized failure, audit/transactions](preview-resume-2026-10-25.json). Existing runtime CI/local fundamental results remain valid; this follow-up is docs/evidence only. No additional public breaking impact or runtime regression demonstrated. **Separate finding: Netlify Preview Drawer blocks the SP Fold control in the1440×1000 browser viewport.** No application/Netlify configuration fix or drawer bypass was applied. A future authorized bounded SP-only attempt should first verify the Drawer can be dismissed through its normal UI and hit-test Fold; no repeat is authorized by this report.

**NOT READY for complete integration verification or downstream rollout.** Online gates are now evidenced, but SP manual scenario remains open. Do not execute the proposed #1149→main→Production, update/verify #1151→merge→Production, close #1152 sequence now. Keep all PRs Draft; seek separate owner review/GO for any remaining smoke or rollout. No performance improvement claim: measured client RTTs include queue/DB/transport; reload-only latency was not separately observable with existing logging.


## Final authorized SP-only smoke — 2026-10-25, 12:46–12:53 UTC

**LATEST VERDICT: NOT READY — manual SP FOLD/settlement and ordinary UI Leave financial effects PASS, but the required observed Leave ACK<12s remains unverified.** No Online replay, deployment, product code/configuration/secret/permission change, source PR modification, new maintained UI test, real deletion, Production or merge.

### Preflight and Drawer

Exact Preview metadata `33fbe284859884fd2538774ae756f11aee154a04`, same PID295769/start08:56:16UTC; five module hash comparisons PASS, healthz200/ok. Live main still6ecbc8a3. No active WS connections/human claims/pending requests/deletions/other live agents; five OPEN bot-only tables each300CH escrow/stacks. Previous SP CLOSED/escrow0. Stage wallet448CH. Netlify Preview #1152 served docs-only `a6f5ea26ba167f57b162a88c40969a4504b24e56`; diff versus deployed runtime only spec/evidence files. Pinned Stage Auth and actual WS Preview transport verified.

**`ntl-drawer-state=hidden` effective, CONFIRMED.** Used query option on initial account/lobby addresses and preserved all page parameters when appending it to navigated URLs in the temporary browser context (`history.replaceState`, no game handler call). Official Netlify injected script recognizes the option and persists hidden state. Before funded JOIN, iframe count0. On real turn, Fold DOM: visible/enabled, pointer-events auto, bounding box x1035/y930/90.5×50; elementFromPoint returned Fold button, iframe count0. URL retained tableId/seatNo/autoJoin plus hidden option. Ordinary Playwright trial actionability and click succeeded. No force click, direct WS FOLD, handler invocation, CSS/app/iframe modification or Netlify configuration change. No manual Drawer fallback was needed.

### Actual Single Player commands and audit

One table **48cd70ff-1704-4f29-ad09-fb6125e05944**, buy-in100CH, hand **ws_hand_48cd70ff-1704-4f29-ad09-fb6125e05944_1_3**. JOIN `join_mvntrubg_2n286rtr`: sent12:49:52.449; actual accepted ACK12:49:54.500 (**2051ms**).

Manual UI **FOLD `ws_1a1731c4a5a_9b09f3b6`** sent12:49:56.318; accepted ACK12:49:56.575 (**257ms**), well before human timer. Durable action12:49:56.391819 has **source=human,isBot=false**, exact requestId. No timeout FOLD substituted. Original three-entry300CH private map captured before FOLD atv2.

Bots legally continued v4–10: CALL,CHECK,CHECK,BET,CALL,CHECK,CHECK; PREFLOP→FLOP→TURN→RIVER→SETTLED. HAND_SETTLED v10 at12:50:19.461327: **OK**, flags[], contribution/payout8CH, starting/ending300CH, all pot/stack/payout deltas0. Audited participant starting stacks reconstruct exactly the original map fingerprint `d18e3d6b1dad36c45acfe2638f40b2be`; three complete entries, no STARTING_STACK_DERIVED.

Ordinary UI menu→Leave→confirm used real buttons; confirm hit-test passed and Drawer count0. **Leave `ws_1a1731cab55_d326da47`** sent12:50:21.145. Browser navigated to lobby (new lobby socket12:50:21.337), but **no received Leave commandResult** was captured during the next12s. Harness observation wait expired12:50:33.256; no further gameplay command followed. This is not a claim of an application pending-command timeout: the normal queued UI path does not register one.

### Read-only diagnosis: existing immediate-navigation Leave contract

`poker/poker-v2.js::leaveAndReturnToLobby()` takes `queueLeaveAndNavigateImmediately()`, which calls `sendLeaveQueued()` and `navigateAfterLeave()` immediately. `poker/poker-ws-client.js::queueCommand()` sends/returns a requestId without adding a pending Promise/timer. Consequently the page may unload its table WS before receipt of a commandResult. The fallback `sendLeave()` await path is used only when queueing cannot run.

These two files are **byte-unchanged from live main6ecbc8a3 to integration33fbe284**. The immediate navigation is CONFIRMED by code and observed browser transition; exact server ACK emission/delivery is UNKNOWN (no per-request journald events in12:50:15–40). This evidence does **not** establish a #1149/#1151 regression or a12s server queue stall. It also does **not** satisfy the user's explicit observed ACK gate. No navigation interception, runtime/logging change, second Leave/retry or silent relaxation to financial completion was attempted.

### Financial reconciliation / privacy

Durable LEAVE request with exact UI requestId has ok=true, timestamp12:50:21.150497. Buy-in tx **28a9ae59-a393-4024-8fbb-463fe01563f5**100CH. Exactly one human cashout tx **3298ef25-7587-407e-9527-4ac01d0e674e**100CH at12:50:21.150497 (ordinary Leave execution, not later cleanup); other cashouts belong to bots. Wallet **448−100+100=448CH**, table CLOSED, escrow0, no human seat/stack, pending0. Every returned ledger transaction sums0. No manual balance/history repair.59 incoming WS frames inspected; no private-map key exposed, and saved evidence contains no card values/JWT/password/private snapshots.

| Required SP gate | Result |
|---|---|
| Correct runtime/Stage/Netlify/health/shared-host preflight | PASS |
| Drawer hidden; ordinary Fold click actionable | PASS |
| Single Player100CH JOIN | PASS,2051ms ACK |
| Real manual FOLD/sourcehuman | PASS,257ms ACK |
| Legal bots / original complete map / HAND_SETTLED OK / flags[] / deltas0 | PASS |
| Ordinary UI Leave actually sent/executed, exactly one cashout | PASS financial/operation evidence |
| **Actually observed ordinary UI Leave ACK<12s** | **NOT VERIFIED**, harness observation timed out after immediate navigation |
| Wallet / CLOSED / escrow0 / no orphan / captured-frame privacy | PASS |
| Earlier Online gates | PASS retained; **not repeated** |

[Full reduced final SP evidence, timings, DOM, audit and reconciliation](preview-single-final-2026-10-25.json). No new breaking impact, regression or economic discrepancy demonstrated; only documentation/evidence changed in this task. Existing fundamental local/runtime CI results remain as previously recorded.

**Do not label READY FOR ROLLOUT REVIEW while the explicit ACK gate is unresolved.** Further review should decide whether the existing ordinary Leave UI contract needs a separate minimal fix to await an accepted ACK (using existing mechanisms), or explicitly approve an alternative verification criterion; neither decision/change is assumed here. Repeating the same immediate-navigation smoke is not a justified substitute. No product fix implemented.

Prepared downstream order remains conditional, with separate GO for each stage: **(1)** #1149→main→Production; **(2)** update #1151 against resulting main, confirm runtime composition equals tested integration plus approved changes, required checks/exact-SHA gates→merge→Production; **(3)** close #1152 without merge. None executed. All source PRs still Draft/unchanged; temporary #1152 remains DO NOT MERGE.


## Owner-accepted final review and conditional rollout preflight — 2026-10-25

**READY FOR ROLLOUT REVIEW** for the tested integration; **Production rollout BLOCKED before #1149 merge**. User accepted Online JOIN/CALL/Leave/retry/reconnect/audit/CH/privacy and SP JOIN/manual FOLD/bots/audit/ordinary UI Leave durable execution/single cashout/closure as PASS. SP UI Leave received ACK remains **NOT OBSERVED**; it is not reclassified as PASS. That existing intentional contract is confirmed in `tests/poker-v2-live.behavior.test.mjs:4922`, test **poker v2 queued leave navigates to lobby immediately without waiting for leave ack**. Targeted existing test run:1/1 PASS. UI/client files unchanged from live main; no UI/protocol fix/new test or smoke replay.

Exact composition review PASS: relative to live main6ecbc8a3, integration33fbe284 contains exactly #1149's accepted-bot-autoplay-adapter runtime file atf39d9695 and #1151's server/Leave/deletion-runtime/table-manager runtime files at1226167c. Source paths are disjoint; all five match byte-for-byte, and no other production path differs in the integration. Integration-only queue assertions/docs do not add production behavior. Existing CI at source heads f39d9695/4fd5a2b8 green; fundamentals and live evidence retained. Deletion coordinator/fence/reload-before-BURN recovery, single cashout/BURN/Auth-last and private-map sanitization remain as tested; no live deletion attempted.

### Production STOP: persistent supervisor invalid_identity

Read-only Production preflight13:07:12UTC: runtime **41bb6185d38201e727cb9953a98b22e9a2711edc**, PID147840, running since2026-10-23 10:13:58UTC. Local/public healthzok and `PASS LIVE Redis V3 prod`. Zero established port3000 connections, active/nonzero human seats, pending Poker requests/deletions, closed nonzero escrows, or running incompatible deployment observed. However, **zero OPEN tables while CONTINUOUS_BOT_DEFAULT is enabled with desired count2**. Journald repeatedly emits **ws_continuous_bot_table_supervisor_failed / invalid_identity / ERROR every10s** (samples12:59:16–13:07:26). Green healthz alone is insufficient to attest application health.

Code path: `continuous-bot-table-repository.mjs::createManagedTable()` intentionally calls `createPokerTableWithState({userId:null,lifecycleKind:CONTINUOUS_BOT,...})`; `poker-table-init.mjs` unconditionally invokes `assertAccountActive(tx,userId)` when Account Deletion V2 is enabled; `shared/account-deletion.mjs::requireUuid(null)` rejects. Exact local function call with enabled flag and stubbed tx confirms invalid_identity **before any SQL/provider call**. All three relevant files are byte-identical in deployed Production, live main and integration; this defect was not introduced by either PR. Existing source/runtime incompatibility with the active deletion guard makes this an operational preflight blocker, not an ACK-gate issue. No observed financial discrepancy; the failing creation path aborts before writes.

Minimal resolution proposal for **separate review**, not implemented: retain human lifecycle fencing; explicitly recognize only the existing trusted system-owned CONTINUOUS_BOT creation path instead of validating null as a human identity, and reject invalid human identities as before. Extend fundamental table-init coverage for enabled-deletion system creation plus deleting-human rejection; no fake user UUID, broad guard disable, data repair, migration or new infrastructure. Then repeat only Production read-only preflight/necessary checks before resuming the already authorized sequence. Do not restart or assume #1149/#1151 fixes this unrelated path.

[Production preflight evidence](production-preflight-2026-10-25.json). No issue matching exact invalid_identity text found in read-only GitHub search; no unrelated issue/code work started. The old deployed release→main includes the previously merged #1143 store-upstash Preview token resolver update: production branch retains UPSTASH_REDIS_REST_TOKEN behavior; neither source PR changes it.

### Deployment effects and handoff

Live `WS Server Deploy` workflow triggers on main push. `deploy` needs impact+validate and deploy_ws=true; accepted WS runtime path changes qualify. It packages the full main application, generates production RedisV3 metadata, atomically switches `/opt/ws-server/current`, restarts ws-server.service and checks local/public health, with existing shared lock/rollback. Netlify production Git builds follow the main merge independently; no WS or Netlify Production event was triggered in this task. GitHub rules require Netlify preview+actionlint with up-to-date base; normal merge must honor them, no bypass. Detailed branch-protection endpoint denied403, but effective branch-rules endpoint was readable; no protection change attempted.

Neither PR transitioned to Ready/merged because the Production gate failed first. #1151 was not rebased/updated against a new main, since #1149 did not merge. #1148/#1150 remain OPEN. #1152 remains OPEN/Draft, READY FOR ROLLOUT REVIEW and DO NOT MERGE; closure is conditional on both successful source rollouts. Conditional sequence remains #1149 merge+verified Production→update #1151 against new main+exact runtime composition/green checks→merge+verified Production→close #1152 without merge. STOP for owner review of the concrete Production blocker. No unrelated branch/integration, configuration/secrets/logging/permissions, balances or Production data changed.
