# Quickstart: Validate Batch 9923 Recovery Repair

This guide validates the repository change only. It does not dispatch GitHub Actions, access Stage Storage, run SQL mutations, delete objects, or execute cleanup.

## Prerequisites

- Node.js 20
- Repository dependencies installed with the existing lockfile
- Worktree based on the target commit under review

## Run the focused regression suite

```bash
node tests/chips/chips-ledger-stage-automation.test.mjs
```

Expected result:

```text
chips-ledger-stage-automation tests passed
```

The fundamental fixtures must demonstrate:

1. exact batch `9923` with a verified existing recovery archive and missing manifest creates only the manifest;
2. a changed archive byte or SHA-256 fails before the manifest write;
3. a 504 followed by a matching object is reconciled by GET, while a 504 with no matching object fails without a second POST;
4. an unsupported partial recovery state performs no Storage write, prune, cleanup, GO, or database mutation.

## Run repository validation

```bash
npm test
npm run syntax
```

If the repository test command contains unrelated environment-dependent failures, report the exact command and failure separately from the focused regression result.

## Post-PR Stage handoff (requires a separate owner GO)

After the draft PR is reviewed and intentionally deployed to `main`, the owner must first run the new owner-gated workflow mode with `9923` and `REPAIR 9923`. Confirm both recovery objects by private GET, MIME, size, bytes, SHA-256, and canonical manifest checks. Only then observe the next normal bot-only automation cycle; do not pass execute flags to the repair mode and do not manually invoke cleanup.
