# Implementation Plan: Stage recovery durability after ambiguous Storage writes

**Branch**: `agent/issue-1014-storage-recovery-fix` | **Date**: 2026-09-23 | **Spec**: [spec.md](spec.md)

## Summary

The read-only Stage audit found no evidence of Storage capacity exhaustion,
request overload, or a sustained 429/5xx condition. The supported failure mode
is an ambiguous create-only recovery upload: the caller can receive HTTP 504 or
a transient network error after Storage has accepted the bytes. The smallest
safe change is to reconcile that outcome through a verified private GET in the
existing archive-store helper, then generalize the existing owner-gated
bot-only recovery repair so any exact positive batch can repair only a missing
manifest when both archives and all immutable evidence are verified.

Automatic cleanup remains fail-closed for partial recovery. No automatic repair
policy, schedule, batch limit, copy count, migration, dependency, Production
path, manual execute path, or Stage runtime operation is added.

## Technical Context

**Language/Version**: Node.js 20 in Actions; ESM JavaScript; local verification also runs on Node.js 22.

**Primary Dependencies**: Existing `fetch`, `postgres`, Node `crypto`/`zlib`,
and repository helpers. No new dependency.

**Storage**: Existing private Supabase Storage bucket `chips-ledger-archive`
with create-only object POST (`x-upsert:false`) and authenticated GET.

**Testing**: Existing deterministic Node tests under `tests/chips/`, focused
tests first, then `npm test` and `npm run syntax`.

**Target Platform**: GitHub Actions Stage workflow and its Node.js scripts;
Stage only, never Production.

**Project Type**: Operations CLI/workflow with PostgreSQL and Supabase Storage
adapters.

**Performance Goals**: Preserve current bounded GET retry policy and one POST
maximum for an ambiguous write; do not change scheduler cadence or batch limits.

**Constraints**: Fail closed on unknown Storage state; verify MIME, size,
bytes, SHA-256, Stage project/system identity, TABLE fence, advisory lock,
current DB manifest, proof, dry-run, and lifecycle before the only repair write.

**Scale/Scope**: Existing Stage archive bucket at roughly 10k primary and
recovery objects; this change covers bot-only exact-batch recovery and shared
recovery upload behavior, not Storage capacity management.

## Constitution Check

| Gate | Result | Evidence / condition |
|---|---|---|
| Existing mechanisms and simplest solution | PASS | Reuses `storageRequest`, `readPrivateObjectIfExists`, `inspectDurableRecoveryState`, `persistDurableRecovery`, existing lock/fence/dry-run, and Job Summary. |
| Fail-closed and Stage/Production separation | PASS | Partial/mismatch/unavailable states stop; owner/main workflow and Stage identity remain required; no Production code or credentials. |
| No automatic Stage mutation or policy enablement | PASS | Scheduled automatic path is unchanged and still refuses partial recovery; repair remains owner-gated and is not dispatched. |
| Immutable archive and no destructive cleanup | PASS | Only a missing manifest may be created with `x-upsert:false`; no archive overwrite/delete, prune execute, GO, or DB mutation. |
| Fundamental tests only | PASS | Add focused 504/network, repair, fail-closed, idempotency, summary, and workflow-gate cases to existing `tests/chips/` files. |
| No migration or dependency/config expansion | PASS | No `supabase/migrations/**`, package changes, or new alerting system. |
| Spec Kit traceability | PASS | Tasks name concrete files/functions and safety predicates; no Git commands appear in Spec Kit artifacts. |

## Research and audit outputs

- [research.md](research.md) records the read-only Storage inventory, growth,
  request/error observations, limits, `9923` evidence, and audit limitations.
- [data-model.md](data-model.md) defines recovery states, object evidence, and
  the only allowed partial transition.
- [contracts/bot-only-recovery-repair.md](contracts/bot-only-recovery-repair.md)
  defines the exact CLI/workflow and result contract.
- [quickstart.md](quickstart.md) contains repository-only validation; it does
  not dispatch a workflow or modify Stage.

## Design

### 1. Ambiguous create-only Storage writes

In `scripts/ops/chips-ledger-archive-store.mjs`:

- Keep `storageRequest`'s one-attempt write behavior.
- In `uploadOrVerifyPrivateObject`, classify POST 504 and transient network
  exceptions as ambiguous only after the request has been sent; preserve the
  existing fail-fast behavior for other upload statuses.
