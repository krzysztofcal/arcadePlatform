# Managed system table creation with active Account Deletion

## Scope and decision

Separate bugfix from current main6ecbc8a36a19952b7e86255436e8be903ea5d646. Unblocks future rollouts #1149/#1151; contains neither source PR nor Offline. Draft review only, no merge or deployment authorized. Production's existing supervisor fails every10s with invalid_identity; enabled profile wants2 tables but has0. Account Deletion V2 is active; disabling it is not a resolution.

`netlify/functions/_shared/poker-table-init.mjs::createPokerTableWithState()` previously applied a human account guard to userIdnull. The exception now requires all four exact predicates: userId===null, lifecycleKind===CONTINUOUS_BOT, managedProfileKey===CONTINUOUS_BOT_DEFAULT, isSinglePlayer===false. All other callers retain assertAccountActive when deletion is enabled. Empty/undefined/malformed identity, STANDARD, unknown/missing profile and SP cannot acquire the exception. No new caller parameter/capability/configuration or generalized ownerless fallback.

## Callers and locks

- `ws-server/poker/persistence/continuous-bot-table-repository.mjs::createManagedTable()`: only ownerless caller; uses validated managed profile, canonical stakes/buy-in, explicit system lifecycle, existing transaction and rotation deadline. Internal supervisor owns these fields. No public request can supply this identity context.
- `netlify/functions/poker-create-table.mjs::handler()`: authenticated auth.userId; defaultSTANDARD. Public body does not control lifecycle/profile/system owner.
- `netlify/functions/poker-quick-seat.mjs::createAndRecommend()`: authenticated userId, defaultSTANDARD, optional SP flag; upstream table-slot locking reused via userSlotLocked:true.
- Human helper order unchanged: slot lock/capacity (unless already locked)→account lifecycle advisory lock→active/deletion check→table/state/escrow INSERT. Existing transaction scope and upstream locks unchanged. System path takes no fictitious human lifecycle lock. Bot seeding/postTransaction retain their own account/escrow locking and idempotency.

No change to `shared/account-deletion.mjs`, coordinator/recovery, BURN/Auth-last, ledger/rules/strategy/payouts/buy-in/timeout. Existing system ledger transactions have SYSTEM/ESCROW entries, no human actor. Helper still only creates an empty INIT state and an escrow account; normal supervisor alone seeds/funds bots. No manual SQL, funding or existing data changes.

## Fundamental regression and validation

Existing `continuous-bot-table-repository.behavior.test.mjs` extended, already registered in scripts/test-all.mjs. Existing real repository reconcile test now runs with ACCOUNT_DELETION_ENABLED=1 and proves two missing tables created under the existing per-sweep cap. Before fix it failed result.ok:false; a direct valid-system helper case failed invalid_identity. Other guard tests already passed. RED30 total/27pass/3fail (includes parent failure), then GREEN30/30.

One focused security/lifecycle group covers valid system creation's three original SQL operations/empty state/no ledger writes; invalid context rejection before inserts; active STANDARD/SP human lock order; deleting/missing humans and a deleting human with claimed managed metadata. Flag is scoped/restored within the isolated test process. Existing test fixture only, no framework or remote provider.

Local verification: repository30/30; Account Deletion behavior/E2E/retirement35/35; existing bot-unit and ledger-settlement files passed; create-table stakes passed with project's XP_TEST_MODE=1. An initial direct stakes invocation omitted XP test mode and failed xp_redis_v3_required before tests; corrected invocation passed, no configuration changed. Two nonexistent optional filenames in the combined Node test pattern matched no files; only the three existing deletion/retirement suites are claimed as35 tests. Root npm test: exit0,147 groups PASS; existing optional disposable-PostgreSQL/PG16 checks skipped without their DB configuration. CI recorded in final PR handoff. No failing code test concealed or host mutation performed.

## Deployment effects — review before merge

