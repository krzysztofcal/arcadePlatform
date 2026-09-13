# Exhaustive Production migration inventory

Audit: 2026-09-13, main `f7983d78333b51a393c0e9a6d3dfe48ce1224c74`. Compared filenames/versions/names against both live `supabase_migrations.schema_migrations` histories. Main=Stage=97; Production=54; unknown remote versions=0. The following **43** files are the complete missing set, not just retention-named candidates.

**Classification is not permission to execute.** `shared-safe` means no environment-specific rollout authority in that change, subject to dependencies; final equivalence can supersede a safe transient patch. `stage-only` has no required shared effect. `needs-production-equivalent` includes mixed migrations whose shared changes cannot be omitted merely because the filename mentions Stage. Every required effect is covered by E1's final definitions; E2 activates only TABLE fence; E3 alone activates fresh Production policies/cap. No old missing file is replayed or marked applied by this plan.

The last already-applied Production migration, `20260813090000_chips_ledger_archive_production_canary.sql`, defines independent SQL cap 2 in `chips_assert_archive_prune_target(text,bigint)` and allows both canonical system IDs in the historically named `chips_assert_archive_prune_stage()`. Its name is therefore not a Stage-only guarantee. E1 must retain the actual Production cap, strict project/system pair and existing batch receipts, not accidentally restore older Stage-only definitions.

## Per-file category and final disposition

