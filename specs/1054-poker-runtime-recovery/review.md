# Active review — authoritative auto-sitout (2026-10-05)

Draft PR #1055 is independent of #1049, based on origin/main 87f9153e. Latest owner Stage evidence supersedes the previous rollover concern. No scheduler/server.mjs changes are made.

## Authoritative change

Accepted human timeout increments the existing missed-turn field once inside applyCoreStateTurnTimeout, using the existing map helper and inactivity policy (threshold 2). The engine internal isTimeout flag prevents auto CHECK from being treated as manual activity; it is not a WS payload field. Deferred-leave actors and bots do not acquire human inactivity penalty. Current hand remains intact at pending threshold.

buildNextHandStateFromSettled commits pending into sitOut before new-hand membership/dealer/turn/cards/blinds are selected. buildBootstrappedPokerState retains only valid currently seated/non-left inactivity entries. Durable stack preservation is unchanged; auto-sitout does not remove membership/seat or cash out.

Accepted manual human actions clear count/pending/sitout. Existing authoritative JOIN mutation clears them without another ledger debit on rejoin. A returning out-of-hand player uses existing waiting-next-hand classification. Unchanged rejoin without penalty retains the old no-write shortcut.

The existing pure missed-turn helper moved to shared/poker-domain/poker-missed-turns.mjs so shared JOIN does not import Netlify adapters at module load. Legacy import path re-exports the same existing API; new clearInactivityPenalty shares activity/rejoin reset rather than duplicating state mutation. Existing inactivity threshold policy is reused. No new writer, scheduler, dependency or inactivity timer.

## Fundamental evidence

New authoritative engine regression first failed on missing count (undefined !== 1). It now proves real timeout hand A -> settlement/rollover -> timeout hand B -> pending threshold -> next boundary sitout; seat/stack retained, no cards/turn/dealer participation or later blind. Same scenario verifies a successful manual action clears prior count and later timeout restarts at 1.

Existing financed restricted rejoin test now confirms penalty deletion, retained stack and zero new ledger debit. Existing private-field persistence test now writes inactivity evidence via the real writer, loads it through adaptPersistedBootstrap and restores table-manager state, retaining count/pending/sitout. No new harness or UI suite.

Focused suite: 207/207; existing real-socket JOIN suite: 8/8; runtime dependency guards: 21/21. Required syntax/check:all/ci:guards/CSP checks pass. Additional focused persistence suite result recorded in handoff. Four older legacy timeout failures remain baseline-only (see history below).

## Gate and breaking impact

T101–T105 implemented; T106 exact-SHA Preview + narrow authenticated smoke pending. Stage verification uses an isolated confirmed fixture user, normal welcome-bonus ledger grant and existing JOIN/action/leave flows. No direct balance/table edits, migrations or Production mutation/deploy.

Intentional breaking behavior: unattended humans accumulate timeout evidence across hands and stop paying blinds after the existing threshold and safe boundary; actual manual activity/rejoin clears penalty. No intended changes to accounting, settlement, funding/access policies, transport or scheduler. Review confirms server.mjs, timeout persistence owner, ledger and protocol unchanged. Legacy mirror fixes retained only for still-used legacy paths, not as authoritative proof.

---

# Historical investigation — superseded by owner Stage evidence

# Work in progress — 2026-10-05

Base: origin/main `87f9153e`; isolated branch `fix/1054-poker-inactivity-rollover`. No changes transferred to #1049.

## Regression and mirror correction

The replacement fundamental scenario runs both reducer/timeout mirrors, takes an actual first timeout, folds remaining actors into a materialized SETTLED hand, advances through the real reset, takes the next timeout, verifies pending threshold 2, settles and advances again, and verifies sitout/exclusion. No injected missed-turn count starts the second hand. Before the fix it failed at `undefined !== 1` immediately after reset; after the fix it passes. The existing skipped-reset assertion now checks retained seated evidence and removal of left/stale users.

Both reset implementations retain only nonnegative integer counters for currently seated, non-left users. Initialization and manual-action reset logic are unchanged. Pending sitout still commits through existing safe-boundary logic. Behavioral impact: timeouts across different hands now accumulate in these reducer paths.

## Canonical runtime discrepancy — unresolved

Current `server.mjs` timeout handler calls tableManager.maybeApplyTurnTimeout -> engine.applyCoreStateTurnTimeout -> applyCoreStateAction -> shared/poker-action-reducer. Current settled rollover uses engine.buildNextHandStateFromSettled -> buildBootstrappedPokerState. Neither canonical engine path increments/preserves missed-turn maps. Read-only Stage query on the currently advancing managed human table returned null missed/pending/sitout maps. The requested two reset fixes alone therefore cannot establish the actual authenticated auto-sitout acceptance condition. A minimal reuse of existing inactivity policy at this real ownership boundary must be reconciled with live #1054 before calling the runtime fix complete.

## Rollover investigation — unresolved

Existing real-socket SETTLED JOIN fixture passes (accepted/published WAITING_NEXT_HAND -> new PREFLOP/ACTIVE without further command). Traced publication/reveal, timers, retries, command queue dedupe, prepare/commit, restore and persistence branches. Several terminal paths can lack a future retry, but none is yet tied to the observed failing owner table. No guessed scheduler change was made.

Read-only SSH to Preview works with the documented `copilot` account. Current runtime SHA is `beb7e86d408c4f0fc7f667147efe68fd9a158011`, with deployRef equal to releaseSha. Current journal lacks rollover diagnostics under default ERROR filtering. Stage currently has no WAITING_NEXT_HAND human seat. Requested failing tableId/environment to identify the real branch. A bounded read-only Production journal check also returned no rollover/persist-failure entries. No Production mutation or deploy performed.

## Verification so far

- Updated policy regression and related reducer/sitout/default-action/private-field tests: 5/5 pass.
- Existing engine-timeout, engine-rollover and reconnect/resync tests: 45/45 pass.
- Existing real-socket SETTLED JOIN case: 3/3 pass (not a reproduction of the reported stall).
- Required syntax, check:all, ci:guards, CSP inline checks: pass.
- Four existing timeout tests fail identically on pristine origin/main and this branch: missed-turns (`not_enough_cards`), no-side-effects (`false !== true`), river-payout and payout-streets (`170 !== 190`). No unrelated fixes included.

Self-review: no ledger, stacks, funding, settlement, scheduler, browser, protocol, CSS, inline scripts or dependencies changed. Existing dependencies installed locally for checks only. No deployment or runtime-ready claim; authenticated exact-SHA smoke remains required. #1049 remains untouched/draft and its UI glue task remains pending until runtime work is completed.
