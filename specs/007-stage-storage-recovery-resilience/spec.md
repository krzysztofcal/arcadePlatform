# Feature Specification: Stage recovery durability after ambiguous Storage writes

**Feature Branch**: `007-stage-storage-recovery-resilience`

**Created**: 2026-09-23

**Status**: Draft

**Input**: GitHub issue #1014: prevent Stage bot-only cleanup stalls after
ambiguous Supabase Storage recovery uploads.

## User Scenarios & Testing

### User Story 1 - Reconcile an ambiguous recovery upload (Priority: P1)

As Stage automation, when a create-only recovery upload returns HTTP 504 or a
transient network error after the request was sent, I want to read the actual
object and verify its MIME type, byte length, bytes, and SHA-256 so that a
successful write is not incorrectly recorded as missing and a second POST is
never sent blindly.

**Why this priority**: The observed batch `9923` stall was caused by an
ambiguous Storage write outcome. Preventing an incorrect partial-state report
is the smallest reusable fix and protects both automatic and repair paths.

**Independent Test**: A deterministic Storage fake returns 504 or a network
error after storing the expected bytes; the helper succeeds after one POST and
a verified GET. A missing or different object fails closed without another
POST.

**Acceptance Scenarios**:

1. **Given** the initial GET is missing and the create-only POST stores the
   bytes but returns 504, **When** the helper performs reconciliation, **Then**
   it accepts only the matching object and performs exactly one POST.
2. **Given** the POST outcome is ambiguous and the subsequent GET is absent,
   unavailable, or different, **When** reconciliation completes, **Then** the
   operation reports an explicit non-complete state and performs no second
   POST.

### User Story 2 - Repair only a provably safe partial pair (Priority: P2)

As the ledger owner, I want one reusable exact-batch repair entry point for a
bot-only Stage batch whose primary archive and recovery archive are verified but
whose recovery manifest alone is missing, so that an approved repair can
restore the recovery invariant without cleanup or database changes.

**Why this priority**: A partial pair remains a legitimate fail-closed stop
state. A generic owner-gated path avoids another batch-specific implementation
while preserving the existing safety boundary.

**Independent Test**: A fixture for an arbitrary positive batch ID enters the
approved partial state and the repair creates only the missing manifest,
re-reads both recovery objects, and returns `recovery_repaired`. Repeating with
a complete pair returns `recovery_already_repaired` and performs no write.

**Acceptance Scenarios**:

1. **Given** a committed, proven, unpruned, uncleaned bot-only Stage batch with
   no destructive GO, a matching primary archive, a matching recovery archive,
   and only a missing recovery manifest, **When** the owner-gated repair runs,
   **Then** it revalidates Stage identity, fence, advisory lock, current DB
   manifest, proof, and dry-run before one `x-upsert:false` manifest POST.
2. **Given** the repair write completes or has an ambiguous response, **When**
   the repair finishes, **Then** both recovery objects are privately downloaded
   and verified as a complete canonical pair before success is reported.
3. **Given** any other recovery state, changed row, incomplete proof, cleanup
   receipt, destructive GO, mismatch, or unavailable object, **When** the repair
   is attempted, **Then** it stops fail-closed before any Storage write.

### User Story 3 - Make blocked work diagnosable and hand off safely (Priority: P3)

As an operator reviewing a failed Stage job, I want the existing GitHub Actions
Job Summary to identify the exact batch, recovery state, present/missing
objects, and required next action, so that I can request the correct owner
approval without guessing or invoking cleanup manually.

**Why this priority**: Clear evidence prevents unsafe retries and makes the
owner-gated workflow auditable without introducing a separate alerting system.

**Independent Test**: An automatic recovery failure and a repair failure each
produce a summary payload containing the batch ID, recovery state, per-object
presence, and an action that keeps cleanup blocked until verification succeeds.

**Acceptance Scenarios**:

1. **Given** a partial recovery failure, **When** the existing summary is
   written, **Then** it identifies the batch, missing manifest, recovery state,
   and read-only/owner-gated next action.
2. **Given** a complete, verified recovery pair, **When** normal automation
   resumes, **Then** cleanup behavior and the existing bounded schedule are
   unchanged and the next eligible bot-only batches remain processable.

### Edge Cases