| Missing migration under supabase/migrations/ | Category | Production disposition |
|---|---|---|
| `20260813120000_chips_ledger_stage_automation.sql` | needs-production-equivalent | source_policy_id, immutable source guard and policy index; replace Stage allowlist with Production policy IDs. |
| `20260818100000_chips_ledger_bot_only_retention.sql` | needs-production-equivalent | TABLE registry fields, bot eligibility/markers, OFF fence, TABLE/idempotency/poker/archive guards, schema-v2 proof and bot cleanup. Install final hardened forms with Production policy/ref. |
| `20260819220000_chips_ledger_bot_only_retention_hardening.sql` | needs-production-equivalent | Fence owner/latch hardening, marker parsing, TABLE binding, immutable proof/GO, exact bot cleanup. Preserve final semantics under Production identity. |
| `20260823090000_chips_ledger_table_metadata_fence_hardening.sql` | shared-safe | Final metadata normalizer/binding validation; retain exact rejection semantics, including string-JSON compatibility. |
| `20260824120000_chips_ledger_legacy_stage_allowlist.sql` | needs-production-equivalent | Mixed legacy proof/run schema and generic prune wrapper changes. Omit legacy tables/fields/procedures; carry final shared wrapper/immutability/target safety, explicitly reject legacy policy. |
| `20260824140000_chips_ledger_legacy_stage_allowlist_freeze_guard.sql` | stage-only | Frozen legacy Stage master allowlist SHA and proof-table constraint only. Omit function, constraint and historical hash. |
| `20260825100000_chips_ledger_legacy_stage_allowlist_cleanup_hardening.sql` | needs-production-equivalent | Mixed legacy cleanup and replacements of shared TABLE binding/archive guards/fence ACL. Retain shared final guards, omit legacy cleanup latch/API; Production uses its own named fence lock helper. |
| `20260825120000_chips_ledger_stage_cleanup_orchestration.sql` | needs-production-equivalent | Mixed legacy run planning plus Stage bot singleton/activation/automatic wrapper. Omit legacy run mechanism; add Production bot singleton OFF and fresh-canary activation, Production lock/ref. |
| `20260826100000_chips_ledger_bot_only_lifecycle_gate_scope.sql` | needs-production-equivalent | Bot lifecycle gate references Stage policy; retain exact scoped lifecycle evidence and historical archive compatibility with Production IDs. |
| `20260828100000_chips_ledger_bot_only_lifecycle_receipt_hardening.sql` | needs-production-equivalent | Bot receipt idempotency/terminal hardening, Stage ref/policy; retain final checks. |
| `20260829100000_chips_ledger_bot_only_lifecycle_missing_table_hardening.sql` | needs-production-equivalent | Missing-table bot cleanup idempotency hardening, Stage ref/policy; retain strict terminal/missing-table behavior, no new eligibility. |
| `20260831120000_chips_ledger_legacy_stage_lifecycle_completion.sql` | needs-production-equivalent | Mixed poker mutation guard plus legacy lifecycle proof, batch 13 and frozen historical run hashes. Preserve bot immutability branch; omit legacy branches and batch 13 exception. |
| `20260831130000_chips_ledger_legacy_stage_lifecycle_stage_assertion.sql` | stage-only | Stage assertion inside legacy-only lifecycle pruner. Omit legacy function; keep independent Production identity gates. |
| `20260901100000_chips_ledger_legacy_stage_read_only_dry_run.sql` | stage-only | Read-only dry-run patches for legacy Stage orchestration only. Omit legacy routines and their run tables. |
| `20260902100000_chips_ledger_escrow_account_retirement.sql` | needs-production-equivalent | Account retirement receipt fields, deletion guard, Stage singleton, privileged retirement/canary/activation and Stage lock. Replace with Production counterparts; bot-only scope, no legacy branch. |
| `20260902110000_chips_ledger_escrow_account_retention_canary_revalidation.sql` | needs-production-equivalent | Fresh escrow canary revalidation tied to Stage identities/legacy proof. Production revalidates same account/ledger absence and bot receipts under its own identity/lock. |
| `20260903100000_chips_ledger_bot_only_candidate_selector_index.sql` | shared-safe | Environment-neutral candidate index experiment. Superseded by 20260903120000: final equivalent does not create it. |
| `20260903120000_chips_ledger_bot_only_candidate_selector_index_rollback.sql` | shared-safe | Environment-neutral removal of preceding candidate index. Assert final absence; do not create/drop it needlessly. |
| `20260904100000_chips_ledger_closed_human_table_retention.sql` | needs-production-equivalent | Human lifecycle column/gate/guard plus Stage singleton/policy constraint. Retain final human lifecycle contract with Production IDs and OFF singleton. |
| `20260904160000_chips_ledger_closed_human_candidate_access_idx.sql` | shared-safe | Closed-human registry access index; retain final definition after table_id exists. |
| `20260904170000_chips_ledger_closed_human_prune_whitelist.sql` | needs-production-equivalent | Generic internal pruner recognizes Stage closed-human policy; preserve whitelist/accounting distinction with Production policy and cap gate. |
| `20260904180000_chips_ledger_closed_human_canary_execute.sql` | needs-production-equivalent | Closed-human canary authorization/wrapper and generic wrapper changes reference Stage. Carry same exact GO/proof lifecycle boundary, fresh Production IDs. |
| `20260905100000_chips_ledger_closed_human_policy_rls_select.sql` | needs-production-equivalent | SELECT RLS for Stage human policy singleton. Target Production table and Production policy literal. |
| `20260905110000_chips_ledger_closed_human_lifecycle_completion_owner.sql` | shared-safe | Completion SECURITY DEFINER owner and marker-column grant; retain final pruner ownership. |
| `20260905120000_chips_ledger_closed_human_lifecycle_marker_rls.sql` | shared-safe | Human lifecycle marker UPDATE RLS using session latch; retain exact USING/WITH CHECK. |
| `20260905130000_chips_ledger_closed_human_lifecycle_completion_acl.sql` | shared-safe | Completion EXECUTE ACL and API/PUBLIC denials; retain final ACL. |
| `20260905140000_chips_ledger_closed_human_automatic_activation.sql` | needs-production-equivalent | Automatic human activation, hardcoded canary 334/table UUID/GO and Stage enabled-state assertion. Install OFF capability in E1; actual fresh Production activation only E3. |
| `20260905150000_chips_ledger_closed_human_activation_post_prune.sql` | needs-production-equivalent | Post-prune activation replacement still binds canary 334/table UUID. Use dynamic fresh Production receipt in E1/E3; no copied activation state. |
| `20260905160000_chips_ledger_bot_only_proof_perf.sql` | needs-production-equivalent | Scoped bot proof gate contains Stage source policy plus shared table_id index. Retain final gate with Production ID and index. |
| `20260905161000_chips_ledger_bot_only_proof_perf_fix.sql` | shared-safe | Shared proof query correction; consolidate into final proof definition, do not rerun textual intermediate patch. |
| `20260905170000_chips_ledger_retention_access_paths.sql` | shared-safe | Shared retention access indexes/query split; retain final indexes and final query semantics. |
| `20260905171000_chips_ledger_bot_only_proof_type_access_path.sql` | shared-safe | Shared TABLE tx-type access path; folded into final query from 20260907100000. |
| `20260905172000_chips_ledger_bot_only_proof_seqscan_guard.sql` | shared-safe | Transient enable_seqscan=off function-body patch; superseded by next migration, omit final hint. |
| `20260905173000_chips_ledger_bot_only_proof_remove_seqscan_hint.sql` | shared-safe | Remove transient seqscan hint; final equivalent has no enable_seqscan override. |
| `20260906100000_chips_ledger_escrow_execute_candidate_access.sql` | needs-production-equivalent | Shared trigram access indexes plus textual patch of chips_retire_stage_escrow_accounts. Retain final indexes and equivalent Production function query; no Stage routine. |
| `20260906110000_chips_transaction_idempotency_archive_batch_lookup_idx.sql` | shared-safe | archive_batch_id partial lookup index; retain exact final index. |
| `20260906120000_chips_ledger_bot_only_scoped_cleanup_lifecycle_gate.sql` | shared-safe | Two scoped lifecycle-gate call sites in bot pruner; retain both in final equivalent. |
| `20260906130000_chips_transaction_idempotency_transaction_id_table_id_idx.sql` | shared-safe | (transaction_id,table_id) registry index, including NULL identities; retain. |
| `20260907100000_chips_ledger_bot_only_candidate_query_shape.sql` | shared-safe | Final scoped candidate-ID proof query shape, same anomaly predicates; retain final body. |
| `20260907110000_chips_accounts_system_key_pattern_idx.sql` | shared-safe | system_key text_pattern_ops account index; retain broad malformed-key audit visibility. |
| `20260907120000_chips_ledger_closed_human_automatic_p9273_registry_binding.sql` | shared-safe | Closed-human P9273 exact full registry-set binding correction; retain distinct transaction/table and foreign mapping checks. |
| `20260911100000_chips_ledger_missing_table_bot_registry_retirement.sql` | needs-production-equivalent | Mixed schema-v1 registry-cleaned receipt/archive-guard patch plus Stage-only missing-table retirement routine. Retain effective safe receipt/GO shape; omit Stage-only one-off retirement API. This rollout does not automate missing-table registry retirement. |
| `20260912083727_chips_archive_prune_registry_cleaned_retry.sql` | needs-production-equivalent | Receipt-backed already_pruned retry is hardcoded to Stage existing-30d and depends on final human-aware pruner. Carry exact complete-receipt/zero-mappings exception with Production ID; never treat partial receipts as success. |

