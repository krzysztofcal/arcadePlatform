# Stage-only chips-ledger automation

This workflow is related to closed Issue #874 and is intentionally unavailable
for Production. The orchestrator has no target argument: it hardcodes the
canonical Stage project `krydukthwdvccggbyjfw` and PostgreSQL system identifier
`7656985631720456337`. The workflow passes only Stage credentials.

## Policy

- `CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED=1` is required; the variable is absent
  or disabled by default at merge.
- The schedule runs once per day with a strict 30-day cutoff.
- One run can create at most one batch of 5,000 transactions. It never drains a
  backlog in a loop.
- Selection starts at the beginning of `(created_at, id)` on every new cycle and
  chooses the oldest currently hot, unmapped, prunable technical rows. Manual
  manifests without `source_policy_id` never drive the cursor.
- A missing candidate is a successful no-op.

The JSONL is produced by the prunable-only exporter mode. The manual exporter
mode remains unchanged. The database pruner repeats the complete technical,
registry, conservation, table, escrow, proof, receipt and mapping checks before
any delete.

## Recovery durability

Before execute, the existing private `chips-ledger-archive` bucket must contain
and privately return both deterministic, no-overwrite (`x-upsert=false`) gzip
objects:

```text
recovery/v1/sha256/<compressed-sha>.jsonl.gz
recovery/v1/sha256/<compressed-sha>.recovery.json.gz
```

Both objects use `application/gzip`. The first is a complete second copy of the
verified archive. The second is the gzip-compressed recovery manifest containing
the target identity, policy ID, archive metadata and immutable ID proof. Upload
is followed by private download and byte/SHA verification for both objects.
Execute is refused until both copies match the expected bytes. Restore uses
these recovery objects and does not require the primary archive object.

The local working bundle remains `0700` with `0600` files. A partial, different,
or missing durable copy is fail-closed. After a post-commit runner failure,
receipt/mappings and the normal `already_pruned` path are used; no blind retry or
new batch is created.

## Operator runbook

The automation has no force, repair, or state-skipping mode. Do not invoke the
pruner with `--execute` by hand, edit an archive manifest, clear an idempotency
mapping, delete a Storage object, or enable the kill switch to get past one of
the states below. Keep the Stage cycle blocked and preserve all evidence until
the condition is resolved.

### Pending, partial, or ambiguous manifest

If the aggregate Job Summary reports `pending`, a partial proof/receipt, more
than one incomplete manifest, an invalid policy, or another ambiguous state:

1. Do not rerun the cycle and do not create a second batch.
2. Record the aggregate state, object path, compressed SHA-256, policy ID,
   transaction/entry counts, and timestamps from the Job Summary. Never copy
   ledger rows, recovery contents, credentials, or database URLs into a ticket
   or chat.
3. Using read-only access, compare the single Stage manifest, its primary
   private object, and the corresponding recovery paths. Check target identity,
   policy ID, MIME type, object size, and SHA-256 before taking any repair
   action.
4. Escalate the exact evidence to the ledger owner. Leave the manifest and
   Storage objects untouched unless the owner approves a controlled recovery
   repair; the automation must continue to fail closed.

### Missing or partial durable recovery

For a proven or pruned cycle, both recovery objects are mandatory. If either
object is missing, has the wrong MIME type/size/SHA-256, cannot be privately
downloaded, or the pair is otherwise partial:

1. Do not run `--execute`, register a new proof, overwrite an existing object,
   or start a new archive batch. The primary archive object is not a substitute
   for the recovery pair.
2. Preserve the manifest and the surviving object. Confirm that the expected
   paths are derived from the immutable compressed SHA-256 and that no object
   at either path differs from the expected bytes.
3. With explicit ledger-owner approval, restore only the missing copy from the
   same verified archive/proof evidence using private, no-overwrite Storage
   semantics. If the primary object is unavailable, use an independently
   verified recovery source; never reconstruct bytes from a mutable or
   unverified source.
4. Privately download both recovery objects again and compare bytes and SHA-256
   to the expected values. Only after both copies pass may the normal Stage
   automation be allowed to resume. A mismatch remains blocked and is a manual
   incident.

### Proven without recovery

