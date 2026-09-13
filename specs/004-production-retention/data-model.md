# Production contract/data model

Only differences required for environment separation are introduced. Existing ledger/accounts remain the sole economic records; no new balance source or archive format.

## Target and policy identity

| Class | Production policy ID | Archive format | Selection / bounds |
|---|---|---:|---|
| existing-30d | production-ledger-auto-retention-30d-v1 | 1 | Existing technical TABLE selector, no USER entries, >30d; max2 canary /5000 activated |
| bot-only-7d | production-ledger-bot-only-retention-7d-v1 | 2 | Complete proven closed bot table, >7d, zero active escrow, authoritative post-fence eligibility; max2/5000 |
| closed-human-30d | production-ledger-closed-human-table-retention-30d-v1 | 1 | Terminal CLOSED human table and complete durable identity evidence, >30d; max2/5000 |
| escrow | production-ledger-escrow-account-retention-v1 | account snapshot v1 | Existing safe escrow classification, cleaned bot batch only, max1 batch/2 accounts |

Policy IDs are bound to project `otbqfijerkieoxwpxjnm`, system `7575202818581710058`; exact Stage pairs remain only in Stage profile. Unknown/null policy never enters automatic cleanup. Historical Production manual null-policy batch1 remains readable/verifiable with existing semantics and cap2, but is ignored by automated cycle/canary selection.

## E1 entities

- `chips_ledger_archive_batches`: existing v1 receipt fields plus required source_policy_id, bot-only proof metadata, destructive_go_at/destructive_go_batch_id, registry_cleaned_* and account_retirement_at, account_count, account_ids_sha256, recovery_object_path, recovery_object_sha256 and snapshot_sha256 fields using existing Stage column names (see inventory source definitions). All receipt tuples are all-null or fully valid immutable transitions. No Stage legacy fields/allowlist rows.
- `chips_transaction_idempotency`: existing snapshot/mapping plus table_id/key_format_version/key_format. Historical unknowns retained, never “fixed” by guessing. Bot cleaned registry may be removed only with complete proof/receipt and active fence; human mappings remain durable under existing human contract.
- `poker_tables`: bot_only_proof_eligible=false until E2 changes default for future rows; bot_only_retention_complete_at and human_retention_complete_at nullable immutable lifecycle markers. Existing historical false bot eligibility remains false forever.
- `chips_table_fence_control`: existing Stage shape; control_id=true singleton, enforcement_active=false initially, owner-controlled transition. No shared Stage rows copied.
- `chips_production_bot_only_retention_policy`: Stage bot policy shape with Production policy ID; enabled=false; canary_batch_id, activation_go_at/confirmation, activated_at null until exact fresh authorization/activation.
- `chips_production_closed_human_table_retention_policy`: Stage final human shape with Production policy ID, GO and activation fields; no hardcoded334. Preserve canary confirmation tuple and separate activation tuple guards.
- `chips_production_escrow_account_retention_policy`: Stage escrow shape with Production ID, canary account-set SHA, GO confirmation and activation fields; initially OFF and null.
- `chips_production_retention_control`: one control_id=true row; enabled boolean=false, max_transactions integer=2 with allowed values2/5000, installed_at, activated_at=null, activation_confirmation=null, existing_30d_canary_batch_id=null. E3 binds fresh existing-30d receipt and all three policy rows, flips enabled/cap atomically. Reuse archive batch proof/receipt as evidence; no second receipt registry. Owner-only guard denies arbitrary API updates, cap lowering/disable allowed only through owner function under lock. `chips_set_production_retention_enabled(false)` is the emergency disable; it cannot increase cap or set true without E3-equivalent authorization.

`chips_assert_production_retention_control` validates mode, exact project/system/policy and effective bound. All mutating entry points use this gate. During A, automatic execution is denied but exact owner-authorized canary can execute<=2 while global control disabled. During B, policy-bound automatic execution needs global enabled, class enabled and cap5000. All manual null-policy operations retain cap2. Disabled policy cannot be bypassed by CLI flags or session latch from an API role.

Escrow SQL renamed only where existing name embeds Stage: `chips_retire_production_escrow_accounts`, `chips_authorize_production_escrow_account_retirement_canary`, `chips_activate_production_escrow_account_retention`. Keep existing argument types/order and receipt behavior. Other environment-neutral function signatures stay unchanged; implementations enforce Production policy/ref. Use pruner owner/ACL exactly as final Stage contract requires; no SECURITY DEFINER owned by service_role.

## Durable state and replay

Exact manifest ownership: (project_ref, source_policy_id, object_path), immutable hashes/counts/cutoff/cursor; no “latest row” substitution for an approved batch.

`pending` → `committed` → exact proof registered → durable recovery verified → dry-run validated → exact GO/active policy → atomic prune → complete registry/lifecycle receipt → optional later account retirement. Proof/dry-run order may follow existing pipeline, but execute requires all gates freshly verified. Pending/partial/ambiguous state cannot create another batch. Post-commit retry first validates archive, receipts and remaining mappings: already_pruned/already_cleaned is success only with exact evidence, never based on missing hot rows alone.

Closed-human completion depends on complete retained registry mappings, including compatible historical Production existing30d mappings; compatibility never accepts a Stage policy/ref. Escrow remains bot-only as current Stage nonlegacy contract, excludes USER/SYSTEM/nonzero/referenced accounts and archives exact snapshot before delete. No new missing-table Production retirement operation.

## Migration history semantics

`supabase_migrations.schema_migrations` records only applied baseline versions and E1/E2/E3, never the omitted Stage versions. `manifest.json` stores source hashes/dispositions and replacement provenance for audit. If `schema_migration_files` is present, preserve it and record actual equivalent file hashes using the existing metadata convention; do not fabricate old hashes/versions. Migration transaction history write must be atomic with DDL and verify existing entry/catalog on replay. Catalog equivalence and tests are prerequisites to calling a missing shared contract covered; Stage-only objects stay not-applicable.

## Recovery artifacts

Existing `buildRecoveryManifest` and account snapshot serializer remain canonical. Identity/policy checks become explicit profile fields; do not rename JSON fields merely because an old internal variable says Stage. Any serialized identity field must carry correct Production value and be verified, even if compatibility requires retaining its historical field name. If a Stage-only field implies legacy authorization, reject/remove that mode rather than rewrite old artifacts. Bucket/paths/byte hashes remain as research.md. Accounting evidence compares retained balances and sequences for affected accounts, full entry conservation, exact removed IDs and immutable archive reconstruction; it does not infer current balances from a ledger with pruned history.

## Exact canary authorization additions

E1 adds owner-only `chips_authorize_production_existing_30d_canary(p_batch_id bigint,p_confirmation text)` using the existing exact-GO pattern and immutable archive guard latch `chips.production_existing_30d_go`. It writes the existing GO tuple and control.existing_30d_canary_batch_id only after canonical fresh policy-bound committed/proven <=2-tx evidence is validated. The archive guard permits this transition only for that owner routine's effective role and exact Production policy; no service/API grants. The generic pruner cannot execute this policy while automation is OFF without that exact GO. Bot/human/escrow retain their equivalent existing canary authorization routines. Fresh means created after control.installed_at with new Production policy and fresh verified artifacts; historical manual batch1 cannot qualify. E3 references these already completed per-policy canaries, not new canaries selected at apply time.

Production currently has no schema_migration_files table. Do not create one merely for rollout: keep new applied versions in schema_migrations and immutable SQL hashes/provenance in the reviewed manifest/evidence. If a concurrent authorized change has introduced the conventional hash table by apply time, reconcile that drift before application rather than silently skipping its expectations.