Totals: **22 needs-production-equivalent**, **18 shared-safe**, **3 stage-only**.

## History and equivalence proof

New versions E1/E2/E3 under `supabase/production-migrations/` are actual applied history. A checked-in manifest maps every missing old version to category, immutable source SHA256, replacement version and explicit required/omitted contract. On Production, old Stage versions stay absent. The migration guard must report them as intentional gaps and reject new unclassified main versions. Do not call `supabase migration repair --status applied`, insert their old versions, or make generic db push treat their SQL as executed. No repair is required: Production and Stage intentionally have different histories.

Before any inventory item is marked **covered**, capture normalized catalog evidence from a disposable baseline+E1 and Stage final contract: column type/default/nullability; constraints; indexes and predicates/opclasses; trigger event/timing/deferral/function; RLS enable/force flags and USING/WITH CHECK; function body/signature/owner/SECURITY DEFINER/search_path; EXECUTE/table grants and PUBLIC/API denials. Normalize only a reviewed map of Production/Stage identity, policy and explicitly renamed escrow/policy-table symbols. Exclude historical rows and legacy-only objects explicitly. Do not globally strip all literals/Stage text. Exercise actual binding, privilege, lifecycle and receipt behavior in existing PostgreSQL tests; catalog checks alone do not prove equivalence. Required differences are Production cap2/OFF, no legacy branches, fresh canary receipt binding, and conservative pre-fence eligibility.

A Stage-only item is **not applicable**, never “satisfied” by falsely recording SQL application. If a future external tool requires linear history, stop and handle that tool in a separately reviewed change; this rollout neither needs nor authorizes history repair. A live catalog mismatch blocks apply/activation; successful version-name comparison alone does not prove schema equality.

## Stage rollout contamination search

Search covered every missing SQL file for Stage project ref, PostgreSQL system identifier, policy literals, canary/batch IDs, activation confirmations/receipts, UUIDs/hashes, legacy allowlists/singleton inserts and assertions/fences. Per-source digest and object/literal references follow. Historical Stage anchors include batch **13**, canary **15** (live bot/escrow and orchestrator), canary **334**, human table `ec3f4897-c7bb-4d92-b63d-a38401e9a5c4`, run **32753223679**, cutoff **2026-08-17T16:51:28.074Z**, 974-table allowlist and frozen master hash `611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05`. Stage singleton inserts are in 20260825120000, 20260902100000, 20260904100000; activation receipt checks in 20260905140000/150000 cannot be copied. Dynamic pg_get_functiondef patches inherit prior Stage coupling even when they contain no ref literal.

The existing generic `chips_prune_committed_archive_batch_internal`, `chips_guard_archive_batch_mutations`, `chips_guard_poker_table_mutations` and `chips_validate_table_transaction_binding` were replaced by mixed legacy migrations. E1 must reconstruct their **latest effective shared** bodies; copying only the first bot migration would lose later human GO, receipt retry, owner/RLS and scoped proof fixes.

### 20260813120000

Source: [SQL](../../supabase/migrations/20260813120000_chips_ledger_stage_automation.sql) · SHA256 `8cc925eca2745e120360081dca89d76af2674124b7dc62896c5b33653a6a36ea`.

Objects/references: `chips_ledger_archive_batches`, `chips_ledger_archive_batches_stage_automation_idx`, `chips_guard_archive_source_policy_mutations`.

Target/policy discriminators: `stage-ledger-auto-retention-30d-v1`.

Historical hash/UUID literals: none.

### 20260818100000

Source: [SQL](../../supabase/migrations/20260818100000_chips_ledger_bot_only_retention.sql) · SHA256 `d72ea5960db03bec086997370bfca7d4a25cffd34b869b617b1b2f8f6a43024c`.