This is the state `archive_proof_verified_at` is complete while `pruned_at` is
still null and no complete durable pair exists. It is not permission to retry
the prune. Stop the run, preserve the immutable proof and primary manifest,
repair/verify the two private recovery objects through the procedure above,
and then let the normal cycle repeat its dry-run and all revalidation checks.
The next allowed path is proof revalidation followed by recovery verification
and only then execute; there is no operator shortcut.

### Post-commit or already-pruned recovery

If the receipt and mappings are complete, the cycle is revalidated through
`already_pruned`. It still requires the complete recovery pair and immutable
proof. A missing or partial pair is an incident, not a reason to create a new
batch. Keep the environment fail-closed until the pair is restored and passes
private download and byte/SHA verification.

## Resume and locking

GitHub Actions concurrency is complemented by a target-specific PostgreSQL
session advisory lock held for the entire cycle. A busy lock is a no-op; a lost
lock session aborts the cycle. Pending, partial, mismatched or otherwise
ambiguous own manifests stop the run and are reported in the aggregate Job
Summary. A committed manifest with no proof can resume only through the normal
proof/dry-run path. A proven manifest must have a complete durable recovery
pair; with that pair it is fully revalidated before execute, while a missing or
partial pair is fail-closed. A pruned manifest with a complete pair is
rechecked through `already_pruned`. Every allowed resume repeats identity,
policy, archive, recovery, proof, receipt and mapping verification.

Logs and Job Summary contain only aggregate counts, sizes, hashes and state. They
never contain ledger records, credentials, DB URLs, service keys or recovery
contents. No Actions artifact is used for recovery.

## #889 Phase A audit (2026-08-14)

This is the read-only Stage 2B.5 audit performed against `origin/main` at
`8198e07ab79629aa9727e28b8969a3d3ac8c95f9`. The repository instructions and
the current GitHub state for Issues #874, #886, #889, #890 and #891 were
rechecked before the audit. Stage and Production were queried through the
existing service configuration with repeatable-read, read-only transactions.
No SQL mutation, Storage operation, archive export, proof, recovery write or
prune was performed.

The runtime fences observed in the audit were:

- Stage project: `krydukthwdvccggbyjfw`.
- Stage PostgreSQL system identifier: `7656985631720456337`.
- Production project: `otbqfijerkieoxwpxjnm`.
- Production PostgreSQL system identifier: `7575202818581710058`.
- Read-only GitHub variable verification returned
  `CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED=1`. No variable or workflow setting
  was changed by this audit.
- Stage was running from `/opt/arcade-ws-preview`; Production was inspected
  read-only only. Secret values and database URLs were not printed.

### Inventory snapshot

The live snapshot was taken around 14:23 UTC. Stage is active, so its counts
can increase between read-only statements. All observed transactions had two
entries and every transaction and account aggregate was balanced.

| tx_type | Stage transactions / entries | Stage older than 30d | Production transactions / entries | Production older than 30d |
| --- | ---: | ---: | ---: | ---: |
| `ADMIN_ADJUST` | 6 / 12 | 0 / 0 | 0 / 0 | 0 / 0 |
| `BUY_IN` | 11 / 22 | 0 / 0 | 0 / 0 | 0 / 0 |
| `CASH_OUT` | 11 / 22 | 0 / 0 | 0 / 0 | 0 / 0 |
| `MINT` | 2 / 4 | 0 / 0 | 2 / 4 | 0 / 0 |
| `PROMO_BONUS` | 6 / 12 | 0 / 0 | 1 / 2 | 0 / 0 |
| `TABLE_BUY_IN` | 25,064 / 50,128 | 0 / 0 | 54 / 108 | 0 / 0 |
| `TABLE_CASH_OUT` | 16,034 / 32,068 | 0 / 0 | 47 / 94 | 0 / 0 |
| `WELCOME_BONUS` | 6 / 12 | 0 / 0 | 0 / 0 | 0 / 0 |
| **total** | **41,140 / 82,280** | **0 / 0** | **104 / 208** | **0 / 0** |

The exact physical relation sizes at the same audit point were:

