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

# T025 addendum — current exact-SHA gate remains OPEN

2026-10-26. Owner accepted physical Offline T024 on Galaxy S24+. This does not substitute for WS verification. Historical report below is preserved, including failed JOIN and old PoC scope; earlier T003–T008 restriction was subsequently superseded by owner implementation GO.

Reviewed main `892661f44f4e9fdbe3df24f0553fa1191bf1752e`, PR HEAD `8c05fc11b00586e8944480dec76bfd6b4cd3882c`. Main is included, no conflicts. WS-specific latest change is merge2af27654ea92cc239c763d42b79a140b38cd5bf4; later Offline deployable changes mean select full current HEAD for the next exact-SHA run. New adapter hash ea11185645e0ee557adbccb9d22c0b391f007e3241ae166336170154481903ea differs from ddb21224 smoke; strategy hash8e924c2c24d293b3355b753c26f8143b0f9f8eba4190e38e6a2d4320e9a076ec unchanged. All18moved strategy functions match current main bodies exactly. Queue cap1/env override removal comes from already-merged #1149, not new Offline functionality. #1151/#1153 preserved unchanged.

Current installed Preview metadata read-only: releaseSha/deployRef354af80c0a93d927fb8cf6f827fa77ffad81988c, active PID328965, /healthz ok. This is not #1147 and not permission to replace it. No Stage account/DB mutation or deployment performed in T025.

## Minimal proposed verification — requires separate owner GO

1. Immediately before dispatch, fetch/verify PR/main and prove no executable drift from approved SHA. Check shared Preview reservations/other agents and queued/running workflows, connections, active human seats/operations, prior test seats settled, escrow/ledger reconciliation and Account Deletion activity. Use approved Stage identity/runbook privately. If occupied/unclear or funds not authorized, BLOCKED; no eviction, repair, config/flag change.
2. Existing WS Preview Deploy: workflow definition from current main, application ref **8c05fc11b00586e8944480dec76bfd6b4cd3882c**, xpRedisVersion3. No reconfiguration/Account Deletion activation. Verify workflow SUCCESS; installed metadata and actual process start/PID; selected strategy/adapter SHA256 above; Stage generated deploy context, local/public health. Match Netlify web build info to reviewed code, pinned Stage Auth and wss://ws-preview.kcswh.pl/ws. Green validation or workflow definition SHA alone is insufficient.
3. Online, one controlled ordinary UI JOIN during bot-only hand: retain requestId/ACK/seat timings (<existing30s), WAITING_NEXT_HAND and exclusion from current pot. Wait for human hand, perform one legal UI action before timer. Observe canonical bot continuation and settlement integrity OK/no starting-stack derivation/zero deltas. One reconnect without extra buy-in: same seat/hand/legal state/private cards only to owner. Ordinary Leave, ACK under existing12s where observable, exactly1cashout, wallet/escrow/seat closure reconciliation. Do not repeat broad #1152 retry/Account Deletion fault campaigns.
4. Only after Online PASS and safe shared state: Single Player ordinary UI JOIN, one legal human action/FOLD (not timer), bot continuation to settlement/integrity OK/zero deltas. Basic reconnect can be covered Online once, no need duplicate full scenario. Ordinary UI Leave; durable exactly-once cashout/table closed/escrow0/no human stack. Existing Single Player UI immediate-navigation contract may make ACK NOT OBSERVED; record accurately, verify durable result instead of claiming receipt. No UI/protocol changes.
5. Keep a compact record of table/hand/request/transaction IDs, action source, timings, starting/ending wallets and escrow, integrity/CH conservation and absence of private-map leak. Stop all further mutations on timeout, unclear result, audit/financial discrepancy or leak; bounded read-only reconciliation only. No manual financial cleanup. No Account Deletion/Production/fault injection. Preserve approved Offline physical results without replay.

Completion closes only the WS integration gate. Merge/Production still require explicit owner authorization, fresh relevant preflight and all current checks/review rules. If merge-only is desired, apply/verify the separately approved independent WS workflow disable plus Netlify stopped-build controls described in review.md before merging; never rely on skip-netlify for WS.

---

# PR #1147 — authorized WS verification, stopped at Online JOIN

2026-10-24. Owner accepted T001/T002 as architectural PoC and authorized only exact-SHA WS Preview deployment plus Online/Single Player smoke and CodeQL verification. PR stays Draft. No T003–T008, Production action, migration, manual ledger/economy modification or merge.

## Deployment: PASS