Objects/references: `chips_ledger_archive_batches`, `chips_ledger_archive_batches_bot_only_stage_idx`, `chips_transaction_idempotency`, `chips_table_fence_control`, `chips_table_fence_is_active`, `chips_guard_table_fence_control`, `chips_set_table_fence_active`, `chips_parse_table_idempotency_key`, `chips_table_transaction_before_insert`, `chips_validate_table_transaction_binding`, `chips_capture_transaction_idempotency`, `chips_guard_idempotency_mutations`, `chips_guard_poker_table_mutations`, `chips_guard_archive_batch_mutations`, `chips_archive_text_ids_sha256`, `chips_authorize_bot_only_archive_batch`, `chips_assert_bot_only_table_lifecycle_gate`, `chips_register_bot_only_archive_proof`, `chips_prune_and_cleanup_bot_only_archive_batch`.

Target/policy discriminators: `krydukthwdvccggbyjfw`, `stage-ledger-auto-retention-30d-v1`, `stage-ledger-bot-only-retention-7d-v1`.

Historical hash/UUID literals: none.

### 20260819220000

Source: [SQL](../../supabase/migrations/20260819220000_chips_ledger_bot_only_retention_hardening.sql) · SHA256 `4aada9e4e5caa5b50f288fc7718afe4ec1c99397a54cdb66a9d400f04e9daa1c`.

Objects/references: `chips_guard_table_fence_control`, `chips_set_table_fence_active`, `chips_parse_table_reference`, `chips_table_transaction_before_insert`, `chips_validate_table_transaction_binding`, `chips_guard_idempotency_mutations`, `chips_guard_poker_table_mutations`, `chips_guard_archive_batch_mutations`, `chips_authorize_bot_only_archive_batch`, `chips_register_bot_only_archive_proof`, `chips_prune_and_cleanup_bot_only_archive_batch`.

Target/policy discriminators: `krydukthwdvccggbyjfw`, `stage-ledger-bot-only-retention-7d-v1`.

Historical hash/UUID literals: none.

### 20260823090000

Source: [SQL](../../supabase/migrations/20260823090000_chips_ledger_table_metadata_fence_hardening.sql) · SHA256 `e436e109edb5df20d837443b941b0507692487efe6b14fc991b37e1b41405591`.

Objects/references: `chips_normalize_table_metadata`, `chips_table_transaction_before_insert`, `chips_validate_table_transaction_binding`.

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260824120000

Source: [SQL](../../supabase/migrations/20260824120000_chips_ledger_legacy_stage_allowlist.sql) · SHA256 `254a08d0d829b4acec9ce5143d1400a8447de7fb0291d897211e499846b96936`.

Objects/references: `chips_ledger_archive_batches`, `chips_legacy_stage_allowlist_proofs`, `chips_guard_legacy_stage_allowlist_proof_mutations`, `chips_register_legacy_stage_allowlist_proof`, `chips_prune_committed_archive_batch`, `chips_authorize_legacy_stage_allowlist_batch`, `chips_prune_legacy_stage_allowlist_batch`, `chips_guard_legacy_stage_allowlist_batch_fields`, `chips_assert_legacy_stage_allowlist_batch`.

Target/policy discriminators: `32753223679`, `7656985631720456337`, `krydukthwdvccggbyjfw`, `legacy_stage_allowlist_v1`, `stage-ledger-auto-retention-30d-v1`, `stage-ledger-bot-only-retention-7d-v1`.

Historical hash/UUID literals: `9bd27ff7a2749a879707e823982f708e6abf86beffcdf8f97c5deac05f00ca09`.

### 20260824140000

Source: [SQL](../../supabase/migrations/20260824140000_chips_ledger_legacy_stage_allowlist_freeze_guard.sql) · SHA256 `f4b49770604d653e7e43501e7f9354f4b73602a35ee2bf9c98a6fcbe7cb63905`.

Objects/references: `chips_assert_legacy_stage_allowlist_master_hash`, `chips_ledger_archive_batches`, `chips_legacy_stage_allowlist_proofs`.

Target/policy discriminators: `legacy_stage_allowlist_v1`.

Historical hash/UUID literals: `611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05`.

### 20260825100000

Source: [SQL](../../supabase/migrations/20260825100000_chips_ledger_legacy_stage_allowlist_cleanup_hardening.sql) · SHA256 `4cf9f056d654e4a0c1208f4a05f877ab2025cbc5784016d92da112e9f197b49d`.

Objects/references: `chips_ledger_archive_batches`, `chips_validate_table_transaction_binding`, `chips_lock_table_fence_for_legacy_cleanup`, `chips_guard_archive_batch_mutations`, `chips_prune_legacy_stage_allowlist_batch`, `chips_table_fence_is_active`.

Target/policy discriminators: `chips.legacy_stage_cleanup`, `krydukthwdvccggbyjfw`, `legacy_stage_allowlist_v1`, `stage-ledger-bot-only-retention-7d-v1`.

Historical hash/UUID literals: none.

### 20260825120000

Source: [SQL](../../supabase/migrations/20260825120000_chips_ledger_stage_cleanup_orchestration.sql) · SHA256 `da49c105bda0cf865d9480b7b54f68b495bfed3d23cb7727cd30cb39c40d0017`.

