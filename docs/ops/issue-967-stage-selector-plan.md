# #967: Stage existing-30d selector validation

Status: **draft; #967 and #892 remain open**. No cleanup or deployment was run.

## Source and safety

- Base `origin/main`: `ecfccdfda22fcb7dd5be068e2495571f4b939398`.
- Reviewed [#967](https://github.com/krzysztofcal/arcadePlatform/issues/967),
  [#892](https://github.com/krzysztofcal/arcadePlatform/issues/892), and
  [#959](https://github.com/krzysztofcal/arcadePlatform/pull/959).
  #959 fixes the separate bot-only discovery/exact-table path, not this selector.
- Original SQL SHA-256: `0eaac2040038a1c490e8965401c6f57739c141695a5046a38815777df0d479df`.
- Proposed SQL SHA-256: `e63704f06da46be4f71321de6d422ccc99f3f28d502f2b3a5cb1a6b975395306`.
- Supabase MCP was scoped to `krydukthwdvccggbyjfw`, with `read_only=true`.
  Each session first checked server-side `pg_control_system().system_identifier`
  = `7656985631720456337` and the distinct persisted archive-batch project refs
  = `krydukthwdvccggbyjfw`; mismatches abort before diagnostics.
- Production was never contacted. No Storage operation, DML, DDL, migration,
  workflow dispatch, timeout increase, planner-setting change or cleanup.
- PostgreSQL 17.6; `work_mem=3500kB`, `enable_nestloop=on`, `plan_cache_mode=auto`;
  unchanged default `statement_timeout=2min`, checked `2026-09-09T09:03:45.967523Z`.

Full original non-executing plan, proposed measured plan, bounded index/statistics
catalog results and repeated aggregates:
[issue-967-stage-selector-evidence.json](issue-967-stage-selector-evidence.json).
Only predicates and aggregates are recorded, not raw ledger payloads or credentials.
Identity `checked_at` precedes each diagnostic; aggregate rows also contain their
own server-side completion timestamps. Neither is a historical pre-run snapshot.

## Failure and plan diagnosis

[Run 34323780418](https://github.com/krzysztofcal/arcadePlatform/actions/runs/34323780418),
[job 102376246693](https://github.com/krzysztofcal/arcadePlatform/actions/runs/34323780418/job/102376246693),
checked out the base SHA. On September 9 the selector ran from
`07:27:09.0867655Z` to `07:29:09.2411258Z`: `120154.391421 ms`, SQLSTATE
`57014`, no new archive/proof/prune receipt. This is historical failure evidence,
not a paired benchmark of the current snapshot.

Inspection began with non-executing `EXPLAIN (FORMAT JSON)`. The retained original
plan is a repeat capture at `2026-09-09T09:00:32.816118Z`. Its final nested loop
places the **unmaterialized global accounting/registry aggregate on the inner
side**, exposing it to rescans per eligible outer row. Severe underestimation
makes this appear cheap. Actual original rescan counts are unknown: no full
original `EXPLAIN ANALYZE` was run.

The proposed plan measures the unchanged intermediate expressions:

| Node | Estimated rows | Actual rows | Actual loops |
| --- | ---: | ---: | ---: |
| cutoff-filtered base | 29,178 | 28,837 | 1 |
| technical/null-user base filter | 291 | 28,604 | 1 |
| table-marker grouped identities | 200 | 28,821 | 1 |
| ESCROW/poker-prefix account scan | 1 | 15,929 | 1 |
| eligible CTE | 1 | 28,604 | 1 |
| final accounting/registry aggregate | 1 | 28,604 | 1 |
| returned page | 1 | 5,000 | 1 |

The derived-marker and text-cast/type/prefix expressions are poorly estimated,
not evidence of a small cohort. Statistics were recently auto-analyzed:
transactions 03:12Z, entries 01:19Z, accounts 07:02Z, tables 08:53Z September 9;
registry 18:20Z September 8. No evidence justifies a new index or manual ANALYZE.
Existing type/date, entry transaction/account, registry transaction and unique
account system-key indexes support the relevant access paths.

## Minimal change

```sql
-- Before
join eligible_ids ids on ids.id = e.id
-- After
where (e.id in (select id from eligible_ids)) is true
```

`IS TRUE` prevents semi-join pull-up in the observed plan. PostgreSQL builds a
hashed membership SubPlan and executes the complete validation aggregate once.
`eligible_ids` groups by ID/type; the transaction primary key fixes its type
and prevents null IDs. Each outer row therefore has zero or one matching group:
membership preserves join multiplicity and NULL behavior. Every predicate,
export column, cutoff/cursor, `ORDER BY e.created_at, e.id` and `LIMIT $2` is
byte-for-byte unchanged. The runtime maximum remains 5,000 transactions.

Rejected diagnostics, not shipped:

- Early technical/null-user pushdown only reduces estimated base rows from
  29,178 to 29,073 and retains the repeated aggregate. Not execution-tested.
- Plain `IN` becomes a nested-loop semi-join with the inner aggregate.
  Not execution-tested.
- Materializing only `eligible_ids` still leaves nested-loop CTE comparison.
  Its 15-second-bounded read-only measurement returned `57014`; no mutation.

This removes repeated global validation, not all cohort-wide work. Marker
discovery and accounting still process the cutoff cohort once. Growth may
still hit the unchanged fail-closed timeout; this is not a constant-work claim.

## Live Stage execution and determinism

All plans/executions use the exact source SQL literal, substituting only typed
bindings: cutoff `2026-08-10T08:28:44.786719Z`, limit `5000`, cursor `NULL, NULL`.
This deliberately reuses #967's diagnostic cutoff, not a moving current cutoff.
After inspecting the proposed non-executing plan, measurements used:

```sql
begin read only;
set local statement_timeout = '15s';
-- EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON)
-- followed by the exact proposed SQL with the bindings above
commit;
```

First execution: **4904.864 ms**, 5,000 rows. Retained repeat, identity checked
`2026-09-09T09:00:07.713682Z`: **4905.884 ms execution**, 7.324 ms planning,
5259.441 ms MCP round trip. Both fit the tighter diagnostic budget; scheduled
timeout remains 120 seconds. The retained plan reports 13,521 temporary blocks
read / 10,974 written: spills remain, without increasing work_mem. PostgreSQL
buffer dirties/temporary files during SELECT do not represent application DML.

Accounting aggregate and membership scan each return **28,604 eligible
transactions before the limit** (actual, not estimated). Nothing was pruned.
The fixed snapshot residual therefore requires **6 batches of at most 5,000**
if eligibility remains unchanged; this arithmetic is not evidence of executed batches.

An aggregate-only wrapper over the unchanged page selector returned:

| Metric | Value |
| --- | --- |
| page transactions / entries | 5,000 / 10,000 |
| page TABLE_BUY_IN / TABLE_CASH_OUT | 3,262 / 1,738 |
| page oldest UTC | 2026-07-26T13:00:51.631191Z |
| page newest UTC | 2026-08-03T18:33:59.491542Z |
| first completion UTC / MCP elapsed | 2026-09-09T09:02:35.757743Z / 5650.087 ms |
| repeat completion UTC / MCP elapsed | 2026-09-09T09:02:40.984345Z / 5455.307 ms |
| ordered full-row SHA-256 (both) | `99e5df2d407962b40a9f25df91aa70a701b180b7acc53b2fd7ba46c9d1b32616` |

Digest: hex-encoded `sha256(convert_to(jsonb_agg(to_jsonb(selected) order by
created_at,id)::text,'UTF8'))`. All export fields, not just IDs, participate.
Counts, ranges and hashes matched in separate read-only transactions. No raw
rows were returned. Per-type counts and timestamps above are for the page,
not the entire 28,604-row cohort.

## Fundamental tests

Only two existing test files were extended:

- PGlite compares full ordered old/new export rows for eligible/ineligible
  accounting, marker, registry, table-state and user-scope fixtures; limits,
  timestamp/ID cursor ties, exact cutoff and empty boundaries. Reversing the
  one-line change must reproduce the pinned original SQL SHA.
- Its measured plan must use hashed membership and execute the grouped
  accounting validation exactly once.
- Exporter timeout contract also covers `prunable`: propagates `57014`, emits
  read-only telemetry without rows/parameters, runs no later query or DML.

Passed 12 relevant test files: archive-export, prunable-candidate-sql.behavior,
archive-pruning, archive-storage, bot-only-retention, closed-human-retention,
stage-automation, stage-automation.order.behavior,
stage-automation.observability.behavior, stage-automation.workflow.guard,
stage-escrow-retention (30 tests), stage-escrow-retention.workflow.guard (6 tests).
Existing archive/automation tests cover wrong identities, malformed/partial
proof/recovery/receipt states and refusal before Storage/prune calls.
Syntax check: 218 files passed. `git diff --check` passed. The complete unrelated
application suite was not run. No accounting/archive-path implementation changed.

## Remaining gates

Keep the PR draft for review. Old/new equality is proven on fixtures; the full
known-slow original selector was deliberately not rerun on live Stage.
Literal-bound MCP plans do not replace the scheduled connection's execution
environment. A canonical-main normal `existing-30d` run must still pass its
resource guard and selector after human-approved merge, with complete archive,
proof, both recovery copies, dry-run, receipt, mappings and post-check for any
resulting batch. Do not manually dispatch destructive cleanup to validate this PR.

#892 still lacks an authoritative September 9 selector before/after snapshot
and unchanged-balance evidence. Current read-only results cannot reconstruct it.
Next: review this draft, then collect actual same-cutoff selector/accounting
snapshots around the next normal schedule once reviewed code is on main.
Do not close either issue now.