Changed runtime path is netlify/functions/_shared/poker-table-init.mjs. Existing scripts/ci-impact.mjs deployPath matches poker-*.mjs, so **merge to main triggers WS Server Deploy**, not merely a browser build: impact→validate→production artifact→atomic current switch→ws-server.service restart→local/public health gates and existing rollback. Test-only path is also WS but no new deploy machinery. Normal Netlify Git integration produces Deploy Previews for this PR and Production browser/functions builds after main merge. CI/Netlify Preview alone does not deploy WS. No migrations/dependencies/workflows/secrets/config changes; DB Stage migration apply has no migration input. No skip/bypass flags.

## Prepared bounded WS Preview verification — separate deploy/test GO

1. Recheck source/main, clean CI, shared Preview occupancy/human claims/pending work/escrow/other deployments. Read current managed profile and next natural rotation; do not alter desired count or delete tables. Stop if shared state ambiguous or occupied.
2. Require the Preview environment's existing Account Deletion flag to be enabled for a positive live branch check. If not enabled, report missing prerequisite and obtain explicit owner decision; do not toggle it silently or claim the guarded runtime branch was tested. Local deterministic flag-enabled regression remains valid independently.
3. Manual WS Preview Deploy: workflow definition main, application exact runtime SHA from approved PR handoff. Prove selected/installed SHA, module hash, restart and health. No deployment now.
4. Observe automatic supervisor creation when there is an existing deficit or a scheduled natural rotation, choosing a window just before rotation to keep observation short. No forced rotation, manual INSERT/funding or fake human UUID. Preserve shared profile (Stage may want5, Production2). Confirm system-ownernull, correct lifecycle/profile/non-SP, canonical100CH table, expected bot count and rotation deadline, no invalid_identity log; no more than2 creations per reconcile, no duplicates on next sweep.
5. Read-only reconcile normal bot seed transaction IDs/idempotency, zero transaction sums, escrow=sum stacks+contributions. Existing funding/reserve/tier gates must stay enforced; insufficient funds fails closed, never auto-top-up. If safety permits within a separately authorized funded smoke, one existing ordinary Stage user's STANDARD/SP admission verifies human guard and public-map privacy; no real deletion. No unrelated Online replay is required to prove this constructor guard.

## Conditional Production restoration plan — no execution in this PR task

After owner review/GO, recheck current main/diff/required checks and existing Production runtime/health/log baseline, active sockets/humans/pending Poker or deletion leases, shared deployment lock and pool provisioning/balance. Require appropriate existing system funds for normal seed: current enabled desired2/target3 at100CH means600CH total into two300CH escrows; no funding or profile change authorized here. No restart while unsafe operations run.

Merge only this fix first through normal protected PR checks; automatic WS/Netlify main deployments must both complete. Prove actual WS release SHA/module hash, restart/health and correct environment. Existing supervisor's initial/next10s sweep should create at most2 missing tables through its normal transaction and seed flow. Observe desired2 and target3 bots/table, INIT→legal hands, complete audit metadata and eventual OK settlement, no duplicate seeds, zero ledger deltas, no invalid_identity. Read-only reconciliation only; stop on error/uncertain finance. Existing atomic release rollback handles deployment health failure; any later rollback/forward-fix needs the relevant owner authorization and preserves DB/ledger, no cleanup/repair SQL.

Only after verified healthy restoration resume #1149→main→verified Production, then update #1151 against main/verify tested runtime composition and green checks→merge→verified Production. #1152 stays test-only/never merge, close only after both source rollouts. No new integration branch or full previously passed smoke without a material runtime reason.

## Risk / breaking impact

No public protocol/schema/economic/JSP change. Intended difference: valid internal managed system creation succeeds while deletion flag is on. Security depends on existing internal-only option construction, audited above; exact strings and strict null/false prevent widening the human bypass. Future system profiles require explicit review rather than silent fallback. Restored supervisor will execute its already configured normal bot funding and table lifecycle; that expected financial effect must be reconciled during approved rollout. No Production/Stage deployment, real deletion, fault injection, manual data write or source #1149/#1151/#1152 modification in this task. Stop for Draft review.