Objects/references: `chips_legacy_stage_allowlist_runs`, `chips_legacy_stage_allowlist_runs_plan_idx`, `chips_legacy_stage_allowlist_run_plan_sha256`, `chips_authorize_legacy_stage_allowlist_run`, `chips_ledger_archive_batches`, `chips_guard_legacy_stage_allowlist_run_binding`, `chips_ledger_archive_batches_legacy_run_idx`, `chips_prune_legacy_stage_allowlist_orchestrated_batch`, `chips_stage_bot_only_retention_policy`, `chips_guard_stage_bot_only_retention_policy`, `chips_bot_only_retention_automatic_active`, `chips_activate_bot_only_retention_policy`, `chips_auto_prune_and_cleanup_bot_only_archive_batch`.

Target/policy discriminators: `2026-08-17T16:51:28.074Z`, `7656985631720456337`, `ACTIVATE stage-ledger-bot-only-retention-7d-v1 CANARY `, `chips.legacy_stage_cleanup`, `krydukthwdvccggbyjfw`, `legacy_stage_allowlist_v1`, `stage-ledger-bot-only-retention-7d-v1`.

Historical hash/UUID literals: `611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05`, `a7bd1aea6bfe0435609cce6ccbe78f9ba55cab062e3cf55fd933fade5f029fc8`, `eb5593bdf5bd7f3c985373e6037a861d999413eae5076b923165c7f8147a79e7`, `f6521e7bb892c1ea3ddb566bed86bf7cac48cb305823c4c682957ef6db2d100b`.

### 20260826100000

Source: [SQL](../../supabase/migrations/20260826100000_chips_ledger_bot_only_lifecycle_gate_scope.sql) · SHA256 `b93aa14f5ba05b1b1820ffe1b210e0c6e972896d28a701498e18ce39b05ea713`.

Objects/references: `chips_assert_bot_only_table_lifecycle_gate`.

Target/policy discriminators: `stage-ledger-bot-only-retention-7d-v1`.

Historical hash/UUID literals: none.

### 20260828100000

Source: [SQL](../../supabase/migrations/20260828100000_chips_ledger_bot_only_lifecycle_receipt_hardening.sql) · SHA256 `d19a18872d7c09e09e1c43b87206d8117ec7b2f14fdb4bf83dfaa5fa5e4a7e93`.

Objects/references: `chips_prune_and_cleanup_bot_only_archive_batch`.

Target/policy discriminators: `krydukthwdvccggbyjfw`, `stage-ledger-bot-only-retention-7d-v1`.

Historical hash/UUID literals: none.

### 20260829100000

Source: [SQL](../../supabase/migrations/20260829100000_chips_ledger_bot_only_lifecycle_missing_table_hardening.sql) · SHA256 `05340e161dc60220f735efaa977980c23df5751cad768a71ac65284a45983fcf`.

Objects/references: `chips_prune_and_cleanup_bot_only_archive_batch`.

Target/policy discriminators: `krydukthwdvccggbyjfw`, `stage-ledger-bot-only-retention-7d-v1`.

Historical hash/UUID literals: none.

### 20260831120000

Source: [SQL](../../supabase/migrations/20260831120000_chips_ledger_legacy_stage_lifecycle_completion.sql) · SHA256 `1398ca8ba84650e57cc0c396983dfc741efc3909cc9694cd760e1558f60241a4`.

Objects/references: `chips_guard_poker_table_mutations`, `chips_prune_legacy_stage_allowlist_batch`.

Target/policy discriminators: `2026-08-17T16:51:28.074Z`, `32753223679`, `7656985631720456337`, `chips.legacy_stage_cleanup`, `krydukthwdvccggbyjfw`, `legacy_stage_allowlist_v1`, `stage-ledger-bot-only-retention-7d-v1`.

Historical hash/UUID literals: `611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05`, `9bd27ff7a2749a879707e823982f708e6abf86beffcdf8f97c5deac05f00ca09`, `a7bd1aea6bfe0435609cce6ccbe78f9ba55cab062e3cf55fd933fade5f029fc8`, `eb5593bdf5bd7f3c985373e6037a861d999413eae5076b923165c7f8147a79e7`, `f6521e7bb892c1ea3ddb566bed86bf7cac48cb305823c4c682957ef6db2d100b`.

### 20260831130000

Source: [SQL](../../supabase/migrations/20260831130000_chips_ledger_legacy_stage_lifecycle_stage_assertion.sql) · SHA256 `279717fd815679813311c57b93e11e657620ad1a21b45f59b2cf0a9e477e0110`.

Objects/references: `chips_prune_legacy_stage_allowlist_batch`.

Target/policy discriminators: `chips.legacy_stage_cleanup`, `krydukthwdvccggbyjfw`, `legacy_stage_allowlist_v1`.

Historical hash/UUID literals: none.

### 20260901100000

Source: [SQL](../../supabase/migrations/20260901100000_chips_ledger_legacy_stage_read_only_dry_run.sql) · SHA256 `f064c4574692137a194fa16d3577bf9ceb164aea94632abdb20b40da5f46d26f`.

