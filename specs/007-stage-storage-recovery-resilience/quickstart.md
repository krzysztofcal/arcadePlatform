# Quickstart: Validate Stage recovery durability

This guide validates the repository change only. It does not dispatch GitHub
Actions, access Stage Storage, execute SQL mutations, delete objects, invoke
manual cleanup, enable automatic repair, or touch Production.

## Prerequisites

- Node.js 20 or newer
- Existing lockfile dependencies installed
- Worktree contains the feature branch under review

## Focused validation

Run the fundamental archive-store and Stage automation tests:

```bash
node tests/chips/chips-ledger-archive-storage.test.mjs
node tests/chips/chips-ledger-stage-automation.test.mjs
node tests/chips/chips-ledger-stage-automation.observability.behavior.test.mjs
node tests/chips/chips-ledger-stage-automation.workflow.guard.test.mjs
```

The fixtures must cover:

1. a 504 and transient network error after actual object creation, with one POST
   and verified GET reconciliation;
2. a generic positive batch ID with a verified primary/recovery archive pair and
   missing manifest, producing only the manifest;
3. missing, mismatched, unavailable, and not-visible objects failing closed;
4. no prune execute, GO, cleanup, DB write, archive overwrite, or delete before
   complete recovery verification;
5. a complete pair on an eligible unpruned/uncleaned row returning
   `recovery_already_repaired` with no write, plus a complete pair on a
   pruned/cleaned row being rejected before Storage inspection or dry-run;
6. Job Summary fields naming the blocked batch, recovery state, missing object,
   and required action;
7. workflow gates retaining owner/main, exact confirmation, Stage-only, and
   empty automatic/execute gates.

## Repository validation

```bash
npm test
npm run syntax
```

Also inspect the final patch for:

- no `supabase/migrations/**` changes;
- no package or lockfile changes;
- unchanged schedule, bounded batch limits, and automatic policy gates;
- no Production credentials, workflow, or code path;
- no Git commands in Spec Kit artifacts.

If the broad suite contains an unrelated pre-existing environment failure,
record the exact failing test and keep the focused suite result separate.

## Post-merge Stage handoff (no repair dispatch for 9923)

After review and merge to `main`, observe the next normal scheduled automation
run. Do not dispatch `bot-only-7d-recovery-repair` for the audited batch
`9923`: it is already pruned/cleaned and the repair must reject it before
returning `recovery_already_repaired`. Confirm that the normal run preserves
`9923` as complete/already cleaned and continues with eligible later bot-only
batches.

The generic owner-gated mode is reserved for a future real partial-recovery
incident. It requires read-only diagnosis and a separate owner GO; it must not
be tested live as part of this repository handoff. Never run manual execute or
touch Production.
