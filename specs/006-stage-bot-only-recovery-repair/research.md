# Research: Stage Bot-Only Recovery Repair for Batch 9923

## Decision: Add an exact incident-specific repair path

**Decision**: Add a dedicated bot-only repair entry point for batch `9923` and leave the existing batch `15` function and its allowlist behavior unchanged.

**Rationale**: The current automatic path correctly rejects `PARTIAL`, while the existing bot-only repair is deliberately pinned to `15`. A generic repair parameter would broaden the destructive-adjacent surface unnecessarily.

**Alternatives considered**:

- Generalize repair to every bot-only batch: rejected because the incident requires one exact allowlisted batch and the constitution requires the smallest solution.
- Let automatic mode repair partial recovery: rejected because it would remove the owner review gate and weaken fail-closed behavior.
- Replace the recovery archive: rejected because the surviving archive must remain immutable and only the missing manifest is repairable.

## Decision: Validate the surviving recovery archive before writing

**Decision**: Read the primary archive and the existing recovery archive privately, compare their bytes, MIME, size, and SHA-256 to the committed row, then create only the missing manifest.

**Rationale**: Storage metadata alone cannot prove content equality. The existing `readPrivateObjectIfExists(...)` and `downloadPrivateArchiveObject(...)` mechanisms already provide private byte reads and hashes.

**Alternatives considered**:

- Trust `storage.objects` size/MIME/ETag: rejected because ETag is not a cryptographic SHA-256 proof.
- Reconstruct or upload the recovery archive again: rejected because it would violate the archive immutability requirement and expand the write surface.

## Decision: Reconcile HTTP 504 through a read, then stop if uncertain

**Decision**: For the exact `9923` missing-manifest create-only request, an HTTP 504 is treated as an ambiguous result. The repair performs a private GET and accepts success only when the actual object matches the expected bytes, MIME, size, and SHA-256. If the object is absent or differs, it fails closed without a second POST.

**Rationale**: A timeout can occur after Storage has committed the object. A second blind POST would incorrectly assume absence and could obscure the real state. Create-only plus a verified read gives a safe idempotent outcome without retrying an uncertain write.

**Alternatives considered**:

- Retry the POST after 504: rejected because the response does not establish absence and the operation must not make a second blind write.
- Treat every 504 as success: rejected because bytes and object identity still require verification.
- Change the shared helper's default behavior: rejected to preserve batch `15` and other existing callers exactly.

## Decision: No database or migration changes

**Decision**: Reuse the existing manifest row, proof, advisory lock, dry-run, and Storage contract. Add no migration and no Stage DB mutation.

**Rationale**: The incident is a missing Storage object, not an invalid database state. The constitution treats same-repository migrations as shared Stage mutations and requires explicit accounting; none is needed here.

## External documentation check

The official Supabase changelog and Storage updates were checked before implementation. The current entries describe platform reliability/security work, but no relevant breaking change to the existing private object GET or create-only request contract was identified. The implementation therefore continues to use the repository's existing Storage helpers and verifies actual response state rather than relying on status alone.

- https://supabase.com/changelog?types=breaking-change
- https://supabase.com/changelog?tags=storage
- https://supabase.com/blog/supabase-storage-performance-security-reliability-updates
