# Research: Stage recovery durability after ambiguous Storage writes

## Decision 1: Treat a recovery POST 504/network failure as ambiguous

**Decision**: Keep the existing one-attempt POST and immediately reconcile the
same private object with bounded GETs. Accept only an object whose
`application/gzip` MIME, size, bytes, and SHA-256 match the expected payload.

**Rationale**: The batch `9923` incident shows that a 504 does not establish
that Storage rejected a create-only write. A blind second POST would be an
unsafe assumption and is unnecessary when the actual object can be read.

**Alternatives considered**:

- Retry POST: rejected because the outcome of the first POST is unknown and the
  operation must remain create-only.
- Treat 504 as failure without a read: rejected because it recreates the
  partial-recovery stall when the object was accepted.
- Trust Storage metadata/ETag: rejected because metadata does not establish
  byte identity with the committed archive or canonical manifest.
- Change the scheduler or batch count: rejected because the audit found no
  confirmed capacity, rate, or overload problem.

## Decision 2: Use one generic exact bot-only repair for missing manifests

**Decision**: Derive recovery paths from the selected committed row and allow the
owner-gated repair for any positive exact bot-only batch. Its only writable
state is a verified primary archive plus verified recovery archive with the
recovery manifest absent. A complete pair on an otherwise eligible, unpruned
and uncleaned row returns a read-only idempotent result; a cleaned row is
rejected before result classification.

**Rationale**: The safety predicates already exist in
`assertBotOnlyExecuteBatch`, `runPruneStep` dry-run,
`inspectDurableRecoveryState`, and the archive-store helpers. Generalizing the
9923 path removes hard-coded incident data without broadening automatic
cleanup. A complete pair is idempotent only for an otherwise eligible,
unpruned and uncleaned row; lifecycle rejection takes precedence, so the
already-cleaned batch `9923` is not a repair smoke-test target.

**Alternatives considered**:

- Keep a new function for each incident batch: rejected as duplicate code and
  a recurring operational risk.
- Make automatic cleanup repair partial state: rejected because it would remove
  the explicit owner approval boundary and weaken fail-closed behavior.
- Rewrite or delete an existing recovery archive: rejected because the
  surviving archive is immutable and its bytes are evidence.
- Reuse the existing batch-15 corrected-manifest routine for missing manifests:
  rejected because batch 15 has a different known-current/known-corrected
  content contract and uses conditional replacement.

## Decision 3: Reuse existing Job Summary output

**Decision**: Add recovery state and per-object evidence to the existing aggregate
JSON only for recovery failures/results, and keep stdout plus
`GITHUB_STEP_SUMMARY` as the reporting channel.

**Rationale**: The workflow already persists the aggregate report and current
batch context. Adding fields is enough to name the blocked batch, missing
object, and required action without a second alerting system.

**Alternatives considered**:

- Add a notification service: rejected as unnecessary scope and dependency.
- Log only a human message: rejected because the existing JSON summary is
  machine-readable and already used by operators.
- Add fields to every unrelated report: rejected to avoid breaking exact summary
  contracts and noise.

## Read-only Supabase Storage audit

**Target/time**: Stage project `krydukthwdvccggbyjfw`, 2026-09-23 UTC. The
audit used only project/config reads, SQL SELECTs, advisory/performance/security
advisory reads, and unified-log reads.

**Inventory and limits**:

- Bucket `chips-ledger-archive`: private, Standard, 6 MiB per object,
  `application/gzip`; global Storage response reported 50 MiB file limit and
  object versioning disabled.
- Active object inventory: 9,933 primary archives / 28,230,759 bytes; 9,929
  recovery archives / 27,040,829 bytes; 9,929 recovery manifests / 10,532,641
  bytes; 10,267 other objects / 14,372,846 bytes.
- Four primary-only gaps are batches 2–5 from 2026-08-11/12. Their DB rows are
  old committed records already pruned or otherwise outside the current
  bot-only incident; they are not used to change the schedule, batch limit, or
  number of copies.

**Growth and requests**:

- Last 24h: 519 primary archives, 519 recovery archives, and 519 manifests;
  archive classes grew by 1,032,895 bytes each and manifests by 445,157 bytes.
- Last 7d: 4,097 objects / 9,944,595 bytes for each archive class and 4,097
  manifests / 3,516,156 bytes.
- Storage logs for the archive path in the 24h window: 2,038 successful
  uploads, 2,814 successful authenticated object GETs, 3,565 object-info 400
  missing lookups, 3,266 object-info 200 reads, and 2,715 bucket GETs; zero
  logged 429 or 5xx responses.
- Incident run `35891135575` reported `partial` recovery for batch `9923`
  after the HTTP 504 path, with verified proof, ready dry-run, no execute
  attempts, and no cleanup. The Storage log window contains no matching 504
  record, so it does not locate the timeout boundary.

**Current batch and limitations**:

- Current Stage DB/Storage state for `9923`: committed row, complete proof,
  primary archive 1,766 bytes, recovery archive 1,766 bytes, recovery manifest
  853 bytes, and non-null prune/registry-cleanup/exact GO timestamps. Historical
  repair `35892725284` and normal run `35892848816` already resolved it.
- Project status is `ACTIVE_HEALTHY`; available management/config responses
  did not expose a project plan quota or complete Storage usage/latency series.
  A single 24h log window cannot prove that transient failures never occurred
  outside the window. Therefore the audit confirms no observed capacity/rate
  emergency, not an absolute absence of all Storage faults.
- Existing security/performance advisor warnings and an unused index warning
  were observed but are unrelated to this issue and require separate owner
  decisions; this PR adds no migration or security-policy change.

## Supabase compatibility check

The official Supabase changelog was checked before implementation. The available
2026-09 entries describe service-health/advisor and reliability work, but no
breaking change affecting the repository's private object GET or create-only
Storage contract was identified. The implementation continues to verify actual
response state rather than trusting a status code.

Reference: https://supabase.com/changelog.md