- Perform bounded private GET reconciliation using the existing
  `readPrivateObjectIfExists` validation. Accept only matching MIME, size,
  bytes, and SHA-256; mark the result as reconciled without issuing another
  POST.
- Return explicit `write_not_visible`, `unavailable`, or `mismatch` metadata
  on failed reconciliation so callers and summaries preserve the fail-closed
  reason.
- Leave ordinary 400/409 create-only races and existing post-create visibility
  checks unchanged.

### 2. Generic owner-gated bot-only manifest repair

In `scripts/ops/chips-ledger-stage-automation.mjs`:

- Replace the batch-`9923`-specific repair constants/helper with one exact
  `runBotOnlyExactRecoveryRepair({ batchId })` path derived from the committed
  row's SHA-256 and deterministic recovery paths. Preserve the existing legacy
  batch-15 corrected-manifest helper because it repairs a different historical
  state and is not the missing-manifest path.
- Reuse `assertBotOnlyExecuteBatch`, `assertAutomaticStageFence`,
  `inspectDurableRecoveryState`, `runPruneStep` in `dry-run` mode,
  `downloadPrivateArchiveObject`, and `readPrivateObjectIfExists`.
- Permit only `PARTIAL` with recovery archive present and recovery manifest
  absent, or `COMPLETE` for idempotent read-only resume. Reject both missing,
  archive-missing, manifest-only, mismatch, unavailable, not-visible, changed
  DB row, proof/lifecycle failure, and fence/lock failure before POST.
- Revalidate exact row/manifest, identity, fence, lock, proof, dry-run, and
  primary/recovery archive equality immediately before the write. Create only
  the manifest through `uploadOrVerifyPrivateObject` (`x-upsert:false`), then
  invalidate/reinspect and verify both recovery objects and canonical manifest.
- Keep the automatic path unchanged in policy: it can benefit from shared
  ambiguous-write reconciliation, but it still cannot repair a pre-existing
  partial state or bypass owner approval.

### 3. Existing summary and workflow gates

- Extend the existing aggregate payload only when recovery evidence exists, so
  errors identify `batch_id`, recovery state, per-object presence/details, and
  a required read-only/owner-gated action without changing unrelated summary
  keys.
- Change the bot-only repair input description and shell validation from the
  incident literal `9923` to a positive exact batch ID plus the matching
  `REPAIR <batch_id>` confirmation. Retain canonical repository, owner, `main`,
  empty execute/automatic gates, read-only fence preflight, schedule, and
  workflow concurrency.
- Update `docs/chips-ledger-stage-automation.md` with audit evidence,
  limitations, generic operator contract, and explicit separate Stage GO.

## Source layout

```text
scripts/ops/
├── chips-ledger-archive-store.mjs       # ambiguous POST reconciliation
└── chips-ledger-stage-automation.mjs    # recovery inspection/repair/summary
.github/workflows/
└── chips-ledger-stage-scheduled-automation.yml  # owner/main input gates
tests/chips/
├── chips-ledger-archive-storage.test.mjs
├── chips-ledger-stage-automation.test.mjs
├── chips-ledger-stage-automation.observability.behavior.test.mjs
└── chips-ledger-stage-automation.workflow.guard.test.mjs
docs/
└── chips-ledger-stage-automation.md
```

## Safety invariants before the only repair POST

The implementation is complete only if every condition below is checked after
the dry-run and immediately before the missing-manifest write:

1. workflow is canonical repository `main`, owner-gated, and exact batch input
   matches its confirmation; script has no execute/automatic gate;
2. Stage DB URL, project ref, PostgreSQL system identifier, active TABLE fence,
   and session-scoped advisory lock are verified;
3. exact committed bot-only row and active normalized manifest match, including
   policy, object path, SHA, schema-v2 proof, and lifecycle with no prune,
   registry cleanup, destructive GO, or completed-retention marker;
4. dry-run is `ready` and immutable proof/evidence matches;
5. primary archive and existing recovery archive are private gzip objects with
   equal verified bytes, sizes, and committed SHA-256;
6. recovery inspection is exactly `partial` with manifest absent; a complete
   pair is read-only idempotent and any other state fails closed;
7. the only write has `x-upsert:false`, targets the derived missing manifest,
   and is followed by a fresh complete-pair inspection.

## Complexity Tracking

No constitution violations. The generic repair removes the one-off `9923`
allowlist rather than adding a new abstraction or dependency; the legacy batch
15 correction remains isolated because its known-current/known-corrected
manifest contract is materially different.
