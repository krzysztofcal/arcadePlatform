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
