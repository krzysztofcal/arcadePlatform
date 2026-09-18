# Quickstart: Stage CPU tick validity

## Prerequisites

- Node.js 20+.
- Repository dependencies installed with `npm ci --ignore-scripts`.

## Focused validation

Run the fundamental regression and safety suite:

```sh
node --test tests/stage-supabase-resource-health.test.mjs
```

Expected result: all tests pass, including shorter and longer positive CPU
counter intervals, stale/reset/incomplete/changed data and enforcement of
unknown/critical states.

## Repository validation

Run the repository's existing test and syntax commands as applicable:

```sh
npm test
npm run syntax
```

Review the diff and confirm that
`.github/workflows/chips-ledger-stage-scheduled-automation.yml` is unchanged.
The workflow's existing canonical-main Stage guard remains responsible for the
operational validation; this feature does not run Production or alter cleanup.