Objects/references: `chips_prune_legacy_stage_allowlist_batch`, `chips_prune_legacy_stage_allowlist_orchestrated_batch`.

Target/policy discriminators: `  perform public.chips_assert_legacy_stage_allowlist_batch(`, `  result := public.chips_assert_legacy_stage_allowlist_batch(`, `krydukthwdvccggbyjfw`, `public.chips_assert_legacy_stage_allowlist_batch(text,uuid[],bigint[],uuid[],uuid[],text,text,bigint,bigint,text,text,text,timestamptz)`, `public.chips_prune_legacy_stage_allowlist_batch(text,uuid[],bigint[],uuid[],text,text,text[],boolean,bigint)`, `public.chips_prune_legacy_stage_allowlist_orchestrated_batch(bigint,text,text,uuid[],bigint[],uuid[],text,text,text[],boolean)`.

Historical hash/UUID literals: none.

### 20260902100000

Source: [SQL](../../supabase/migrations/20260902100000_chips_ledger_escrow_account_retirement.sql) · SHA256 `13b22c6aef76c0f01168237303d9b280c46df2eb58eeb02ca41488ad3113901e`.

Objects/references: `chips_ledger_archive_batches`, `chips_ledger_archive_batches_account_retirement_idx`, `chips_stage_escrow_account_retention_policy`, `chips_guard_stage_escrow_account_retention_policy`, `chips_escrow_account_retention_automatic_active`, `chips_guard_escrow_account_delete`, `chips_guard_account_retirement_receipt`, `chips_retire_stage_escrow_accounts`, `chips_authorize_stage_escrow_account_retirement_canary`, `chips_activate_stage_escrow_account_retention`.

Target/policy discriminators: `7656985631720456337`, `ACTIVATE stage-ledger-escrow-account-retention-v1 CANARY `, `chips-ledger-stage-automation-v1:krydukthwdvccggbyjfw`, `krydukthwdvccggbyjfw`, `legacy_stage_allowlist_v1`, `stage-ledger-bot-only-retention-7d-v1`, `stage-ledger-escrow-account-retention-v1`.

Historical hash/UUID literals: none.

### 20260902110000

Source: [SQL](../../supabase/migrations/20260902110000_chips_ledger_escrow_account_retention_canary_revalidation.sql) · SHA256 `94fee46ce178872c0f9c887b86c62205ccae3dca255ff993d79fbfc6a8bf9d6d`.

Objects/references: `chips_authorize_stage_escrow_account_retirement_canary`.

Target/policy discriminators: `7656985631720456337`, `krydukthwdvccggbyjfw`, `legacy_stage_allowlist_v1`, `stage-ledger-bot-only-retention-7d-v1`, `stage-ledger-escrow-account-retention-v1`.

Historical hash/UUID literals: none.

### 20260903100000

Source: [SQL](../../supabase/migrations/20260903100000_chips_ledger_bot_only_candidate_selector_index.sql) · SHA256 `86ae0b08bcab16186b76258a999249e4d92cf9e1ed6df287329e7ae3bf551661`.

Objects/references: `chips_transaction_idempotency_candidate_selector_idx`.

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260903120000

Source: [SQL](../../supabase/migrations/20260903120000_chips_ledger_bot_only_candidate_selector_index_rollback.sql) · SHA256 `8fa675ec23266d32d4ad5c8ca277fc8f24b2bece22e99eb9b6b9b977b5897a7b`.

Objects/references: Dynamic patch of prior function definition; see source signature and exact-match assertions..

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260904100000

Source: [SQL](../../supabase/migrations/20260904100000_chips_ledger_closed_human_table_retention.sql) · SHA256 `c1471acd9e044ba83bdf8d4683571dc01d0dafbe3c6114d9f26b8c80b8803049`.

Objects/references: `chips_ledger_archive_batches`, `chips_stage_closed_human_table_retention_policy`, `chips_assert_closed_human_table_lifecycle_gate`, `chips_guard_human_retention_marker`, `chips_complete_closed_human_table_retention`.

Target/policy discriminators: `legacy_stage_allowlist_v1`, `stage-ledger-auto-retention-30d-v1`, `stage-ledger-bot-only-retention-7d-v1`, `stage-ledger-closed-human-table-retention-30d-v1`.

Historical hash/UUID literals: none.

### 20260904160000

Source: [SQL](../../supabase/migrations/20260904160000_chips_ledger_closed_human_candidate_access_idx.sql) · SHA256 `31f4100d55131ac98220c0d97d6cc28ff1a5e960cb6fc49dd9624ee85bce98ba`.

Objects/references: `chips_transaction_idempotency_closed_human_access_idx`.

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260904170000

Source: [SQL](../../supabase/migrations/20260904170000_chips_ledger_closed_human_prune_whitelist.sql) · SHA256 `e0b5d945dc8af0fe8834d7df9b624435ba3b44f0f094cb4cd0d9de4dc456cc74`.

Objects/references: `chips_prune_committed_archive_batch_internal`.

Target/policy discriminators: `krydukthwdvccggbyjfw`, `stage-ledger-closed-human-table-retention-30d-v1`.