- [WS Preview Deploy run 40136231798](https://github.com/krzysztofcal/arcadePlatform/actions/runs/40136231798), validate and deploy jobs successful.
- Workflow definition dispatched with `--ref main` (definition commit `6ecbc8a36a19952b7e86255436e8be903ea5d646`). Application input `ref=ddb21224d99e07dead0164bf14dcbfb52356dec4`, `xpRedisVersion=3`.
- Before dispatch: no pending/running WS Preview Deploy, 0 established port-3001 connections in repeated checks, Stage aggregate 0 active human seats and 0 human seats seen in preceding 10 minutes. No formal Preview reservation mechanism found. Previous release `edf9fb3a86b73da2e5b921dce4053280c50f0902`.
- Installed `/opt/arcade-ws-preview/ws-server/release-metadata.json` before and after smoke: `releaseSha` and `deployRef` exactly **ddb21224d99e07dead0164bf14dcbfb52356dec4**, environment `preview`.
- Active systemd process PID `235587`, started **21:54:50 UTC**, working directory `/opt/arcade-ws-preview/ws-server`; journal confirms restart. Public `https://ws-preview.kcswh.pl/healthz` returns `ok`.
- Installed strategy SHA-256 `8e924c2c24d293b3355b753c26f8143b0f9f8eba4190e38e6a2d4320e9a076ec`; installed accepted-adapter SHA-256 `aab8600c02da092ea79b91723b29186280bc255a82f4a72b5adb9a55ab8815aa`. Both byte-for-byte match files from the selected Git commit. This is deployed-artifact/process evidence, not a claim based on CI/Netlify alone.

## Browser smoke: STOP / incomplete

Browser used normal email/password sign-in from `/account.html` at `https://deploy-preview-1147--playkcswh.netlify.app`, verified pinned Stage Supabase project `krydukthwdvccggbyjfw`, fresh dedicated test credentials loaded privately. Observed only `wss://ws-preview.kcswh.pl/ws` sockets. Served web commit `92c1a431` includes only documentation/evidence after the selected runtime SHA. No protocol mocks, injected identity, direct gameplay API substitution or modified app code.

Preliminary diagnostic attempts ended before gameplay because of harness session polling/build-info-page assumptions; these were corrected against actual APIs. Successful login and lobby readiness were then observed. No join was sent by those preliminary attempts.

| Scenario | Result |
| --- | --- |
| Stage login and both lobby mode controls | PASS: normal authenticated login; Online and Single Player enabled after progression loaded |
| Online quick-seat routing and WS connection | PASS: normal PLAY NOW route to table `baae0c75-86b5-4ba1-8342-faee155d049b`, suggested seat 4; WS Preview connected |
| Online joined human snapshot | **NOT PASSED:** JOIN sent 21:57:48.501; no assigned human seat snapshot by 21:58:16; probe timed out and stopped |
| Player betting actions | NOT RUN: 0 user `act` frames, 0 human action rows during probe |
| Shared bot decisions | OBSERVED: canonical accepted runtime emitted RAISE/CALL/CHECK/BET actions and advanced streets; not a completed human-game smoke |
| Settlement | OBSERVED for the already-running **three-bot hand only**, not human participation: HAND_SETTLED at 21:58:25.848, computed payout 30 CH, integrity OK, all conservation deltas 0, starting/ending total 300 CH |
| Basic reconnect | NOT RUN after stop |
| Single Player join/actions/bots/settlement/reconnect | NOT RUN after stop |

[Browser evidence](evidence/ws-preview-smoke.json) records safe snapshot summaries, WS endpoints and JOIN frame metadata. No passwords, JWTs or browser storage state are included. Temporary browser context was closed; local session logout was requested. No further gameplay/rejoin/cleanup command was sent after the failed scenario.

### Read-only cause investigation

At final observed browser snapshot, public hand was TURN with three bots, human seat null and no legal human actions. No JS or WS `error` frames were recorded; `commandResult` frames were not retained, so the evidence does not establish their status/reason. Do not claim an explicit server rejection.

Subsequent Stage reads showed human seat 4 created at **21:58:26.037**, last-seen **21:58:27.095**, after the three-bot hand settled and after the browser probe had stopped. Therefore JOIN was eventually admitted, about 37.5 seconds after its frame, near the hand boundary. The immediate failure is a **30-second joined-snapshot timeout during an existing bot hand**. Evidence cannot distinguish an overly short diagnostic bound from an unacceptable admission/queue delay; it is not proof of permanent JOIN failure or of strategy extraction causing the delay. A targeted follow-up must capture JOIN commandResult/queue timing and wait-state presentation, without bypassing normal admission. Do not silently rerun with a longer bound and call the gate passed.

The delayed JOIN created a real Stage seat after the browser had closed. No Leave/cashout/repair was submitted afterward; ordinary timeout/lifecycle may continue. No user action, funding, bonus claim, migration or Production transaction was initiated by the diagnostic. The authorized quick-seat/JOIN itself may move normal Stage CH; this is not a zero-financial-effects claim.

## CodeQL: previous neutral resolved, no new generator alerts

- The earlier `neutral` message reported a missing comparison configuration `/language:javascript-typescript` relative to `main` while analysis results were incomplete.
- [Dynamic CodeQL run 40135152128](https://github.com/krzysztofcal/arcadePlatform/actions/runs/40135152128) for exact SHA **ddb21224d99e07dead0164bf14dcbfb52356dec4** now has successful actions, JavaScript/TypeScript and Python analyses. JS/TS finished 21:40:48 UTC.
- [The same CodeQL check 120995126197](https://github.com/krzysztofcal/arcadePlatform/runs/120995126197) now reports **success**, **“No new alerts in code changed by this pull request”**, **0 annotations**. The neutral state was not the final result; no CI change was needed.
- Before the generator fix, [check 120994453842](https://github.com/krzysztofcal/arcadePlatform/runs/120994453842) reported two high alerts at generator line 53: incomplete multi-character sanitization and case-sensitive HTML filtering. SHA ddb21224 removes that regex transformation and rejects remaining script markup; final CodeQL no longer reports them as new alerts.
- Diff against `main` has **no workflow configuration changes**. The token cannot read the code-scanning alert-management API (403), so this confirms successful complete analysis/no new reported PR alerts, not an independently inspected historical alert object's `fixed` field.

## Verdict

**Online regression risk is NOT closed.** Exact-SHA deployment and shared bot execution/three-bot settlement are confirmed, and CodeQL is now successful. Full requested human Online and Single Player/reconnect smoke is incomplete. PR remains Draft and is not merge-ready. No retries/fixes or further scenarios after the stop. Await a separate owner GO for investigating the observed admission delay and rerunning the bounded smoke; T003–T008 remain unstarted.
