# #1077 authenticated Preview runtime smoke — 2026-10-12

Revision: cbf0262fdb5dda061d53885fbff50496c5e279e4. Browser/functions: deploy-preview-1095--playkcswh.netlify.app. WS: ws-preview.kcswh.pl. Stage: krydukthwdvccggbyjfw. Dedicated account, NORMAL, eligible buy-in100. User explicitly requested full scenario including funded normal application operations. No manual SQL writes, balance adjustment, deployment, Production operation or merge.

## Observed scenarios

- Authenticated progression200; both Play Now/Play vs Bots enabled, available tier100.
- First Single Player: 262dc651-d090-4698-95a6-4cd693ab387f. New Game100, authoritative JOIN,4 funded bots. Direct page navigation to /poker/ produced no Leave frame and Resume returned to the same active table. Close tab→new lobby→Resume also retained eligibility. Owner stack100 remained100; aggregate ledger has only one human buy-in. Explicit menu Leave during PREFLOP sent one Leave frame; stored left marker became true while owner stack100 remained for settlement. Refreshed progression omitted Resume. Direct old URL returned participation-ended preflight and readable error. Final tableCLOSED, cash-out100, escrow0.
- Second Single Player: dba3de24-8e9d-49ed-b3f2-c3ec6ffd4b3b. New Game100,5 funded bots. UI accepted two CALLs and FOLD. Fold→750ms→direct URL/poker/→Resume succeeded without Leave frame; persisted Leave-request count remained0, owner marker absent, stack96 after Resume. Forced actual WS socket close triggered reconnect+authoritative JOIN and restored active participation; no second buy-in. Explicit mid-hand Leave removed Resume. TableCLOSED with cash-out96 and escrow0.
- Direct WS JOIN to the closed second table returned commandResult/rejected/table_closed. Replayed same requestId; audit afterward still one human buy-in. Initial raw harness mistakes (wrong token type, missing Origin, expecting error instead of commandResult) were corrected; no incorrect request was counted as product failure.
- Targeted raw-WS deferred case: third SP2034f4cb-fc4a-4634-8768-2257f90ce741,100CH,2 funded bots. Normal Quick Seat/WS JOIN accepted, then normal LEAVE accepted during hand; immediate direct JOIN on the same authenticated socket returned commandResult/rejected/single_player_participation_ended. Live read-only state afterward still had owner ACTIVE seat/stack100, left markertrue and handSETTLED awaiting finalization. Final cash-out100, tableCLOSED, escrow0 and exactly one human buy-in. This closes the runtime mid-hand direct-JOIN coverage gap.
- Poker Online: 6f7f383e-44d5-4c21-917e-e53c0868c4c1, CONTINUOUS_BOT. Play Now→JOIN, WS reconnect while admission pending, then Joined; explicit Leave and final cash-out98. One human buy-in and one cash-out. Online table initially remainedOPEN with bots/escrow302; final audit later found tableCLOSED and escrow0 after existing cleanup. No new online economic rule asserted; this is basic compatibility smoke, not every legacy edge case.

## Read-only economic audit

| Table | Human buy-ins | Buy-in CH | Human cash-outs | Cash-out CH | Final escrow |
|---|---:|---:|---:|---:|---:|
| 262dc651 | 1 | 100 | 1 | 100 | 0 |
| dba3de24 | 1 | 100 | 1 | 96 | 0 |
| 2034f4cb | 1 | 100 | 1 | 100 | 0 |
| 6f7f383e Online | 1 | 100 | 1 | 98 | 0 |

SP funding has exactly4/5/2 seed transactions across the three tables; each has SYSTEM POKER_BOT_BANKROLL_100 debit100 and correct table-escrow credit100. All seed transactions balanced, including3 normal100 bot fundings on the Online table. No repeated bot funding caused by Resume. Account490 before test→484 after: 400 buy-ins,394 cash-outs, net gameplay loss6. Zero active human seats remaining for the test account. No account refill/bonus/ledger manipulation.

## Original owner incident and limitations

Original9613e540-1b35-4b61-a4e3-a6e23f43c042 had recorded Leave, buy-in100/cash-out90 and escrow0. This smoke did NOT reproduce unexpected Leave from URL editing or tab close; captured URL/tab flows showed no Leave, while explicit Leave clicks did. Existing historical records do not identify the frontend cause of that original Leave; do not attribute it to owner misclick or conclusively declare that historical problem fixed.

Automation used local headless Chromium. Netlify's injected Drawer intercepted action clicks at this viewport; only that external toolbar was hidden inside the test browser to exercise game controls. No served application files were modified. The fold-preaction checkbox initially targeted the input rather than its label; its pointer interception is not classified as a game defect. Offline emulation alone was not counted as reconnect evidence; actual socket-close/reconnect was tested. No mobile/device matrix or500/1000/SLOW funded scenarios (account eligible100 only).

Browser sessions/processes closed; no credentials/tokens/auth storage written to artifacts. Git worktree remains clean, runtime SHA unchanged, PR1095 remainsDRAFT. No merge-readiness claim for the still-unexplained original961 incident.


## Owner acceptance and publication references

Owner explicitly accepted their manual smoke and these agent tests as PASS, then authorized documentation finalization and PR Ready for review. The historical961 incident remains documented as not reproduced, with original Leave source unknown; owner acceptance makes it nonblocking for this release evidence, not retroactively explained.

- PR: https://github.com/krzysztofcal/arcadePlatform/pull/1095
- WS exact-runtime deploy: https://github.com/krzysztofcal/arcadePlatform/actions/runs/38294113860
- Tests: https://github.com/krzysztofcal/arcadePlatform/actions/runs/38293761150
- WS PR Checks: https://github.com/krzysztofcal/arcadePlatform/actions/runs/38293761208
- CI: https://github.com/krzysztofcal/arcadePlatform/actions/runs/38293761168
- Stage: https://github.com/krzysztofcal/arcadePlatform/actions/runs/38293761176 — canonical krydukthwdvccggbyjfw/system identifier7656985631720456337,111 applied/0 pending, both immutable feature hashes matched.
- Netlify deploy6acd2c3c3d152aae82aa2de7 ready for runtimecbf0262f, release metadata/local+public health/environment preflight/helloAck1.0 verified.

Any subsequent documentation-only finalization commit preserves this accepted runtime evidence after checking that application/configuration/migration files are unchanged. No further WS deployment or funded test is needed for that documentation-only change. Production schema/runtime rollout and merge remain separately authorized.
