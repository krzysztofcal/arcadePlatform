# Verification: Stage escrow demand-refill identity

## Root cause and scope

[Run 38124260046](https://github.com/krzysztofcal/arcadePlatform/actions/runs/38124260046) failed prepare for batch 19314 with P8964. Registry archive/table matches were zero; a demand-refill key carried the table UUID only in fundingDemandId. MINT `5a383559-0439-47f6-b052-4aac5be2d45a` has purpose poker_pool_refill and two entries on SYSTEM GENESIS/bankroll, neither on escrow `16fb628a-1abe-44fb-8471-9bd2217d7b4c`. Both text guards and their post-lock copies were overbroad; dedicated candidate mappings were correct.

One forward migration patches the effective function with exact expected guard counts. It proves canonical producer metadata/key/reference, matching live registry, recomputed payload hash, exactly two opposite SYSTEM entries and no target entry. P8964 exempts verified registry keys (not every row sharing a transaction ID); P8965 exempts verified live IDs. Both proofs are recomputed after locks. No accounting DML or cleanup runs during migration.

The exhaustive repository migration guard also requires one stage-only manifest inventory entry and updated exact counts (54 baseline, 55 missing, categories 18/4/33). No Production SQL, refill, scheduler, Actions, application, dependencies or configuration changed.

## Local evidence

Disposable PostgreSQL 17.11 on localhost:55439, database `escrow_refill_test`; prerequisites copied from `.github/workflows/tests.yml`. No shared database used by destructive fixtures.

- Regression without new migration: real `poker_bot_pool_refill_demand()` fixture fails with P8964.
- `CHIPS_MIGRATIONS_TEST_DB_URL=<isolated-url> node tests/chips/chips.migration.test.mjs`: PASS, full migration chain and Production-equivalent fixtures included.
- Added negative database cases: real registry table/archive mappings; TABLE types; wrong linked transaction/hash; unknown or extra metadata; incorrect accounting; escrow entry; noncanonical second registry row linked to valid MINT; P8965 without valid registry; missing bot-only proof; snapshot; invalid recovery. Existing unknown FK, canary hash, direct DELETE, immutable receipt, concurrency and permission checks retained.
- Positive prepare and local retirement/replay: MINT, registry, both entries and complete SYSTEM account snapshots remain byte-equivalent in JSON.
- `node --test tests/chips/chips-ledger-stage-escrow-retention.test.mjs tests/chips/chips-ledger-stage-escrow-retention.workflow.guard.test.mjs tests/chips/chips-ledger-archive-pruning.test.mjs`: 38 passed, 0 failed/skipped.
- `CHIPS_MIGRATIONS_TEST_DB_URL=<isolated-url> node tests/chips/chips-ledger-bot-only-retention.test.mjs`: PostgreSQL selector and four fundamental contracts PASS.
- `CHIPS_MIGRATIONS_TEST_DB_URL=<isolated-url> node tests/chips/chips-ledger-stage-cleanup-orchestration.test.mjs`: PostgreSQL orchestration contracts PASS.
- `node scripts/check-db-migrations.mjs`: PASS, 109 source migrations / 7 existing Production replacements.
- `node --check tests/chips/chips.migration.test.mjs` and `git diff --check`: PASS.
- Effective definition comparison against pre-apply Stage: after removing only the added proof/declarations/text exclusions, the complete function is identical. Owner `chips_ledger_archive_pruner`, ACL (owner/postgres only), SECURITY DEFINER and empty search_path unchanged.
- Independent code review found a duplicate-linked-registry-row hole; corrected using canonical verified keys and a negative test. Final review: no critical/important findings.

## Shared Stage evidence and risk

Before push, protected SQL prepare was called inside REPEATABLE READ, READ ONLY and reproduced P8964 for batch 19314. Recovery hashes were reconstructed locally using existing `buildAccountRecoverySnapshot()` / `serializeAccountRecovery()` from read-only projections; matching object already exists in the archive storage catalog:

- Recovery SHA: `ce8cad67ca4ac493e986914c864ce2793f44e2c53533282c7d831e6ec53c3c38`.
- Snapshot SHA: `bf78189189eeeb2db7954d0f0ab2e09f2d4aac5b789d611aa27e4a4b86240f88`.
- Account IDs SHA: `192022fdc8071878dd0501fca0c0fc142c9f2da6ea8fc5287bd3c9555b9e7c20`.

The new proof query already recognizes the exact Stage refill evidence read-only. [DB Stage Apply PR run 38134696775](https://github.com/krzysztofcal/arcadePlatform/actions/runs/38134696775) applied exactly migration `20261011090000` at 2026-10-11 11:12:27 UTC for implementation SHA `3f8fe1627096afe59184fc847dd7e3d3e61b4617`; job succeeded. Stage recorded migration SHA-256 `bb42935c646f4305c6772d9698b90135f6e441365ee18c5777cdc5107bc7656e`, matching the reviewed file.

Post-apply protected SQL prepare in REPEATABLE READ, READ ONLY returned `state=eligible`, `mode=prepare-only`, `read_only=true`, `account_count=1` and the exact account/recovery/snapshot hashes above. Wrong recovery remained P8946; READ COMMITTED READ ONLY remained P8947. anon/authenticated/service_role still have no EXECUTE. Effective deployed definition exactly equals the locally tested definition; owner/ACL/config are identical to the pre-apply Stage snapshot. Stage identity remains `7656985631720456337`.

MINT still exists with entries `397099`/`397100`, amounts -5000/+5000; its transaction, registry and entry snapshots were identical across post-apply read-only verification. Escrow entry/snapshot counts are zero. At post-apply verification (2026-10-11), the escrow account still existed and `account_retirement_at` was NULL; automation remained enabled. No account deletion was performed by this task.

CI on the implementation SHA: migration-guard, apply-stage, chips-retention-integration and ws-persistence-integration PASS. Draft PR: [#1081](https://github.com/krzysztofcal/arcadePlatform/pull/1081). Later documentation-only commits do not change the tested/applied migration or runtime artifacts.

Draft PR creation intentionally permits migration application to shared Stage. The retirement policy is already enabled: subsequent existing scheduled automation can delete now-eligible escrow accounts, including batch 19314. Draft status does not prevent apply. No manual cleanup execute, canary/GO change, scheduler change or Production operation is authorized or performed. Stage verification uses SQL prepare with p_execute=false and READ ONLY exclusively; it is not a new storage download/durable-recovery verification run.

## Potential breaking changes

No function signature, schema, ACL, client/protocol or Production behavior changes. Intentional Stage behavior change: verified unrelated demand-refill funding context no longer blocks retirement, so active automation may delete accounts formerly held by this false positive. Unknown/malformed/extra-field refill formats remain blocked; future producer format changes need explicit review. Canary authorization keeps its existing stricter dependency checks unchanged.
