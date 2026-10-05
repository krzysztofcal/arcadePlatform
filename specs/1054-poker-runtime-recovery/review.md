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
