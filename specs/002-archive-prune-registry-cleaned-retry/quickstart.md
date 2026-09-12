# Validation

Use a disposable local PostgreSQL database with the minimal auth/storage bootstrap from `.github/workflows/tests.yml`. Never point the destructive migration harness at Stage or Production.

Run `CHIPS_MIGRATIONS_TEST_DB_URL=<disposable-local-test-db> node tests/chips/chips.migration.test.mjs`, plus existing `chips-ledger-archive-pruning`, `chips-ledger-bot-only-retention`, and `chips-ledger-stage-automation*.test.mjs` tests under `tests/chips/`.

Expect authorized retirement followed by both retry modes to return `already_pruned`; missing, partial, mismatching evidence and residual mappings must reject. Existing first-prune, balances, closed-human and ACL assertions must pass.

Operational verification is separate: confirm the new migration through `DB Stage Apply PR`, then run exactly existing-30d using the existing authorized Stage automation gate. Record run URL, migration, application SHA and path result. Green PR tests, a retirement-only retry or another retention mode do not prove recovery of #803. No direct Stage SQL mutation or Production operation.

## Implementation validation — 2026-09-12

- Regression reproduced before fix on disposable PostgreSQL 17: actual #980 retirement succeeded, subsequent generic prune raised the exact P0001 from #803.
- Full `chips.migration.test.mjs` passed after migration `20260912083727_chips_archive_prune_registry_cleaned_retry.sql`, including both valid retry modes, ten invalid-evidence cases, four residual/mismatching mapping cases and existing closed-human/ACL/accounting contracts.
- Existing archive-pruning, Stage automation (including order, observability and workflow guards) and prunable-candidate tests: six test files passed, zero failures.
- Database-backed bot-only retention, Stage cleanup orchestration and TABLE metadata fence tests passed on the same disposable database.
- Migration filename validation: 97 files passed; Node syntax and diff whitespace checks passed.
- Full effective PL/pgSQL body compared against the current closed-human-aware definition: identical except for the intended registry predicate. Reviewed and retained the small catalog patch instead of copying the whole function.
- Stage application: [DB Stage Apply PR 34683940522](https://github.com/krzysztofcal/arcadePlatform/actions/runs/34683940522) applied `20260912083727` at application SHA `144e065937db6abb3ca18f8ebdd401f66f654918`; identity preflight and smoke checks passed.
- Operational verification: [run #830 / 34683965930](https://github.com/krzysztofcal/arcadePlatform/actions/runs/34683965930), dispatched with `mode=existing-30d` on main `7a23aa0820654d18a8bb06ece8688f31495fec2e`, passed both resource health and the exact existing 30-day automation step. Result: `state=pruned`, `mode=new`, 5000 transactions, 10000 entries, proof `verified`, receipt `pruned`, 5000 mappings, credits/debits 663260 and net 0. This confirms path recovery after application; the summary does not log individual historical-batch retry outcomes.
- All PR checks for implementation SHA `144e0659` passed (inapplicable checks skipped), including PostgreSQL retention integration. [Draft PR #982](https://github.com/krzysztofcal/arcadePlatform/pull/982) remains unmerged. Production untouched.
