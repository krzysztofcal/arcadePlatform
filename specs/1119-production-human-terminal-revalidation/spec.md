# #1119 — Production human terminal revalidation

Owner authorized code implementation, tests and Draft PR; no Production operation. Base main:6b3b4389a8ec457504bac9488b8f75489da2b417. Supersedes the issue's disk-audit deferral.

A completed human archive must remain verifiable after marker-gated WS cleanup removes the table. Current latestCompleted → finalizer → policy dry-run calls the live lifecycle gate before already_pruned, raising P9231. Incident run38900239807 (and38866974684), batch4/table7f3d73e4-36c5-4b66-afe6-d1d41bea13e2.

## Acceptance criteria

- Completed automatic history is verified read-only against exact identity/policy/batch/cutoff, GO, immutable archive/proof, both durable recovery copies, complete matching receipts, all exact retained bindings and zero selected hot rows. Absence alone never proves completion.
- A missing table additionally requires a private immutable lifecycle receipt produced after a committed, verified marker. The existing E3 activation is the only legacy completion evidence: its exact policy canary4 was explicitly checked for the marker by the immutable E3 transaction. No arbitrary old batch fallback or fabricated marker.
- Present tables keep the current locked SQL lifecycle assertions/completion/marker verification. Automatic completion publishes/verifies one deterministic gzip lifecycle receipt using existing immutable Storage primitives; subsequent verification makes no writes. If publication fails after DB completion, fail closed; present-table retry can publish after re-verification. If cleanup removes the table before publication and the process loses its evidence, fail closed for owner recovery; never infer completion from absence.
- A proven absent completed table permits selecting one subsequent candidate; it never repeats export/prune for the old batch. Existing one-batch/cap/lock/authorization/recovery guards remain unchanged.
- Manual PREPARE/CANARY/lifecycle-completion and Stage behavior stay unchanged. No E3/SQL/schema/WS/scheduler changes. Keep #891/#992/#1119 open until separate reviewed Production authorization and natural post-fix observation.

## Operational impact

Automatic human completion now depends on one additional small private immutable gzip object under recovery/v1/sha256/<archive-sha>.human-lifecycle.json.gz. This is completion evidence, not a third financial recovery copy. Missing/corrupt/unavailable evidence is fatal; do not delete it. Existing canary4 uses verified E3 activation evidence without backfill or Storage mutation. Current E3 SHA remains88e622855c79b467fe03f063dc4c19e39394745e4ef5fc14ab2a7afede719460. No eligible transaction classes or financial contracts broadened.