| relation | Stage heap / indexes / total bytes | Production heap / indexes / total bytes |
| --- | ---: | ---: |
| `chips_accounts` | 1,056,768 / 1,712,128 / 2,809,856 | 81,920 / 335,872 / 458,752 |
| `chips_entries` | 10,944,512 / 17,907,712 / 28,893,184 | 327,680 / 974,848 / 1,343,488 |
| `chips_ledger_archive_batches` | 8,192 / 49,152 / 65,536 | 8,192 / 32,768 / 49,152 |
| `chips_transaction_idempotency` | 10,452,992 / 6,438,912 / 16,932,864 | 32,768 / 40,960 / 106,496 |
| `chips_transactions` | 27,615,232 / 9,994,240 / 37,650,432 | 696,320 / 598,016 / 1,335,296 |
| `poker_requests` | 417,792 / 237,568 / 753,664 | 81,920 / 319,488 / 442,368 |
| `poker_state` | 3,915,776 / 163,840 / 4,120,576 | 245,760 / 65,536 / 352,256 |
| `poker_tables` | 958,464 / 11,812,864 / 12,812,288 | 8,192 / 188,416 / 237,568 |

The hot ledger relation total was 66,543,616 bytes on Stage and 2,678,784
bytes on Production. The full database sizes were 259,804,307 and 20,966,547
bytes respectively. These are measurements, not per-row byte estimates.

Stage `TABLE_BUY_IN` and `TABLE_CASH_OUT` are the only material growth classes.
The exact two-entry technical shape is present for 24,933 and 15,922 Stage
transactions respectively; the remaining 131 and 112 transactions in those
classes involve a USER entry. The corresponding Production split is 36/18
and 32/15. The technical Stage classes produced 1,369.9 transactions/day over
the 30-calendar-day window; the conservative sum of their observed daily
peaks was 4,078 transactions/day (8,156 entries/day). The daily v1 limit of
5,000 transactions is therefore above the observed conservative peak.

Stage currently has 3,259 `CLOSED` and 5 `OPEN` poker tables. The table-marker
ownership split was:

- Stage `TABLE_BUY_IN`: 12,847 `CLOSED`, 12,202 missing table rows, 15
  `OPEN`.
- Stage `TABLE_CASH_OUT`: 9,675 `CLOSED`, 6,359 missing table rows.
- Production `TABLE_BUY_IN`: 16 `CLOSED`, 38 missing table rows.
- Production `TABLE_CASH_OUT`: 11 `CLOSED`, 36 missing table rows.

All account rows observed on both environments were active; the total ledger
entry amount and the sum of current account balances were both zero. There
were no unbalanced transactions. This confirms conservation for the current
hot state, not bounded growth for the whole database.

The direct `PRUNABLE_CANDIDATE_SQL` count on Stage was zero. No transaction or
entry in either environment was older than the 30-day cutoff, so there was no
natural Stage candidate for a new evidence package.

### Dependency and accounting decision

The current consumers were traced through the shared ledger, the poker
persistence/terminal-close paths, user/admin history, idempotency replay and
the relevant migrations.

- `TABLE_BUY_IN` and `TABLE_CASH_OUT` system-only rows are already the
  `archive_safe_and_material` class of `stage-ledger-auto-retention-30d-v1`.
  The v1 selector still requires the exact SYSTEM/ESCROW two-entry shape,
  matching registry identity, active zero-balance escrow, and an absent or
  `CLOSED` table. It remains unchanged.
- USER-involved table transactions are `blocked_unproven` for archival and
  negligible for this capacity decision. User history reads hot entries, and
  terminal-close/bot provenance can require historical table funding rows.
  No cold-read path or archive contract for those rows exists.
- `BUY_IN`, `CASH_OUT`, `WELCOME_BONUS`, `PROMO_BONUS` and `ADMIN_ADJUST` are
  user-facing or administrative classes with current history/replay
  dependencies. `bonus_claims.transaction_id` is an `ON DELETE RESTRICT`
  dependency for bonus transactions. They are currently
  `negligible_for_capacity`, not newly archive-safe classes.
- `MINT` is a two-row system seed in both inventories and is
  `negligible_for_capacity`; no destructive extension is justified.
