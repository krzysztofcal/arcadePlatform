# #1119 — Production human terminal revalidation

Owner authorizes implementation/tests/Draft PR only. Base main: 6b3b4389a8ec457504bac9488b8f75489da2b417. No Production reads/writes, migration application, dispatch, deployment or merge. Keep #891/#992/#1119 open until separately authorized natural Production acceptance.

Completed human history must remain verifiable after marker-gated WS cleanup. Current latestCompleted → policy dry-run requires the deleted table before returning already_pruned and raises P9231. Incident runs 38900239807/38866974684 affected batch 4/table 7f3d73e4-36c5-4b66-afe6-d1d41bea13e2.

## Acceptance criteria

- Verify exact identity/policy/batch/cutoff, GO, private archive bytes/proof, both durable recovery copies, complete receipts, exact retained mappings and zero hot rows. Table absence alone never proves completion.
- Missing tables additionally require an immutable DB lifecycle receipt committed atomically with their marker. Only exact historical canary 4 may use E3's marker-checked activation binding. No fabricated marker or arbitrary legacy fallback.
- Present tables retain existing locked SQL gates/completion/marker checks. Every successful completion path, including manual CANARY/recheck, explicit lifecycle-completion and automatic, inserts or verifies the same DB receipt inside that transaction. Marker and receipt either both commit or both roll back. WS already uses row locks/SKIP LOCKED; no WS change or shared advisory-lock assumption.
- Receipt binds batch/table/cutoff/marker/archive SHA/transaction proof/entry proof. Its batch FK preserves the immutable financial manifest; it deliberately has no FK to the removable poker table. Owner-only SQL insertion checks canonical DB, full GO/proof/prune, live marker, lifecycle gate and retained bindings. RLS/ACL and immutable UPDATE/DELETE/TRUNCATE guards protect it.
- Proven absent history reaches the next selector without export/prune replay or financial writes. Stage, other policies, E3 and existing financial SQL functions remain unchanged. No Storage completion upload or post-commit publication dependency remains.
- Missing receipt schema must stop closed-human processing before export/GO/pruning. Unknown/mismatched evidence remains fail-closed.

## Operational/breaking impact

One additive, empty Production-only migration is required: supabase/production-migrations/20261016120000_chips_ledger_production_human_lifecycle_receipts.sql. No automatic PR/CI/merge application, backfill, activation or changes to ledger/registry/scheduler/WS. Separate owner GO must approve this exact migration/hash before the changed human workflow can process data. Confirm no active/queued old-SHA retention runs at that gate; missing schema makes the changed code fail before any new export/GO/prune. Its exact install confirmation is INSTALL PRODUCTION HUMAN LIFECYCLE RECEIPTS otbqfijerkieoxwpxjnm, passed through chips.production_lifecycle_receipts_confirmation; canonical project/system, applied E3 and Production advisory lock are also required. Never reapply E3.

Manual completion now writes one immutable metadata receipt in addition to the existing marker; idempotent rechecks write nothing. The three financial archive/recovery objects remain unchanged. Existing non-canary completed tables must still be present to establish their receipt; missing legacy history without independently durable proof is rejected. E3 SHA remains 88e622855c79b467fe03f063dc4c19e39394745e4ef5fc14ab2a7afede719460.
