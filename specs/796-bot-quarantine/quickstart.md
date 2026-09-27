# Quickstart: validate NORMAL/SLOW per-tier pools

## Current gate

Implementation of the accepted Spec Kit is authorized from T001 onward. Live #1018 remains the requirements source; snapshot synced 2026-09-26, updated_at 2026-09-26T19:21:31Z, and the accepted independent review confirms no design drift. The implementation instruction explicitly selects this alternative instead of #869/#1017. No stale “sync live issue first” blocker remains. Local implementation and deterministic tests are allowed; Stage/Production mutations, real refill MINT, scheduler activation, live-VPS installation and merge remain separately gated.

## Prerequisites for later implementation validation

- Accepted Spec Kit and explicit T001 instruction; local isolated PostgreSQL using existing Node 20/postgres tooling, never Stage/Production for the transaction suite.
- This implementation adds `supabase/migrations/20260927100000_poker_bot_quarantine_policy.sql`. It is forward-only and has not been applied here; publishing it invokes the repository DB Stage Apply PR and can mutate shared Stage. Declare that effect before publication. Production remains separate GO.
- Local fixtures: four exact pool accounts at zero, valid disabled tier policies, automatic NORMAL/AUTO users, empty STANDARD tables and existing managed table fixture. Enable/fund only explicit local test fixtures; no production values inferred from Stage examples.
- For integration later: exact runtime-SHA WS Preview and target identity evidence. Real Stage refill/MINT canary requires its own explicit user authorization and is not a prerequisite for the WS gate. Production migration, seed, MINT, timer/refill activation require a wholly separate GO.

## Focused local commands (after corresponding tasks exist)

Run from repository root with existing test environment conventions. These commands validate critical backend/runtime behavior; they do not activate a scheduler.

```bash
node --test shared/poker-domain/join.behavior.test.mjs shared/poker-domain/leave.behavior.test.mjs ws-server/poker/table/table-manager.behavior.test.mjs
node --test tests/poker-create-table.stakes.test.mjs tests/poker-quick-seat.behavior.test.mjs ws-server/poker/handlers/join.behavior.test.mjs
node --test ws-server/poker/persistence/persisted-state-writer.behavior.test.mjs shared/poker-domain/inactive-cleanup.behavior.test.mjs
npx vitest run tests/chips-ledger.test.mjs
node --test tests/admin-endpoints.behavior.test.mjs tests/admin-users-list.behavior.test.mjs tests/admin-ops-summary.behavior.test.mjs
node --test tests/chips/chips.migration.test.mjs tests/chips/poker-pool-policy.transaction.test.mjs
node --test tests/chips/chips-ledger-stage-automation.workflow.guard.test.mjs ws-tests/infra-vps-workflow.guard.test.mjs
```

The planned transaction suite must validate its local target before connecting and reject shared Stage/Production; use two connections and barriers, no sleeps. Do not run it against a remote target. No broad UI/CSS/JSP/glue suite. If future inline script changes, additionally run existing `npm run check:csp-inline` and include required SHA change.

The two existing workflow/VPS guard files are extended in T016 and must pass against the new artifacts in T019/T020. They check security/authority deterministically using existing YAML/source assertions and local stubs only: dispatch-only trigger; canonical repo/ref and actor/environment/feature gates; read-only default; separate Production GO; unauthorized inputs cannot reach mutation. They also verify exact dispatcher target/mode, GitHub credential only, no VPS Supabase/DB credentials or SQL/direct ledger writes, timer-only dispatch, and fresh/rebuilt-only installation with no enable --now/start/dispatch of the new artifacts. Existing-host installation remains separate and owner-approved. No real workflow dispatch, systemd changes or DB/MINT is performed by guard tests; no new framework or broad scheduler/UI suite. Record their results with T028 local evidence, independently of WS Preview and the separately authorized Stage canary.

## Critical scenario matrix

| Scenario | Expected result | Tasks |
| --- | --- | --- |
| Wallet/settled stack threshold−1 and threshold; restart | NORMAL below, sticky automatic SLOW at threshold; no leave required | T004–T007 |
| FORCE_NORMAL/FORCE_SLOW/AUTO; dynamic threshold | AUTO/NORMAL→FORCE_NORMAL→wallet or settled stack reaches threshold→automatic SLOW/effective NORMAL→Return to AUTO immediately yields effective SLOW without another threshold check; test both evidence paths. WS revision delivery retains bounded refresh; sticky is_slow_only never resets | T004/T006/T021–T023 |
| Unchanged settled hand; stale cache | Zero added policy/account/override/tier reads/writes; stale cannot fund/admit, payout legal | T004/T006 |
| Own safe empty promotion vs other/prefunded/managed | Only SLOW owner accepted final JOIN promotes and can seed SLOW | T004/T005/T013 |
| Four active, fifth fresh, financed rejoin | Four accepted; fifth zero buy-in/funding; rejoin no slot | T008–T010/T027 |
| Four pending, fifth direct/fallback Create | Fifth creates no table/state/ESCROW | T008–T010/T027 |
| Concurrent Create/JOIN; first human pending transfer | Both limits ≤4, pending→active once | T027 |
| Active/pending query shape and local EXPLAIN | User_id-leading active and created_by-leading pending paths matched to final predicates; early limit five qualifying distinct tables, indexed EXISTS, no global seat/table scan | T002/T009/T027 |
| Exact tier/class funding; missing/disabled/empty pool | Correct four pools, no cross-tier/class/TREASURY fallback or runtime MINT | T011–T015 |
| Mixed live table; UNKNOWN leave; original source return | Sticky known-SLOW, legal payout/rejoin; UNKNOWN no false promotion; provenance retained | T004/T007/T011/T015 |
| Balance below/equal refill threshold | One configured amount below, zero at/above | T016–T018 |
| Duplicate/unknown commit/revision edit same bucket | At most one pool refill across revisions, stable original replay | T016/T018/T027 |
| Nine hours missed; stale queued run | Current bucket only, no backlog or multiple chunks | T016/T018–T020 |
| Workflow/VPS/bootstrap authority guards | Dispatch-only, trusted gates not input-only authorization, read-only default, exact dispatch target, no VPS DB/SQL, fresh-only installation without activation | T016/T019/T020 |
| Admin unauthorized/conflict/invalid integer | Zero unauthorized mutation; audit actor/time/revision for accepted update | T021/T022 |
| WS slowOnly inventory / DB Quick Seat / stale recommendation | Existing resume retained; class filter; final JOIN rejects stale class/cap | T024–T026 |
| Denied classification JOIN | No false has_human_participant or seat/funding | T004/T005 |

