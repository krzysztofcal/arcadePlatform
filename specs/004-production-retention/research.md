# Research and decisions — issue #891

## Evidence scope and provenance

Read `agents.md`, `skills.md`, Constitution **1.1.1**, live issues [891](https://github.com/krzysztofcal/arcadePlatform/issues/891), [874](https://github.com/krzysztofcal/arcadePlatform/issues/874), [886](https://github.com/krzysztofcal/arcadePlatform/issues/886), [889](https://github.com/krzysztofcal/arcadePlatform/issues/889), and fetched current main `f7983d78333b51a393c0e9a6d3dfe48ce1224c74`. Main contains 97 SQL migrations through `20260912083727`. Live migration versions/names match main exactly on Stage; Production has its first 54, ending `20260813090000`.

DB queries were explicitly read-only, bounded by statement timeout, through the connected Supabase management SQL tool. No migrations, locks, exports, proofs, cleanup, workflow dispatches or Storage writes were executed. Sizes below are relation+index sizes; counts are exact separate snapshots, not a growth trend. No user-level evidence is published.

### Live DB baseline, 2026-09-13 11:59 UTC

| Fact | Production | Stage |
|---|---:|---:|
| Project ref | otbqfijerkieoxwpxjnm | krydukthwdvccggbyjfw |
| `pg_control_system().system_identifier` | 7575202818581710058 | 7656985631720456337 |
| Migrations | 54 | 97 |
| Transactions / entries | 135 / 270 | 78,178 / 156,356 |
| Accounts / registry | 28 / 137 | 15,322 / 90,373 |
| Sum of hot entries | 0 | 0 |
| Unbalanced hot transaction groups | 0 | 0 |
| Hot transactions without registry | 0 | 0 |
| Transactions bytes / entries bytes | 1,335,296 / 1,343,488 | 219,414,528 / 74,014,720 |
| Registry bytes | 122,880 | 68,116,480 |
| Archive batches | 1 committed/pruned, 2 transactions | 3,899 committed (3,898 pruned), 1 pending |
| TABLE fence | absent | active |

Both projects ACTIVE_HEALTHY in eu-west-3, PostgreSQL 17. Production build `17.6.1.054`, Stage `17.6.1.141`. Both have private `chips-ledger-archive`, limit 6,291,456 bytes, MIME `application/gzip`.

Production age distribution: TABLE_BUY_IN 69 total / 54 older than 30d; TABLE_CASH_OUT 62 / 47; MINT 2 / 2; PROMO_BONUS 1 / 1; ADMIN_ADJUST 1 / 0. Running the actual `PRUNABLE_CANDIDATE_SQL` as a read-only COUNT with cutoff now−30d, null cursor and limit 5000 returned **68 existing-30d candidates**. This is selection evidence, not an authorized batch or proof. Bot-only/closed-human/escrow selectors require absent schema, so their current Production executable eligibility is **unavailable**, not zero. Installation must not backfill historical bot eligibility merely to make canaries available.

Live Stage policy state: bot-only enabled, canary **15**; escrow enabled, canary **15**, account-set SHA `9e105208bb92306caf2d8c3664ba82bb1d88cf328853542053fc6af78e961aba`; closed-human enabled, canary **334**, table `ec3f4897-c7bb-4d92-b63d-a38401e9a5c4`. Fence active since 2026-08-22. These are Stage evidence only. GitHub repository variable `CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED=1`; no Production automation variable was listed.

[Stage run 34755334835](https://github.com/krzysztofcal/arcadePlatform/actions/runs/34755334835) succeeded on the baseline main. Its logs show six bot batches processed with verified recovery, proof, prune/registry receipts and replay verification; one SQLSTATE 40001 retry was bounded. The presence of a pending Stage batch elsewhere means “all historical batches clean” is not a valid inference from green workflow status. Production must scope resume to its own policy and fail closed on an unresolved own cycle.

### Deployed runtime and scheduler, independently read

Production Netlify site `f7e19a84-28f7-41f7-978a-f3b4552a404d`, `https://play.kcswh.pl`, published deploy `6aa67ee6f301b80007f87bb5`, ready at `2026-09-13T10:46:17.427Z`, commit = baseline main. Read via `netlify api getSite`, printing only deployment identity fields.

Read-only SSH to the already trusted VPS IP `91.98.174.191` as `copilot`: `/opt/ws-server/current` resolves to release **`7b615a64d48d99372b63570a22ce1d26b9b9591d`**. `journalctl -u ws-server.service --no-pager -n 200` reports repeated `ws_closed_table_cleanup_failed`, SQLSTATE **42703**, `column t.bot_only_retention_complete_at does not exist` (11:36–11:56 UTC). This independently confirms a current Production runtime/schema mismatch, not just a potential rollout concern.

Deployed files match baseline main byte-for-byte:

- `ws-server/poker/persistence/chips-ledger.mjs`: SHA256 `66b276e9c621da2dde7b8d5a8eab5ce0ab1ad37ef0fedb078097ab9ae0895527`.
- `ws-server/poker/persistence/closed-table-cleanup.mjs`: SHA256 `329f0cfca7a9306c3b774566ee98a72b62dc6797c4419652fd4b966847ee18a1`.

`tests/chips/chips-ledger-table-metadata-fence.test.mjs` already exercises both WS and Netlify `postTransaction` adapters against live PostgreSQL, including legacy string metadata, binding errors and preserved error causes. `closed-table-cleanup.mjs` requires human/bot completion markers. This supports source compatibility; it is **not** authenticated Production fence-on evidence. PR A must run the existing fundamental integration boundary on the exact deployed writer sources and owner must verify the relevant runtime scenario before/after fence activation. No writer modification is presumed necessary.

VPS already owns `arcade-chips-ledger-dispatch.timer` (enabled), service runs as copilot with `/usr/local/bin/arcade-chips-ledger-dispatch.sh`. Timer dispatches Stage automatic at minutes 02/17/32/47, Stage resource health at 03/18/33/48 and daily Stage existing-30d at 02:04 UTC. Script checks active/queued/pending runs before automatic dispatch. It is not versioned in main. Stage also has native 15-minute GitHub cron. Do not edit this live Stage dispatcher as part of Production rollout; add one separately named, checked-in Production timer/dispatcher, initially uninstalled, installed only under explicit PR B operational authorization.

## Decisions

### D1 — Contract equivalence, not historical replay

See [migration-inventory.md](migration-inventory.md). Stage-specific migrations mix DDL with hardcoded policies, identity checks, historical canary/allowlist checks and textual patches of prior function definitions. A bulk replay or search/replace of `stage` is unsafe. Build one forward-only Production baseline equivalent containing **final** required definitions and final indexes. Omit transient index experiments and Stage legacy framework. Preserve effective safety branches from late #978/#981 patches where relevant; do not enable their one-off Stage retirement operation in Production.

Use `supabase/production-migrations/` for the three explicitly ordered files specified in plan.md. They are outside automatic `DB Stage Apply PR`. Apply with the existing operator PostgreSQL/psql route, not a new migration service. Extend existing filename/hash guard to validate this second directory and its inventory manifest; do not modify Stage runner. Record only genuinely executed new Production versions, atomically in their own migration transaction. All old missing versions remain intentional gaps. **No migration-history repair is needed or allowed in this plan.** Generic CLI db push/reset is not the Production rollout route. Future catch-up must reconcile the manifest against all main versions and fail on unclassified additions.

Schema equivalence means the same required shared constraints/function semantics/owners/ACL/RLS/indexes under explicit target/policy substitution, not byte-equality with Stage historical rows. Require catalog evidence and disposable behavioral contracts before marking an inventory item “covered by equivalent”. A Stage-only item is “not applicable”, never “applied/satisfied by history repair”.

### D2 — Two PRs; fresh evidence per policy

PR A installs compatible schema dark/off and provides canary tooling. Separate fence activation follows runtime evidence. PR B is authored only after fresh canaries PASS and encodes those actual Production IDs/hashes, activates policies, allows 5000 only for policy-bound automation and provisions scheduling. No Stage ID 15/334 or old Production batch 1 is an activation substitute. One canary does not prove all classes: existing-30d, bot-only and closed-human each require a <=2-transaction archive; escrow may reuse the freshly cleaned bot canary with its separately authorized <=2-account snapshot.

A bot table must contain its full eligible identity set within 2 transactions. Closed-human also requires full lifecycle proof, including compatible historical archive mappings. Never split the table to satisfy canary. Pre-installation bot tables remain false/uncertain. If suitable canaries do not exist, keep rollout dark and wait for naturally aged, correctly fenced data; do not backdate data, relax retention or borrow Stage evidence. Consequently PR A implementation can be ready while PR B operational prerequisites take 7/30 days.

### D3 — Minimal shared extraction is necessary

`chips-ledger-stage-automation.mjs` is over 6,000 lines and combines reusable recovery/cycle machinery with hardcoded Stage canaries, repairs and six-batch orchestration. `chips-ledger-stage-escrow-retention.mjs` imports Stage identity/lock, validates Stage in snapshots, and allows bot-only/legacy batches. Copying these files would create a second framework; simply passing `--target prod` would expose Stage-only modes.

Move only reusable profile-driven cycle/recovery and escrow internals into two `_shared` modules (exact boundaries in plan.md). Keep Stage entry points, defaults, public exports and historical repair modes as wrappers. A small Production entry point accepts only four policy modes plus prepare/canary/diagnostic, with no legacy/missing-table repair commands. Generalize the existing exporter/store/pruner policy resolution, not their archive representation or eligibility predicates. Immutable profiles are explicit arguments, never global env substitution or fabricated Stage credentials. Stage predicates must still reject Production at their public boundary.

### D4 — Identity/credentials/locks and bounds

Production uses only `SUPABASE_PROD_DB_URL`, `SUPABASE_PROD_URL`, `SUPABASE_PROD_SERVICE_ROLE_KEY`, canonical expected ref, `DEPLOYED_COMMIT_SHA`, and `CHIPS_LEDGER_PRODUCTION_AUTOMATION_ENABLED`. Workflow job attaches protected `production-ledger` environment. Manual mutation requires owner/main/exact confirmation; scheduler identity is a dedicated dispatcher principal authorized for this workflow, not a blanket repository-owner bypass. Production PostgreSQL lock key: `chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm`; GitHub concurrency: `chips-ledger-production-automation`, cancel-in-progress false. Use a session connection on 5432 with max=1; transaction pooler 6543 is rejected. Hold lock over the entire cycle, including Storage and verification; DB functions assert the same lock in their own session before mutation. A lost session aborts; fresh invocation re-verifies receipts.

One workflow invocation selects exactly one class and processes at most one batch. Dedicated UTC slots avoid Stage dispatch bursts: existing-30d daily 02:09, bot-only hourly :09 except 02:09, closed-human hourly :24, escrow hourly :39. No catch-up missed-slot loop. Escrow retains Stage's conservative bot-only scope (Production has no legacy allowlists), cap 2 accounts per run; closed-human ESCROW deletion is not silently added.

### D5 — Storage, retry and recovery

Reuse `chips-ledger-archive` in the **Production project**, same deterministic `v1/sha256/...jsonl.gz`, `recovery/v1/sha256/...jsonl.gz`, `recovery/v1/sha256/...recovery.json.gz`, `account-recovery/v1/sha256/...json.gz`. Project/API credentials provide isolation; manifests also bind Production identity/policy. Preserve established path version even for schema-v2 bot records. No new bucket/framework and no overwrite-on-mismatch. Verify private status, MIME/size, bytes, hashes, full second archive and recovery manifest before execute; private local scratch mode 0700/files 0600, never upload full recovery data to public job artifacts.

Use existing pending→committed→proven→pruned→registry/lifecycle complete→account retired receipts. Ambiguous pending or partial/mismatched recovery blocks; exact committed/proven resume uses original bytes and identities. Retry only known rollback SQLSTATE 40001/55P03 up to three attempts, revalidating lock/identity/policy/proof/recovery. Unknown commit outcome stops and is diagnosed by durable receipt; no new-batch fallback. Stage batch-15 overwrite repair and Stage legacy repair are not Production APIs. Restoring pruned data to live ledger requires a separately designed and explicitly authorized recovery operation; ordinary rollback is disable automation, preserve evidence, correct forward.

## Review/simplification

Rejected: bulk db push; copying Stage canary IDs; fake history repair; another archive framework; sharing entire Stage CLI; generic policy engine; new migration runner; native+VPS duplicate Production cron; six-batch draining; broad UI tests; runtime changes merely to work around absent schema. Kept: one inventory manifest, one equivalent baseline, one separately gated fence migration, one activation migration, two small shared extraction boundaries, thin Production entry point and one workflow/timer. No new dependencies, ignore files, CSS, browser script or CSP change is needed. See plan.md Constitution Check and tasks.md for verification gates.

## Additional live facts and evidence limits

Production batch1 is format1, exactly2 transactions, proof verified 2026-08-13T10:34:49.659675Z and pruned 10:53:01.840285Z. Registry has135 unmapped hot identities plus2 mapped to batch1. Production has no `supabase_migrations.schema_migration_files`; no history repair/checksum table bootstrap is needed. Stage preview environment, read without printing secrets, targets `krydukthwdvccggbyjfw` for both API host and session-pooler username suffix. Production WS EnvironmentFile is `/etc/arcadeplatform/ws-server.env`; unprivileged read was denied, so its secret-bearing configuration was not inspected. A Production Netlify env-list query did not return parseable JSON; no claim is made about its current secret values. Published deploy identity, actual WS file digests/logs and exact live DB identity/schema were independently verified as recorded above. Revalidate deployed writer target configuration through an approved read-only operator route before E2; the plan never treats deployment revision alone as proof of correct runtime secrets.

Own review completed: added explicit owner-only existing30d canary GO routine (otherwise generic prune could lack the exact-batch approval boundary); fixed receipt-column names to match Stage; separated pre-fence new-table eligibility from Stage's historical default timing; made Production history gaps and lack of hash-table bootstrap explicit. These are now decisions/tasks, not questions for the implementation agent.

## PR A implementation evidence

Implementation was performed on `agent/891-production-retention-plan` from main `f7983d78333b51a393c0e9a6d3dfe48ce1224c74`. The accepted 54/43 inventory and 18/3/22 classification were preserved. E1 and E2 are the only files under `supabase/production-migrations/`; their current SHA-256 values are `0248679622a99736e92a24058a057b2a51d1af72ff8c4284f1616b9002709e2d` and `f6d8334cf642df7c9c4ac3b633d4898254d5af09290814cdce54e253bc650cab` respectively.

The missing Production WS column `poker_tables.bot_only_retention_complete_at` is supplied by E1's forward-only schema contract. The TABLE binding implementation was validated against the existing Netlify and WS `postTransaction` adapters on a disposable first54+E1 PostgreSQL fixture with E2's fence active, including valid buy-in/cash-out metadata and rejected substituted/legacy-invalid metadata. A trigger bug found during this test (the transaction trigger function evaluated `old.transaction_id` for `chips_transactions`) was corrected by using a table-safe target transaction ID branch; the regression test then passed.

T014 implementation checks passed: `npm test` (after the existing CI step `npm ci --prefix ws-server --omit=dev`), `npm run syntax`, `npm run ci:guards`, `npm run check:all`, `npm run check:csp-inline`, `node scripts/check-db-migrations.mjs`, `git diff --check`, the disposable migration fixture, the active-fence TABLE metadata fixture, archive/export/storage/prune suites, Stage automation/escrow suites and the existing workflow guard. The repository-wide runner retained only its normal opt-in skips for suites without their dedicated database environment. No Production or Stage connection, migration application, canary, Storage write, workflow dispatch, scheduler installation or cleanup was performed. The final PR HEAD is recorded in the handoff after commit.
