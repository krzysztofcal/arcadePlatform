# Issue #894: escrow-account retirement audit

Audit baseline: `origin/main` at `b4df77e01e15d1bf67fe5a76a18f32d0dde0b50d`.
The audit is code/schema-only on this branch. No Stage credentials were
available, so no live Stage or Storage read was attempted.

## Dependency and recovery audit

| dependency or consumer | observed contract | retirement consequence |
| --- | --- | --- |
| `chips_entries.account_id` | FK to `chips_accounts.id` with the default `NO ACTION` delete rule | every entry must be absent before delete; the database function rechecks it |
| `chips_account_snapshot.account_id` | FK to `chips_accounts.id` with `ON DELETE CASCADE` | a snapshot is still a blocker; the function never relies on the cascade |
| `chips_transactions` | entries reference transactions with `ON DELETE CASCADE`; archive pruning already removes the proven transaction/entry set | transaction identity and registry residue are checked before account retirement |
| `chips_transaction_idempotency` | durable replay JSON and table/archive mappings; rows are protected from direct delete | all mappings and table identities must be absent |
| `poker_tables` / `poker_state` / seats / actions | table-owned runtime data is cascaded by table deletion; the escrow account is created independently | an existing table is always a blocker; WS closed-table cleanup is not an authorization path |
| runtime lookup/create | `poker-table-init.mjs` derives `POKER_TABLE:<uuid>` and uses `INSERT ... ON CONFLICT(system_key) DO NOTHING`, then reads the UUID | table recreation does not deterministically recreate the old random account UUID; the recovery snapshot is authoritative |
| replay | idempotency rows retain `replay_transaction` and `replay_entries` JSON | deleting a table/account is allowed only after archive, prune and registry receipts are complete; the exact account ID remains recoverable from the object |
| admin/reconciliation | current admin summary reports positive closed/orphan residuals; it must also expose zero-balance orphan count and retirement backlog without turning query errors into zero | the new summary fields are nullable when unavailable |

There are no other applied foreign keys referencing `chips_accounts.id` in
the audited migrations. The only user-defined delete trigger is the new
retirement guard; the new database function repeats both catalog checks at
execution time and fails closed if a future migration adds an unknown FK or
delete trigger.

## Archive evidence required

The retirement unit is an already committed schema-v2 archive batch. The
function requires the canonical Stage identity, active TABLE fence, immutable
manifest, complete archive ID proof, prune receipt, registry cleanup receipt,
destructive GO and the policy-specific bot-only or legacy proof. A legacy
batch must also match its frozen master/batch table list and run/plan binding.

Before the delete, the automation builds a canonical account snapshot and
stores it at:

`account-recovery/v1/sha256/<compressed-sha256>.json.gz`

The object is private and create-only (`x-upsert=false`). It contains the
complete account row, exact sorted account IDs, table IDs, policy, archive
manifest/proof/receipt bindings, Stage identity and the canonical snapshot
hash. A second read verifies MIME, size, gzip/JSON, canonical bytes and both
hashes. Existing equal bytes are reused; partial or mismatched objects block.

## Read-only classification

The audit module classifies every account whose key starts with `POKER_TABLE`
(including malformed, USER and SYSTEM rows as explicit blockers) as one of
`OPEN_TABLE`, `RETAINED_CLOSED_TABLE`,
`MISSING_TABLE_NON_ZERO`, `MISSING_TABLE_HOT_ENTRIES`,
`MISSING_TABLE_ACCOUNT_SNAPSHOT`, `INCOMPLETE_ARCHIVE`,
`SAFE_BOT_ONLY_CANDIDATE`, `SAFE_LEGACY_CANDIDATE` or
`MALFORMED_AMBIGUOUS`. It also reports already retired batches separately
from eligible candidates and retains skip reasons in the workflow summary.

The safe candidate classes require a missing table, an active zero-balance
canonical ESCROW account, no entries, no snapshot, no table/registry mapping,
and complete archive evidence. USER and SYSTEM accounts are never in scope.

## Guard and rollout decision

The forward-only migration adds an all-or-nothing immutable account-retirement
receipt to `chips_ledger_archive_batches`, an independent Stage-only policy
row disabled by default, a validated SERIALIZABLE database function, and a
trigger that rejects direct deletion of an ESCROW account from
`chips_accounts`. The execute function
sets a transaction-local guard only after all checks and records the receipt
in the same transaction as the exact delete.

The default-off policy means this branch cannot start destructive retirement.
The intended rollout is read-only audit, exact canary prepare/recovery
verification, owner authorization `GO <batch_id>` only after the current
candidate and prepared account recovery are revalidated, canary execute,
review of the complete receipt, and only then owner activation. Production
identity is rejected by the existing Stage gate and by the new function.

## GitHub Actions rollout path

The scheduled `*/15` path remains only `--automatic`. The same trusted
workflow now exposes separate `workflow_dispatch` modes:

1. `escrow-retention-audit` — read-only audit;
2. `escrow-retention-prepare-only` — prepare one exact `batch_id` and create or
   reuse its account recovery object;
3. `escrow-retention-authorize-canary` — owner-controlled `GO <batch_id>` with
   the independently copied sorted-account-ID SHA-256; the application and
   database both revalidate the current candidate before writing canary state;
4. `escrow-retention-execute` — one exact canary execute with the same batch,
   account-ID hash and `GO`;
5. `escrow-retention-verify` — read-only verification of one exact recovery
   path using `VERIFY <recovery_object_path>`;
6. `escrow-retention-activate` — owner-controlled exact
   `ACTIVATE stage-ledger-escrow-account-retention-v1 CANARY <batch_id> <account_ids_sha256>`.

These six modes use inputs dedicated to account retention and are accepted
only for the canonical repository's `main` ref. They cannot reuse the
existing ledger-prune authorization input, and the workflow does not expose a
restore mode.

The recovery verifier accepts either a remote `--object-path` or a local
`--file`. With only `--file`, it derives
`account-recovery/v1/sha256/<compressed_sha256>.json.gz` from the local bytes;
an optional `--object-path` must match that derived path. A batch restore
requires the range-scoped confirmation
`RESTORE <batch_id> <account_ids_sha256>`; that confirmation identifies the
whole recovery batch and its sorted account-ID set, rather than one account.
If a crash or an older tool left a partial set, every existing row must first
match its snapshot and only missing rows are inserted in the same transaction;
conflicts, hot dependencies and table/registry state remain blockers.