- A 504 or transient network error may follow a committed Storage write;
  reconciliation reads through the existing bounded GET policy and never
  retries the POST.
- The object may be absent after the ambiguous response; the result is
  `write_not_visible` and the repair remains blocked.
- The object may exist with the wrong MIME, size, bytes, or SHA-256; the result
  is `mismatch` and no overwrite or delete is allowed.
- The recovery archive may be missing while the manifest exists, or both
  objects may be missing; neither state is repairable by the partial-manifest
  path.
- A complete recovery pair may be observed after a previous attempt; the
  repair is read-only and idempotently returns `recovery_already_repaired`.
- Stage identity, fence, advisory lock, current manifest, proof, dry-run, or
  lifecycle may change between reads; the operation fails closed before the
  write.
- The current audit may observe a historical/legacy incomplete object set; it
  must not broaden the repair allowlist or change cleanup cadence based on that
  observation alone.

## Storage Audit (read-only, 2026-09-23)

- **Stage target**: project `krydukthwdvccggbyjfw` (`arcade-portal-stage`),
  `ACTIVE_HEALTHY`, region `eu-west-3`, PostgreSQL 17.6.1. No write, delete,
  migration, manual execute, or live repair was performed for this audit.
- **Storage limits/configuration**: private `chips-ledger-archive` bucket,
  Standard storage, per-object limit 6 MiB, allowed MIME `application/gzip`;
  global Storage response reported 50 MiB and object versioning disabled. The
  available management/config responses did not expose a project plan quota or
  complete Storage usage/latency series.
- **Current active object inventory**: 9,933 primary archives totaling
  28,230,759 bytes; 9,929 recovery archives totaling 27,040,829 bytes; 9,929
  recovery manifests totaling 10,532,641 bytes; and 10,267 other account or
  legacy recovery objects totaling 14,372,846 bytes. The four primary-only
  gaps are old committed batches 2–5 from 2026-08-11/12, already pruned or
  outside the current bot-only incident; they are not evidence to change
  cleanup cadence or copy count.
- **Growth rate**: during the observed 24-hour window, 519 primary archives,
  519 recovery archives, and 519 manifests were created (1,032,895 bytes for
  each archive class and 445,157 manifest bytes). During seven days, each
  archive class added 4,097 objects/9,944,595 bytes and manifests added 4,097
  objects/3,516,156 bytes. This is a steady bounded workload, not proof of a
  capacity emergency.
- **Storage request/error evidence**: the 24-hour Storage log window contained
  2,038 successful uploads, 2,814 successful authenticated object GETs, 3,565
  object-info 400 responses for missing lookups, 3,266 object-info 200
  responses, and 2,715 bucket GETs for the archive path. It contained zero
  logged 429 or 5xx responses for that path. The incident run's workflow log
  records batch `9923` in `partial` recovery state after the ambiguous 504
  report, with `proof=verified`, `dry_run=ready`, and zero execute attempts;
  the Storage log window has no corresponding 504 record, so it cannot prove
  where the timeout occurred.
- **Batch `9923` current state**: the current DB row is `committed`, has
  complete immutable proof, and has `pruned_at`, `registry_cleaned_at`, and
  exact `destructive_go_batch_id=9923`. The primary archive (1,766 bytes),
  recovery archive (1,766 bytes), and recovery manifest (853 bytes) are all
  present. Historical repair run `35892725284` and normal run `35892848816`
  already resolved and consumed this incident; no live repair is currently
  needed.
- **Audit conclusion and limitation**: no confirmed capacity, request-rate,
  429, or Storage overload problem was found. The supported cause is an
  ambiguous write response that can leave the caller's durable-state model
  behind actual Storage state. The log query covers only one 24-hour window,
  and the available project/config endpoints do not provide plan quota or
  complete historical metrics; therefore this conclusion does not claim that
  transient errors never occurred outside the observed window.

## Requirements

### Functional Requirements

- **FR-001**: The existing recovery upload helper MUST treat HTTP 504 responses
  and transient network errors from a create-only recovery POST as ambiguous,
  read the same private object, and verify MIME, size, bytes, and SHA-256.
- **FR-002**: The ambiguous-write path MUST issue at most one POST and MUST
  never retry the POST blindly or use `x-upsert:true`.
