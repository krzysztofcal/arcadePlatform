# Feature Specification: 12-month cap for settled user-linked history (#1157)

**Feature**: `1157-settled-data-retention` · **Created**: 2026-11-05 · **Status**: Draft, awaiting owner review
**Source**: https://github.com/krzysztofcal/arcadePlatform/issues/1157 · **Parent**: #1138 M1, #1140 P04/P07
**Inventory**: [research.md](research.md)

## Goal

Eligible settled user-linked history, including private archive and recovery copies, is kept at most 12 months. Exceptions (active balance, unsettled escrow, security tombstones, idempotency where still needed) are explicit, minimal and documented with their own expiry or rationale. Privacy and Data safety statements can then be written truthfully. Account deletion (#1117) and earlier rights requests stay independent and are never delayed to 12 months.

## User Scenarios & Testing

### US1 — Archive copies expire (P1)

Committed and already pruned ledger archive batches whose newest archived row is older than 12 months lose all their Storage objects. The batch metadata row stays as non-personal evidence, keeps `status='committed'` and gets `objects_expired_at`.

**Independent test**: existing archive suites with a fake Storage client. A batch older than the cutoff loses exactly its known paths and gets `objects_expired_at`. A younger, `pending`, not-yet-pruned, wrong-project or replay-referenced batch is untouched. A Storage error or ambiguous result leaves `objects_expired_at` NULL and stops the run. A second run is a no-op.

### US2 — Small user-linked tables expire or are minimized (P1)

- `poker_gift_purchases` older than 12 months is deleted only when its table no longer exists or is `CLOSED`.
- `account_deletion_requests` with status `COMPLETED` older than 12 months keeps only the fields the tombstone fence needs; `progress` and the status token are cleared.

**Independent test**: SQL function contract tests on disposable PostgreSQL. Rows younger than the cutoff, an old gift on an OPEN table and non-COMPLETED requests are untouched. The per-run limit is respected. The result returns counts only.

### US3 — Decided exceptions are documented (P1)

Each remaining gap from research.md has an owner decision: expire, minimize, or keep with a rationale. The decision text can be copied into Privacy/Data safety.

## Functional Requirements

- **FR-001** Cutoff is `now() - interval '12 months'`, evaluated in SQL. A batch qualifies by `last_created_at`, never by `created_at`.
- **FR-002** Archive expiry deletes only the exact deterministic paths derived from the batch `object_path` (primary, `recovery/` copy, `.recovery.json.gz`, `account-recovery/` when recorded). It never lists or downloads the bucket.
- **FR-003** Status stays `committed` (the existing `status_check`/`commit_state_check` and the readers of `status='committed'` are untouched). `objects_expired_at` is set only after every DELETE returned success or not-found. Any other result fails closed and leaves it NULL for the next run. Only batches with `pruned_at is not null` qualify, because an unpruned batch still needs its archive.
- **FR-004** No batch expires while a `chips_transaction_idempotency` row with that `archive_batch_id` still holds `replay_transaction`, unless D1 decides otherwise. This is checked in the selector and rechecked under lock right before the first DELETE; prune writers take the same global Production advisory lock (FR-009 of #891).
- **FR-005** `automatic`: at most 10 archive batches and 5000 table rows per run. `canary`: exactly the one confirmed batch ID and no table rows. One run per schedule, no backlog loop.
- **FR-006** Uses the existing Production global advisory lock, the `production-ledger` environment and the canonical target checks in `scripts/ops/chips-ledger-production-automation.mjs`. Default OFF behind a new policy enable flag, like the four existing classes.
- **FR-007** Stage runs first through the existing Stage automation with the Stage profile. Production needs a separate explicit owner GO for migration, diagnostic, canary and activation.
- **FR-008** Never deletes or edits rows that define a live balance: USER `chips_entries`/`chips_transactions` of active accounts, `chips_account_snapshot`, unsettled ESCROW.
- **FR-010** Never expire the active batch, nor a batch still pending escrow retirement (`bot_only_table_id is not null and account_retirement_at is null`). Escrow selectors ignore expired batches. The latest completed batch per policy follows D7 (research.md T003).
- **FR-009** Logging via `klog` with counts and batch IDs only, no user IDs.

## Owner decisions required

- **D1 `chips_transaction_idempotency` older than 12 months.** Keys embed user UUIDs, so nulling `user_id` alone is not minimization. Recommendation: delete rows whose `transaction_created_at` is older than 12 months and whose transaction is no longer hot (already archived/pruned or the table no longer exists). Rationale: WS-generated keys cannot recur after table deletion (7 d). Risk: a client-supplied key replayed after 12 months would execute as new. Alternative: keep as a security/financial exception.
- **D2 hot USER ledger rows of active accounts older than 12 months.** Recommendation: exception "current balance of an active account". Rows are needed for `entry_seq`/balance proof; a later compaction to a snapshot is a separate issue.
- **D3 tombstones** (`account_deletion_requests.old_user_id`, retired `chips_accounts`). Recommendation: keep the UUID indefinitely as a security exception. It prevents a deleted UUID being reused as an anonymous XP/account identity (`store-upstash.mjs`). After minimization, no other personal data remains.
- **D5 retired accounts' ledger history and snapshots** (USER rows incl. the deletion burn, `chips_account_snapshot` of retired accounts). Recommendation: a financial-record exception for now, because deleting them breaks entry-sequence and conservation proofs. The UUID is pseudonymous once the profile is gone. A follow-up compaction issue can set a dated expiry. Alternative: owner sets a fixed maximum (e.g. 24 months) now.
- **D6 `poker_requests` on long-lived OPEN tables.** Rows are removed only by cascade when the table is deleted. Recommendation: add to `chips_settled_retention_12m_run` a bounded delete of rows older than 12 months, excluding `kind = 'ACT'` with `result_json is null` (unfinished, as `closed-table-cleanup.mjs` already treats them). Alternative: document as an exception if no table can stay OPEN that long.
- **D7 latest completed batch per policy** (T003 R-A). Recommendation R-A2: the revalidation skips batches with `objects_expired_at`. Alternative R-A1: never expire it, with a documented exception.
- **D4 provider copies** (Supabase backups/PITR, logs). Recommendation: document provider windows only.

## Edge Cases

Batch with NULL `last_created_at`; `pending` batch; batch of another project; recovery object never written; object already deleted; Storage 429/5xx; lost response after DELETE; lock lost mid-run; policy disabled between selection and delete; idempotency row still pointing at the batch; gift on a table that is still open. Each one is either a reported no-op or fails closed.

## Success Criteria

- **SC-001** On Stage, one diagnostic run reports the candidate counts, then one capped run expires at least one eligible batch and its objects are gone (verified by HEAD/not-found, no download).
- **SC-002** Every research.md gap has a recorded decision (D1–D7) and a matching sentence in the Privacy/Data safety evidence list.
- **SC-003** The egress assessment in the PR shows that per-run transfer is bounded by request overhead (no object bodies).

## Breaking / operational impact

Expired archives can no longer restore pruned ledger rows older than 12 months; this is the intended behaviour. No change to WS, the browser, OAuth, the CH economy or account deletion. New migrations under `supabase/migrations/**` reach shared Stage only through a separate owner `DB Stage Apply PR` dispatch. The Production equivalent goes in `supabase/production-migrations/` and is never auto-applied.