Historical hash/UUID literals: none.

### 20260904180000

Source: [SQL](../../supabase/migrations/20260904180000_chips_ledger_closed_human_canary_execute.sql) · SHA256 `8a9d126296b3a0924ea2cef01261dc560e4ad55a9946a2b12c82d7fea4835db6`.

Objects/references: `chips_authorize_closed_human_table_retention_canary`, `chips_prune_closed_human_table_archive_batch`, `chips_prune_committed_archive_batch`.

Target/policy discriminators: `krydukthwdvccggbyjfw`, `stage-ledger-closed-human-table-retention-30d-v1`.

Historical hash/UUID literals: none.

### 20260905100000

Source: [SQL](../../supabase/migrations/20260905100000_chips_ledger_closed_human_policy_rls_select.sql) · SHA256 `99b98a00f30aa5d32e6f1d3cecd0ed5f42b798d47f554379877c5b9cd4dd414f`.

Objects/references: Dynamic patch of prior function definition; see source signature and exact-match assertions..

Target/policy discriminators: `stage-ledger-closed-human-table-retention-30d-v1`.

Historical hash/UUID literals: none.

### 20260905110000

Source: [SQL](../../supabase/migrations/20260905110000_chips_ledger_closed_human_lifecycle_completion_owner.sql) · SHA256 `6cec333ea2e21372269fdf8c4039cf312b1aa67a40bfd67c77ae9980c5575e93`.

Objects/references: `chips_complete_closed_human_table_retention`.

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260905120000

Source: [SQL](../../supabase/migrations/20260905120000_chips_ledger_closed_human_lifecycle_marker_rls.sql) · SHA256 `caae1a7d1db42a61e2972cb70906d27ebc1f020bcd2917f33c9f877382ec93d2`.

Objects/references: Dynamic patch of prior function definition; see source signature and exact-match assertions..

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260905130000

Source: [SQL](../../supabase/migrations/20260905130000_chips_ledger_closed_human_lifecycle_completion_acl.sql) · SHA256 `05858538d35bda2dd2465bd0020ebc2f762c0f180d2735907b6a9dba9baab0ba`.

Objects/references: `chips_complete_closed_human_table_retention`.

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260905140000

Source: [SQL](../../supabase/migrations/20260905140000_chips_ledger_closed_human_automatic_activation.sql) · SHA256 `341da178c9c52f7ccf35fb4fd9a150b83fe9700d8118da848a8c1cd0ff607e17`.

Objects/references: `chips_stage_closed_human_table_retention_policy`, `chips_guard_closed_human_retention_policy`, `chips_closed_human_retention_automatic_active`, `chips_activate_closed_human_table_retention_policy`, `chips_auto_prune_closed_human_table_archive_batch`.

Target/policy discriminators: `ACTIVATE stage-ledger-closed-human-table-retention-30d-v1 CANARY `, `ACTIVATE stage-ledger-closed-human-table-retention-30d-v1 CANARY 334`, `krydukthwdvccggbyjfw`, `stage-ledger-closed-human-table-retention-30d-v1`.

Historical hash/UUID literals: `ec3f4897-c7bb-4d92-b63d-a38401e9a5c4`.

### 20260905150000

Source: [SQL](../../supabase/migrations/20260905150000_chips_ledger_closed_human_activation_post_prune.sql) · SHA256 `7454e76884732bb40b6eeeb564aa39ca4527c25e375cd17bbb71855e8096b5e5`.

Objects/references: `chips_activate_closed_human_table_retention_policy`.

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: `ec3f4897-c7bb-4d92-b63d-a38401e9a5c4`.

### 20260905160000

Source: [SQL](../../supabase/migrations/20260905160000_chips_ledger_bot_only_proof_perf.sql) · SHA256 `01002684fcb1ce6a3bb018ee3eae9a25d8b07bc87fcfcb6b0193fcf79adb4da7`.

Objects/references: `chips_transaction_idempotency_table_id_idx`, `chips_assert_bot_only_archive_proof_lifecycle_gate`.

Target/policy discriminators: `stage-ledger-bot-only-retention-7d-v1`.

Historical hash/UUID literals: none.

### 20260905161000

Source: [SQL](../../supabase/migrations/20260905161000_chips_ledger_bot_only_proof_perf_fix.sql) · SHA256 `339968c5c92a479da25386b589a9f6e1250c12840dcb8309157c93bef434201c`.

Objects/references: Dynamic patch of prior function definition; see source signature and exact-match assertions..

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260905170000

Source: [SQL](../../supabase/migrations/20260905170000_chips_ledger_retention_access_paths.sql) · SHA256 `eb6bd485215159f7991b4dca22338d65497128083e59b95fc983305c1b536977`.

Objects/references: `chips_assert_bot_only_archive_proof_lifecycle_gate`.

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260905171000

Source: [SQL](../../supabase/migrations/20260905171000_chips_ledger_bot_only_proof_type_access_path.sql) · SHA256 `f301d856fae16fde847b3e900a6788fae047b4641d7786a79f36990420c5f431`.

