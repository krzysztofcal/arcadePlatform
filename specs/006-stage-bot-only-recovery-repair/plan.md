# Implementation Plan: Stage Bot-Only Recovery Repair for Batch 9923

**Branch**: `fix/stage-bot-only-recovery-9923` | **Date**: 2026-09-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-stage-bot-only-recovery-repair/spec.md`

## Summary

Add an incident-specific, owner-gated Stage repair path for exactly bot-only batch `9923`. The path will verify the primary archive and surviving recovery archive byte-for-byte and by SHA-256, create only the missing recovery manifest with create-only semantics, reconcile an ambiguous HTTP 504 by rereading Storage, and remain recovery-only with no prune, cleanup, GO, or database lifecycle mutation. The existing batch `15` implementation remains a separate unchanged behavior path.

## Technical Context

**Language/Version**: Node.js 20 in GitHub Actions

**Primary Dependencies**: Existing `postgres` client, Node `crypto`/`zlib`, and repository Storage helpers; no new dependency

**Storage**: Existing private Supabase Storage bucket `chips-ledger-archive`; existing Stage PostgreSQL manifest/proof rows; no schema change

**Testing**: Existing deterministic Node test file `tests/chips/chips-ledger-stage-automation.test.mjs`; targeted test, full chips automation test, syntax checks, and repository test command

**Target Platform**: Stage-only GitHub Actions workflow and its Node operations script

**Performance Goals**: One bounded repair for one exact batch; no change to scheduled batch limits or retry budgets

**Constraints**: Exact batch `9923` allowlist; Stage identity and owner/main gates; advisory lock; fail-closed validation; recovery archive immutability; `x-upsert:false`; private GET and byte/SHA verification; no destructive operation; no Production path

**Scale/Scope**: One known incident, one missing manifest, one manual dispatch mode, and three/four fundamental regression behaviors

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Simplicity and Existing Mechanisms — PASS**: Extend the existing Stage script, Storage helpers, workflow concurrency, advisory lock, dry-run, canonical manifest, and recovery inspection. No generic retention redesign or new dependency.
- **III. Fail-Closed Safety and Environment Separation — PASS**: The repair is an exact Stage allowlist path, owner/main gated, lock-protected, create-only, read-after-write verified, and never invokes prune/cleanup/GO. Production is out of scope.
- **V. Fundamental Tests and Concrete Plans — PASS**: Tests remain deterministic and limited to successful missing-manifest repair, byte/SHA mismatch, ambiguous 504 reconciliation, and incomplete-state blocking. This plan names concrete files/functions and contains no migration.
- **Deployment and Stage Apply — PASS**: No file under `supabase/migrations/**` is changed; no database mutation is part of the PR or verification.
- **Review and merge policy — PASS**: Prepare a draft PR and review it; do not merge it. Stage repair and subsequent normal automation require a separate user GO.

## Project Structure

### Documentation (this feature)

```text
specs/006-stage-bot-only-recovery-repair/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── bot-only-recovery-repair.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code

```text
scripts/ops/
├── chips-ledger-stage-automation.mjs
└── chips-ledger-archive-store.mjs

.github/workflows/
└── chips-ledger-stage-scheduled-automation.yml

docs/
└── chips-ledger-stage-automation.md

tests/chips/
└── chips-ledger-stage-automation.test.mjs
```

**Structure Decision**: Keep the existing single operations script and workflow. Add no new runtime module, migration, configuration file, dependency, or generic abstraction. The new behavior is isolated behind `runBotOnlyBatch9923RecoveryRepair(...)` and an exact CLI/workflow dispatch branch; the existing `runBotOnlyRecoveryRepair(...)` batch `15` path remains intact.

## Design

### Repair flow

1. Validate the exact `9923` argument, Stage environment, deployed commit, absence of bot-only execute/automatic gates, owner/main workflow gate, and the existing Stage Storage target.
2. Acquire and continuously revalidate the existing retention advisory lock, Stage system identity, exact DB row, active manifest, bot-only proof, policy, object path/SHA, unpruned/un-cleaned lifecycle, and absence of destructive GO.
3. Inspect both recovery paths. Accept a complete matching pair as read-only idempotent success. For a repair, require exactly `PARTIAL` with the recovery archive present and the recovery manifest absent; reject every other state.
4. Download the primary archive and surviving recovery archive privately. Require the approved MIME, size, exact bytes, and committed compressed SHA-256; retain the surviving archive bytes for post-write comparison.
5. Run the existing dry-run proof path and build the canonical bot-only recovery manifest from the revalidated row and evidence.
6. Create only the missing manifest using the existing create-only Storage helper. If its POST returns HTTP 504, perform a private GET and accept the operation only when the actual object matches the expected bytes/MIME/size/SHA-256; if it is absent or differs, fail closed without a second write.
7. Recheck the advisory lock, inspect both recovery objects, verify canonical manifest content and both object hashes, confirm the recovery archive bytes are unchanged, and return a recovery-only report. No prune, cleanup, GO, or DB write is reachable from this function.

### Code touch-points

- `scripts/ops/chips-ledger-stage-automation.mjs`: add the immutable batch `9923` target constant, exact repair function, partial-state/archive assertions, ambiguous-upload reconciliation wrapper, and CLI dispatch while preserving `runBotOnlyRecoveryRepair(...)` behavior for batch `15`.
- `scripts/ops/chips-ledger-archive-store.mjs`: only if required by the testable reconciliation boundary, expose no new broad behavior; prefer keeping the 504 read-after-response logic scoped to the `9923` repair call so batch `15` behavior is unchanged.
- `.github/workflows/chips-ledger-stage-scheduled-automation.yml`: add an owner/main-only manual mode, exact `9923` input and confirmation, Stage fence coverage, and no schedule/automatic-path changes.
- `tests/chips/chips-ledger-stage-automation.test.mjs`: extend the existing repair fixtures with fundamental tests for the exact partial state, byte/SHA mismatch, 504 reconciliation, and no writes/destructive calls for unsupported partial state.
- `docs/chips-ledger-stage-automation.md`: document the incident-specific mode, exact preconditions, 504 reconciliation, verification, and post-repair normal-automation handoff.

## Validation Strategy

- Run the new repair tests first and observe RED before adding production code.
- Run the full existing `tests/chips/chips-ledger-stage-automation.test.mjs` suite after each green increment.
- Run syntax checks for modified JavaScript/YAML-adjacent workflow content and the repository test command before review.
- Inspect the final diff for batch `15`, Production, schedule, eligibility, migration, and destructive-operation changes.
- Do not dispatch GitHub Actions, write Storage, run SQL mutation, delete objects, or run cleanup during repository verification.

## Complexity Tracking

No constitution violations or complexity exceptions are required.