## Later WS runtime gate — independent of refill canary

Use `.github/workflows/ws-preview-deploy.yml` definition from main with application revision equal to the latest runtime-affecting SHA, verify workflow succeeded for that exact SHA. Netlify preview alone does not deploy WS. Confirm NORMAL/SLOW Create→JOIN, 4+4 rejection, long-staying threshold transition, Admin revision propagation, slowOnly lobby/Quick Seat, managed behavior and cash-out in targeted smoke. User may perform manual runtime smoke; until evidence exists report “implementation ready, awaiting manual runtime verification”.

T029 checkbox covers only this WS gate. Complete it from exact-SHA workflow success and runtime smoke; withholding Stage MINT authorization cannot block or reopen it.

## Conditional Stage refill canary — separate approval

Refill worker starts dry-run. A real Stage canary performs ledger MINT and requires separate explicit user authorization naming the Stage scenario. Only then may it enable one provisioned tier and demonstrate one current-bucket refill/retry, including policy edit after commit. Compare ledger pool/bucket/amount and balance; runtime hand funding must create no MINT. Inspect intended repository/ref/actor/environment gates before any future dispatch. VPS timer is only GitHub authenticated wake-up every3h, no DB credentials or SQL. No native GitHub cron dependency. Record canary status separately as not authorized/not run or authorized with evidence; never conflate it with WS Preview completion. Production remains a wholly separate GO.

## Future scheduler installation — fresh vs existing VPS

`infra/vps/bootstrap.sh` is fresh-VPS only: it may install the new dispatcher/service/timer disabled on future fresh/rebuilt hosts. Never run bootstrap on an existing live VPS or bypass its fresh-vps guard.

For an existing host, follow a separate owner-approved targeted upgrade/install flow consistent with `infra/vps/README.md` and `docs/chips-ledger-stage-automation.md`: first read-only inventory of current units/configuration and a non-secret rollback manifest; review exact new artifacts; install only those dispatcher/units disabled, reload systemd and verify configuration/status without invoking the service or dispatching a workflow. Preserve existing timers/services. This is a future approved operation, not part of the docs task.

Installation and activation are separate steps. Neither code deploy, artifact installation nor bootstrap may automatically enable/start the new timer. Activation needs its own applicable authorization after reviewed target/ref/mode and workflow gates; Stage MINT and Production permissions remain distinct. VPS has GitHub dispatch credentials only, no DB credentials or SQL.

## Cutover / rollback / breaking review

Pause new admissions/funding while allowing current hands and lawful payouts. Provision only missing exact pool accounts at zero and policies; preserve existing account IDs, balances and provenance, especially the existing 500 bankroll; deploy all class/limit/source writers and metadata readers together. Deliberately enable and, only in authorized target, refill pools before reopening. Existing 500 key and all historical TREASURY/source attribution remain. Never infer enablement from progression catalog.

100 new funding moves from TREASURY to its own NORMAL pool; SLOW uses its own tier pool and can run out before the next refill. Sticky tables do not revert under FORCE_NORMAL. 4+4 applies to both classes; Sybil can multiply this per-account containment and remains an accepted residual risk. Admin propagation is bounded by the 30s refresh interval, with stale snapshots unable to authorize new operations. Rollback keeps new funding disabled rather than restoring class/limit/fallback bypass; applied migrations stay forward-only.

## Evidence record to complete later

T028 records the local command results and simplicity/constitution review here. T027 still requires the isolated local PostgreSQL concurrency and active/pending SQL/index/EXPLAIN evidence. T029 records exact runtime SHA/workflow result and smoke outcome for the WS gate. In a separate record, track Stage canary authorization and result (or not authorized/not run); it is not required to finish T029. No future threshold check is required to expose stored automatic SLOW on Return to AUTO. Local implementation and deterministic test evidence is recorded below; STOP before any unapproved environment operation.

## Local implementation evidence

Completed locally: T001–T026. Fundamental deterministic checks passed for access classification, authoritative JOIN/capacity and safe promotion, Quick Seat/Create compatibility, settled rollover persistence, exact pool mapping, refill authority/idempotency, Admin policy/override guards, WS self-access delivery, and workflow/VPS guard contracts. T027 local PostgreSQL concurrency/EXPLAIN evidence is pending because no isolated PostgreSQL fixture was available; its read-only EXPLAIN test skips without `POKER_POLICY_TEST_DB_URL`. T028 evidence/refactor review is prepared in this file but remains dependent on T027. T029 exact-SHA WS Preview/runtime smoke remains pending. No Stage/Production writes, real refill MINT, live-VPS installation/activation or merge was performed.