Objects/references: Dynamic patch of prior function definition; see source signature and exact-match assertions..

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260905172000

Source: [SQL](../../supabase/migrations/20260905172000_chips_ledger_bot_only_proof_seqscan_guard.sql) · SHA256 `80f7d8b06fc3dc8748355b6382d5750eab428903dedfba7d515e733b8faff4ef`.

Objects/references: Dynamic patch of prior function definition; see source signature and exact-match assertions..

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260905173000

Source: [SQL](../../supabase/migrations/20260905173000_chips_ledger_bot_only_proof_remove_seqscan_hint.sql) · SHA256 `b090b7903853d7dae0b04dfbd016ed53730d5472190e343f12c0a40745757c82`.

Objects/references: Dynamic patch of prior function definition; see source signature and exact-match assertions..

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260906100000

Source: [SQL](../../supabase/migrations/20260906100000_chips_ledger_escrow_execute_candidate_access.sql) · SHA256 `1de1fb0dc7fa1462f1722b32eebfea946febd5e053094270784263f75ab8737e`.

Objects/references: `chips_transactions_reference_lower_trgm_idx`, `chips_transactions_idempotency_key_lower_trgm_idx`, `chips_transactions_metadata_lower_trgm_idx`.

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260906110000

Source: [SQL](../../supabase/migrations/20260906110000_chips_transaction_idempotency_archive_batch_lookup_idx.sql) · SHA256 `d40d3ebfa0d4131f813662f63a074fbc8cc257b824817503b3c89b4a62b65ef1`.

Objects/references: `chips_transaction_idempotency_archive_batch_lookup_idx`.

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260906120000

Source: [SQL](../../supabase/migrations/20260906120000_chips_ledger_bot_only_scoped_cleanup_lifecycle_gate.sql) · SHA256 `f51866d6a4aee94743a4c38b435a9df29449f316766bdada53ce376e459ae995`.

Objects/references: Dynamic patch of prior function definition; see source signature and exact-match assertions..

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260906130000

Source: [SQL](../../supabase/migrations/20260906130000_chips_transaction_idempotency_transaction_id_table_id_idx.sql) · SHA256 `1154e3cdd2182062ada577cd5db1b8250d40c18b5bb6bbfcf8018ca155aacbe9`.

Objects/references: `chips_transaction_idempotency_transaction_id_table_id_idx`.

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260907100000

Source: [SQL](../../supabase/migrations/20260907100000_chips_ledger_bot_only_candidate_query_shape.sql) · SHA256 `7cbbe43078c24dfccd84ebf5b486fe8af1d67de8774a1abe79ee74540cc5409b`.

Objects/references: Dynamic patch of prior function definition; see source signature and exact-match assertions..

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260907110000

Source: [SQL](../../supabase/migrations/20260907110000_chips_accounts_system_key_pattern_idx.sql) · SHA256 `3dd1093e221f6f4446f2f724fb0848a3568bb0d16d88819682b21bebffd40369`.

Objects/references: `chips_accounts_system_key_pattern_idx`.

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260907120000

Source: [SQL](../../supabase/migrations/20260907120000_chips_ledger_closed_human_automatic_p9273_registry_binding.sql) · SHA256 `3bb0c1d88fe3459b6adaa17a6b65be95e7c21114c174f25b07ef145bd1123a44`.

Objects/references: `chips_auto_prune_closed_human_table_archive_batch`.

Target/policy discriminators: No direct Stage ref/policy literal; inherited function dependencies and exact patch shape still matter..

Historical hash/UUID literals: none.

### 20260911100000

Source: [SQL](../../supabase/migrations/20260911100000_chips_ledger_missing_table_bot_registry_retirement.sql) · SHA256 `f6de13b5331c4f2d3164d864c0ae3fb62e44cf96f90baeeb1d1a1bbf4ade3240`.

Objects/references: `chips_ledger_archive_batches`, `chips_assert_archive_prune_stage`, `chips_table_fence_is_active`, `chips_lock_table_fence_for_legacy_cleanup`, `chips_parse_table_idempotency_key`, `chips_archive_text_ids_sha256`, `chips_retire_missing_table_bot_registry_batch`.

Target/policy discriminators: `7656985631720456337`, `krydukthwdvccggbyjfw`, `legacy_stage_allowlist_v1`, `stage-ledger-auto-retention-30d-v1`, `stage-ledger-bot-only-retention-7d-v1`.

Historical hash/UUID literals: none.

### 20260912083727

Source: [SQL](../../supabase/migrations/20260912083727_chips_archive_prune_registry_cleaned_retry.sql) · SHA256 `650f7b42e65b2520bbf16ad664bd88b39f8b30789001a9b2dce21ca35b2bc4de`.

Objects/references: Dynamic patch of prior function definition; see source signature and exact-match assertions..

Target/policy discriminators: `krydukthwdvccggbyjfw`, `stage-ledger-auto-retention-30d-v1`, `stage-ledger-closed-human-table-retention-30d-v1`.

Historical hash/UUID literals: none.