- **FR-003**: The automatic bot-only path MUST remain fail-closed for partial,
  mismatched, unavailable, or not-visible recovery state and MUST NOT enable a
  new unattended repair policy.
- **FR-004**: A reusable exact-batch bot-only recovery repair MUST accept only a
  positive batch ID and the existing owner/main workflow gates; it MUST not be
  hard-coded to `9923`.
- **FR-005**: Before a repair write, the system MUST revalidate canonical Stage
  identity, active TABLE fence, advisory lock, exact committed DB row, active
  manifest, complete immutable proof, ready dry-run, unpruned/un-cleaned
  lifecycle, and matching primary/recovery archive bytes and SHA-256.
- **FR-006**: The repair MUST create only a missing recovery manifest using
  `x-upsert:false`, then privately re-read and verify both recovery objects as
  `complete`; it MUST never overwrite or delete an existing archive or manifest.
- **FR-007**: A complete pair MUST be idempotent and return
  `recovery_already_repaired` without a Storage write; all other states MUST
  remain blocked and report their state.
- **FR-008**: Existing GitHub Actions Job Summary reporting MUST expose the
  blocked batch, recovery state, per-object presence/details, and required
  action using the existing summary mechanism.
- **FR-009**: The workflow MUST keep the current schedule, batch limits,
  cleanup eligibility, Stage-only boundary, Production separation, and
  fail-closed execute gates unchanged. No migration or CI step that mutates
  Stage automatically may be added.
- **FR-010**: Fundamental tests in `tests/chips/` MUST cover an actual-write
  504/network ambiguity, missing-manifest repair, mismatch/unavailable state,
  no destructive cleanup before complete verification, and idempotent resume.
- **FR-011**: `docs/chips-ledger-stage-automation.md` MUST document the audit
  findings, evidence limitation, repair contract, operator gate, and the
  separate Stage GO needed before any live repair.

### Key Entities

- **Committed archive row**: Existing row in
  `public.chips_ledger_archive_batches`; its batch ID, policy, project, proof,
  lifecycle receipts, compressed byte count, and compressed SHA-256 are the
  authoritative repair preconditions.
- **Recovery pair**: Two private `application/gzip` Storage objects derived
  from the committed compressed SHA-256: the byte-identical recovery archive
  and canonical recovery manifest.
- **Repair outcome**: Read-only `recovery_already_repaired`, one-manifest
  `recovery_repaired`, or a fail-closed state (`partial`, `mismatch`,
  `unavailable`, `write_not_visible`, or `blocked`).

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every ambiguous recovery POST in the focused tests results in
  exactly one POST followed by verified reconciliation; no blind second POST
  occurs.
- **SC-002**: The approved partial-state fixture reaches `complete` only after
  the manifest is created and both recovery objects pass byte/SHA verification.
- **SC-003**: Mismatch, unavailable, missing-archive, both-missing, and
  not-visible fixtures produce no cleanup/execute call, no database mutation,
  and no existing-object overwrite/delete.
- **SC-004**: Existing automatic scheduling and bounded batch selection have no
  changed values in the workflow or focused regression tests.
- **SC-005**: The Stage audit records object counts/bytes, growth rates,
  operation/error observations, bucket limits, batch `9923` state, and explicit
  evidence limitations without claiming capacity or overload without proof.

## Assumptions

- The owner-gated workflow is the only supported live repair entry point; this
  PR does not dispatch it, mutate Stage, enable automatic repair, execute
  cleanup manually, or touch Production.
- No capacity, request-rate, or overload change is justified by the audit; the
  schedule, batch limits, and number of safety copies remain unchanged.
- Existing Storage, SQL, advisory-lock, fence, dry-run, and Job Summary
  mechanisms are reused; no new dependency, table, migration, or alerting
  system is introduced.
- The audit's 24-hour Storage log window is authoritative only for observed
  requests in that window. The available project/config endpoints expose bucket
  and object limits but not a project plan quota or complete historical metric
  series; absence of a 429/5xx log entry is not proof that no transient error
  occurred outside the queried window.
- The current Stage batch `9923` is already complete and cleaned after the
  historical repair/normal run; the code change is preventive and the live
  repair requested by the original incident remains a separate owner GO.
