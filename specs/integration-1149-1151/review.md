# Temporary #1149 + #1151 integration — DO NOT MERGE

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
