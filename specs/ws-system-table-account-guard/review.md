# Managed system table creation with active Account Deletion

**CURRENT — owner-authorized conditional rollout (2026-10-25): Stage live creation NOT VERIFIED, explicitly accepted as residual risk; test window safely OFF.** Production preflight passed; merge/deploy proceeds only through required checks. Historical BLOCKED outcomes below remain unchanged as evidence, not reclassified as PASS.

**Current runtime verification: BLOCKED at Preview preflight (2026-10-25).** Approved deploy SHAe3020b4f remains uninstalled; deletion-enabled runtime prerequisite could not be established. No deploy/configuration/data change. Not READY TO MERGE; local tests/CI remain green.

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


## Authorized Preview attempt — 2026-10-25

HEAD matched approved **e3020b4f30cdb1cb0a3d13963da0a4a1e25588e5**, Draft; required/all applicable CI checks green. Shared Preview had0 established port3001 connections, human claims, pending Poker/deletion work, or overlapping deploy/live agent. Runtime remained **33fbe284859884fd2538774ae756f11aee154a04**, PID295769/start08:56:16UTC; public healthzok. Approved readonly env preflight returned LIVE RedisV3Stage PASS and validated pinned Stage project configuration.

Profile CONTINUOUS_BOT_DEFAULT enabled,desired5,min2,target3,max3,rotation900s. All five ownerless managed non-SP100CH tables had3 bots/300CH stacks/300CH escrow: total1500CH stacks=1500CH escrow. Natural rotation opportunity was available: two old tables due14:06:08/14:06:38 were naturally replaced by `fe8413bd-4ca3-4bb5-ba55-9e9bc63f3cd9`14:06:38.181255 and `1ad971bc-4554-4590-87f9-511389658dd3`14:07:08.181623. **This occurred on the old unpatched runtime and is not a smoke PASS for #1153 or its flag1 path.** No manual rotation/profile/funding/INSERT performed.

### Blocking prerequisite: actual ACCOUNT_DELETION_ENABLED=1 not verifiable

EnvironmentFile `/opt/arcade-ws-preview/.env.preview` is root-owned0600; running `/proc/295769/environ` is arcade-owned0400. No authorized reader exposes its selected flag. Systemd inline Environment has no exported value. Existing sudo env-preflight validates a protected approved window and accepts eitherOFF orON, but outputs only Redis status; its protected window manifest is not readable. No permission/helper/logging/configuration change or secret dump attempted. Therefore the **literal running flag value remains UNKNOWN**, not asserted as0 or1.

Old initializer module hash7a2940aae36bcde7134bf8db233426c96ce09cdf186190b6282c93ebfa952b34 differs from approved373b0b583fcaba07358c0ebdc44c63f554c9210b2002f6b3b11cd90a8683b29a. Its successful ownerless creation strongly indicates its human guard is inactive, since enabled-deletion requiresUUID(null) and fails before SQL. This inference is separated from the unavailable direct flag reading. Under current authorization (no flag/config changes) it cannot provide positive live coverage of the enabled-deletion fix.

| Gate | Result |
|---|---|
| Approved HEAD / CI / Stage pin / health / shared occupancy | PASS |
| Natural rotation window / existing profile and aggregate escrow | PASS preflight, old runtime only |
| Actual live ACCOUNT_DELETION_ENABLED=1 | **NOT ESTABLISHED** |
| Exact-SHA deploy / restart / new module hash | **NOT RUN**, stopped before dispatch |
| Corrected supervisor + flag1 / seed ledger IDs / no duplicate seed | **BLOCKED**, not claimed from old-runtime observations |
| Live human guard regression | NOT RUN; existing fundamental coverage remains30/30 |

[Reduced preflight evidence](preview-preflight-2026-10-25.json). No authenticated human gameplay, real deletion, financial write, environment/secret change, Production operation, deploy or merge. Source #1149/#1151/#1152 untouched. Literal flag value needs a sanctioned selected-field readonly status/owner verification; if it isOFF, a separately authorized controlled StageON window is needed before the requested live branch check. Do not silently enable it, bypass approved window protections or deploy as if an OFF smoke established ON coverage. Existing local flag1/human-fencing tests30/30, deletion35/35,npm147 groups and implementation CI remain valid. Production's previously recorded blocker remains unresolved; no new Production inspection in this Stage-only attempt. Preserve the prior conditional rollout plan, keep Draft, stop for review.


## Owner acceptance and Production handoff — 2026-10-25

[WS Preview Deploy40203427908](https://github.com/krzysztofcal/arcadePlatform/actions/runs/40203427908) SUCCESS from main workflow/applicatione3020b4f. Installed metadata matched, initializer SHA256373b0b583fcaba07358c0ebdc44c63f554c9210b2002f6b3b11cd90a8683b29a, PID316167/start14:42:23UTC, local/public healthzok. Owner root subsequently proved that process had ACCOUNT_DELETION_ENABLED=1. Stage DB releasefalse and Netlify deletionOFF throughout; no accepted deletion, human gameplay or manual financial action.

Observed until14:50:54UTC:5/5 existing managed tables, no new table/seed transaction despite passed rotation deadlines. Bot hands continued; no invalid_identity appeared. Aggregate escrow/stacks1500CH; POKER_BOT_BANKROLL_10017253→17253CH; zero ledger transactions since restart. No forcing/deficit/config manipulation. **Positive live creation/seeding remains NOT VERIFIED**, cause of absent rotation not established by existing logs.

Owner root then used protected deactivate/verify/preflight, controlled Preview-only restart and selected-field process inspection: PID316167flag1→PID316767flag0,restartedtrue. Agent rechecked active service and healthzok. OFF is proved, not inferred from file alone. User explicitly accepts missing positive Stage creation witness because pool5/5 had no natural deficit and deterministic RED→GREEN/CI are green; this is a conscious residual-risk acceptance, not a smoke PASS. No further Stage smoke authorized/needed in this handoff.

Fresh Production read-only preflight15:05:13UTC: no sockets/human claims/pending Poker or deletion requests; no nonzero closed/unbound escrow;0OPEN tables. Profile enabled desired2/target3,min2,max3,maxSeats6; tier100 enabled. NORMAL bankroll4760CH, SLOW2000CH, both active:600CH normal seed fits existing4760without top-up/refill (expected post-seed4160CH, above2000threshold). LIVE RedisV3prod PASS; service41bb6185/PID147840 healthzok with known invalid_identity baseline; no incompatible deploy/shared maintenance lock observed. No state/data/config changes by agent.

Final diff remains one7-line production helper guard plus existing fundamental test and review/evidence. No production-code change after exact e3020b4f; follow-up commits documentation only. User GO allows **only #1153 merge and automatic WS/Netlify Production deployment**, then read-only proof of actual SHA/health/two tables/bots/6balanced seeds/escrow/no duplicate/invalid_identity. Stop on error/ambiguity. #1149/#1151 may be prepared only, **not merged in this task**; #1152 never merge. Owner risk acceptance and rollout result are also recorded in the PR for durable audit.