- `HAND_SETTLEMENT`, `RAKE_FEE` and `PRIZE_PAYOUT` are represented by the
  accounting contract/producers but had no rows in these live inventories.
  They remain `blocked_unproven` for pruning until their replay, user-history,
  provenance and recovery contracts are separately demonstrated.
- `chips_transaction_idempotency` is durable by design and remains in the
  scope of #890. This audit does not claim bounded growth for that registry,
  orphan accounts, Storage, or the whole database.

`FULL_REPLAY_TX_TYPES` covers `BUY_IN`, `CASH_OUT`, `WELCOME_BONUS`,
`PROMO_BONUS` and `ADMIN_ADJUST`. `TABLE_BUY_IN` and `TABLE_CASH_OUT` are not
full-replay types. The existing user-history and replay behavior therefore
does not permit broadening v1 to the USER-involved subset.

### Archive-schema audit

Archive JSONL `schema_version=1` contains the transaction identity, sequence,
type, idempotency and payload evidence, metadata/reference, table and escrow
context, every entry, account snapshots and the immutable archive ID proof.
The recovery manifest `recovery_schema_version=1` adds the target/policy and
physical identity, archive SHA/count/amount evidence and both exact-ID hashes.
That is sufficient for the existing technical system-only v1 rows. It is not
sufficient to replace user history, bonus-claim references, or the full replay
snapshots required by other classes. No new archive or recovery schema is
needed because Phase B is not justified.

### Archive state and capacity gate

The Stage automation-owned state was one committed v1 batch with complete
proof and receipt, already pruned, and no pending or incomplete v1 cycle. The
Stage registry contained 43,144 rows: 2,004 mapped archive rows, 41,140
unmapped rows, 40 complete replay snapshots and no partial snapshots. The
zero missing-registry and identity-mismatch checks passed; the 2,004 registry
references to absent hot transactions are the expected durable mappings for
previously pruned rows.

Historical manual manifests remain untouched and are not automation-owned:
four committed rows with a null policy (three proven/pruned and one
unproven/unpruned), plus one pending null-policy row. The orchestrator filters
by the v1 policy ID, so these rows do not drive its cursor. Production has one
committed, proven and pruned archive row and no `source_policy_id` column; it
remains default-deny for Stage automation.

Phase A does not justify Phase B. No new policy ID, selector, migration,
workflow, authorization framework, archive schema or prepare-only path was
added. The material technical classes already use the existing v1 pipeline,
and all other currently growing classes are either negligible or lack a safe
archive/recovery contract.

The oldest currently remaining potentially v1-eligible system-only row is
`2026-07-17 22:02:19.366Z`. Because the selector uses a strict 30-day cutoff,
that cohort first becomes eligible immediately after
`2026-08-16 22:02:19.366Z`. The first scheduled `17 2 * * *` run after that
instant is `2026-08-17 02:17:00Z`.

The observed conservative `4,078 transactions/day` peak is the sum of two
class-specific peaks rather than one same-day cohort. The `TABLE_BUY_IN` peak
of 2,673 occurred on 2026-08-04 and enters the retention window at
`2026-09-03 00:00:00Z`; the `TABLE_CASH_OUT` peak of 1,405 occurred on
2026-08-10 and enters it at `2026-09-09 00:00:00Z`. Thus the full conservative
peak envelope is in the retention window by `2026-09-09 00:00:00Z`. The
highest actual same-day combined count was 4,014.

The concrete blocking follow-up is [#892 — Stage ledger plateau — verify v1
drain after first 30-day eligibility window](https://github.com/krzysztofcal/arcadePlatform/issues/892).
It must compare actual `PRUNABLE_CANDIDATE_SQL` backlog before and after the
scheduled runs for both the first cohort and the two peak cohorts, and verify
archive, proof, durable recovery, receipt, mappings and v1 throughput. Rows
per day alone are not sufficient evidence.

The capacity status is therefore:

> hot `chips_transactions`/`chips_entries` plateau within #889 scope not yet
> proven; verification is owned by #892. No `retained_hot_sustainable`
> decision is made here.

The follow-up must not broaden v1 or execute a new class. If a future Phase B
does become necessary, it must first document the exact new tx types,
eligibility predicates, archive/recovery evidence and capacity impact, create a
new immutable policy ID, and stop before the first destructive Stage prune for
human approval.
