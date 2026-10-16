> **Current status — 2026-10-14:** T017 batch2, T018 bot batch3, T018 human batch4 (including lifecycle), and T019 escrow batch3 are PASS. PR B T020–T022 implementation was approved and is now locally verified for Draft PR review; T023+ operations are not authorized. Earlier dated OPEN/BLOCKED/failure paragraphs are historical snapshots superseded by the final matrix below.

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

Implementation was performed on `agent/891-production-retention-plan` from main `f7983d78333b51a393c0e9a6d3dfe48ce1224c74`. The original accepted 54/43 inventory and 18/3/22 classification remain the historical Production-retention baseline; the current source tree adds #1018 as the 44th missing manifest entry and the manual RESTRICTED extension as the 45th, both classified `needs-production-equivalent` and still awaiting separate Production GO. E1 and E2 remain the only files under `supabase/production-migrations/`; the two new source migrations are Stage feature migrations, not Production replacements.

The missing Production WS column `poker_tables.bot_only_retention_complete_at` is supplied by E1's forward-only schema contract. The TABLE binding implementation was validated against the existing Netlify and WS `postTransaction` adapters on a disposable first54+E1 PostgreSQL fixture with E2's fence active, including valid buy-in/cash-out metadata and rejected substituted/legacy-invalid metadata. A trigger bug found during this test (the transaction trigger function evaluated `old.transaction_id` for `chips_transactions`) was corrected by using a table-safe target transaction ID branch; the regression test then passed.

T014 implementation checks passed: `npm test` (after the existing CI step `npm ci --prefix ws-server --omit=dev`), `npm run syntax`, `npm run ci:guards`, `npm run check:all`, `npm run check:csp-inline`, `node scripts/check-db-migrations.mjs`, `git diff --check`, the disposable migration fixture, the active-fence TABLE metadata fixture, archive/export/storage/prune suites, Stage automation/escrow suites and the existing workflow guard. The repository-wide runner retained only its normal opt-in skips for suites without their dedicated database environment. No Production or Stage connection, migration application, canary, Storage write, workflow dispatch, scheduler installation or cleanup was performed. The final PR HEAD is recorded in the handoff after commit.


## Subsequent owner-gated runtime evidence — T017/T018 (2026-09-14)

The following aggregate evidence supersedes the earlier pre-E1/E2 baseline where noted. No user-level data or credentials are recorded.

### T017 existing-30d

- **PASS** on main `75646c7ea78088756880033d2c2fbd5ee911ffc1`.
- Production batch **2** pruned exactly **2 transactions / 4 entries**.
- The **2 registry rows were retained and mapped to `archive_batch_id = 2`**, which is the live existing-30d contract. Registry deletion and `registry_cleaned_*` are not required for this policy.
- Exact replay returned **`already_pruned`** with the committed proof and accounting evidence.
- Accounting invariants passed: credits `200`, debits `200`, net `0`; account balances and entry sequences were unchanged.
- Production automation and all retention policies remained **OFF**; the Production cap remained **2**.

### T018 read-only diagnostics

Both selectors were run through the Production diagnostic path with no prepare, authorize, execute, cleanup, export, proof, or Storage write. No naturally qualifying fresh canary exists.

- **`bot-only-7d`: NO ELIGIBLE CANARY YET.** The selector returned zero candidates at the seven-day cutoff. Production currently has five closed tables, but none is both non-human and `bot_only_proof_eligible = true`; the aggregate blocking evidence includes `unknown_table_identity = 133` and `deferred_entry_binding = 86`. No table/transaction set therefore has fenced bot eligibility, complete registry proof, valid age, and a count within the cap of 2.
- **`closed-human-30d`: NO ELIGIBLE CANARY YET.** The selector returned zero candidates at the thirty-day cutoff. Five closed human tables have lifecycle evidence (`HAND_DONE`, empty `handId`, zero unresolved requests) and active zero-balance escrow, but zero have registry identities; consequently none has a complete table history, an aged transaction set, or a bounded canary set.

The rollout waits for naturally aged, correctly fenced data. Do not backfill, backdate, split tables, add financial fixtures, or increase the cap. T019/T020/T021 remain unimplemented and unauthorized.

## Subsequent owner-gated T018 candidate-creation evidence (2026-09-14)

The following two fresh Production runtime smokes created bounded, post-E2 candidate tables. These are candidate-creation results only; neither T018 retention prepare nor canary execute was run. Both candidates must age naturally and pass a fresh eligibility diagnostic before any prepare authorization. No backfill, backdate, split, fixture, or cap increase was used.

### Bot-only candidate

- **Smoke PASS; waiting for natural age >7d.**
- Table: `396a48fd-4b61-4992-8635-0820f3b68c74`; status `CLOSED`.
- `TABLE_BUY_IN`: `856278b7-ddb3-4c46-af8f-a7fefda7f1c8`.
- `TABLE_CASH_OUT`: `9e010041-66e0-4d95-9b4a-db95ca1389b2`.
- Exactly **2 TABLE transactions / 4 entries**.
- `has_human_participant = false`; `bot_only_proof_eligible = true`.
- Escrow balance: `0 CH`.
- Registry identity count: `2`.

### Closed-human candidate

- **Smoke PASS; waiting for natural age >30d from the newest TABLE transaction.**
- Table: `7f3d73e4-36c5-4b66-afe6-d1d41bea13e2`.
- Created: `2026-09-14T13:32:20.982Z`.
- `TABLE_BUY_IN`: `8948e05e-ca00-4fc4-97ec-baff3ce710a1`, `2026-09-14T13:32:21.799Z`.
- `TABLE_CASH_OUT`: `f9529116-fc6f-419c-a563-90487d6845ef`, `2026-09-14T13:32:28.499Z`.
- Terminal close: `2026-09-14T13:33:38.361Z`.
- User: `f70a39da-08b2-4884-b99d-a6bb2b0cd234`; final balance `1100 CH`.
- Escrow: `04c0ecc8-6325-4258-bedf-25c4c51ceccb`; balance `0 CH`.
- Status/lifecycle: `CLOSED`, `HAND_DONE`, empty `handId`, zero unresolved requests.
- Exactly **2 TABLE transactions / 4 entries**.
- Exactly **2** registry identities, formats `join-buyin` and `poker:leave`, both bound to the exact table.
- No bots, rebuy, refund, settlement, or replacement.

### Failed no-op first human attempt

The first human-table attempt is retained for audit and is not a canary candidate:

- Table: `c820f012-294c-4701-9368-409f8bcaee71`; status `CLOSED`.
- TABLE transactions: `0`.
- Registry identities: `0`.
- Escrow balance: `0 CH`.

T018 remains open. The actual retention canaries still require natural age, a fresh fenced eligibility diagnostic, prepare, and separately authorized destructive execute for each policy. No T018 task checkbox is marked PASS.

## Historical owner-gated evidence — T017/T018/T019 (2026-09-22)

This section supersedes the pre-canary status above. It records aggregate evidence only; private recovery bytes, credentials and secrets are intentionally excluded. No Production policy or global control was activated.

### T017 existing-30d — PASS

- The previously recorded Production batch **2** remains the completed T017 canary: exactly **2 transactions / 4 entries**, complete proof/prune receipt, retained registry mappings and verified replay (`already_pruned`).
- A fresh read-only run of the unchanged `PRUNABLE_CANDIDATE_SQL` with the 30-day cutoff and manual cap **2** returned **2 rows from 1 table** (`3cf6fd0f-181a-4e5a-9e63-78ba98e436a8`). This is current selection evidence only; it did not create a batch or authorize another canary.

### T018 bot-only-7d — PASS

- Bot-only CANARY batch **3** completed successfully in [Production run #35742627182](https://github.com/krzysztofcal/arcadePlatform/actions/runs/35742627182), from checkout SHA `1c8dfabfe393cb81f0091f215d430ddebfccef8b`.
- This historical bot-only CANARY is distinct from the later T019 escrow PREPARE/CANARY path on `cf9cb02d7bed661f8a825635fe043edb5f514942`; the PASS result and gate status are unchanged.
- The cleaned table was `396a48fd-4b61-4992-8635-0820f3b68c74`; the exact archive and ledger receipts remain complete. The current bot-only selector returns **0 new candidates** after that table was removed, which is not a regression and does not reopen the completed canary.

### T018 closed-human-30d — OPEN / NOT PASS

- A fresh exact `CLOSED_HUMAN_TABLE_CANDIDATE_SQL` audit with the unchanged 30-day cutoff and cap **2** returned **0 candidates**.
- Six closed human tables were observed. Only `7f3d73e4-36c5-4b66-afe6-d1d41bea13e2` currently has the non-age lifecycle and identity prerequisites visible to the audit: `CLOSED`, `HAND_DONE`, empty `handId`, zero pending requests, active zero-balance escrow, **2 identities / 2 hot identities**.
- Its newest TABLE transaction is `2026-09-14T13:32:28.499939Z`; the earliest possible age threshold is therefore `2026-10-14T13:32:28.499939Z`. This is an age lower bound, **not a guarantee of later selector eligibility**; all entry-shape, identity, lifecycle, escrow and cap checks must be repeated then.
- The other five closed human tables currently have no durable TABLE identities and cannot be treated as candidates. No prepare, archive, authorization or execute was performed for closed-human.

### T019 escrow account retirement — PASS

- Run: [Production CANARY #35775709976](https://github.com/krzysztofcal/arcadePlatform/actions/runs/35775709976).
- Checkout SHA: `cf9cb02d7bed661f8a825635fe043edb5f514942`.
- Batch: `3`; result `state=retired`; `accountCount=1`; one execute attempt; zero retries; `storageWrites=0`.
- Retired account: `c29325f1-0715-453e-b090-fde88fa2ada7`.
- `account_ids_sha256`: `c342d5eb1395883fa642c17839a5a251438e59355ee9cba4c7f1fc6dffc0112f`.
- Recovery path: `account-recovery/v1/sha256/ae887c5e1b3d9441089d53604a7fb49a9fdb33ec9f3a264051db0acff3b6dc87.json.gz`.
- Recovery object SHA-256: `ae887c5e1b3d9441089d53604a7fb49a9fdb33ec9f3a264051db0acff3b6dc87`.
- Account snapshot SHA-256: `a35ad9c46440bed7c882a901c26ca18e832ce1ef1b9fff0b0da7ec8447e201ae`.
- Durable receipt: `account_retirement_at=2026-09-22T19:44:42.167617Z`, account count `1`, exact account hash/path/object hash/snapshot hash above. Batch #3 remains `committed`, with the original **2 transactions / 4 entries**, prune count `2 / 4`, registry cleanup count `2`, archive transaction-ID hash `30998c2ebc5c57f806f3221c0646762ce94b0e35edc91c60fccec1659d222265` and entry-ID hash `03d3abb1b360a614b48081beb0e9cf8fe51aadb79cacb8b6e4a9017d06951a9c`.
- Read-only post-check found zero rows for the retired account, zero rows for the source table, zero remaining table transactions/registry references, and the recovery object unchanged in the private archive bucket (object metadata size `1057`, HTTP `200`, no overwrite).
- Accounting controls remained intact: canonical system `7575202818581710058`, TABLE fence active, global Production control `enabled=false` with cap `2`, all three Production policies `enabled=false`, and zero active retention locks/queries. The escrow policy records `canary_batch_id=3` and `GO 3` as historical authorization evidence, but remains OFF.

### Issue #891 / T020 gate status

- **PASS:** T017 existing-30d, T018 bot-only-7d, T019 escrow account retirement.
- **OPEN:** T018 closed-human-30d; it requires naturally aged data and a fresh diagnostic, then separately authorized PREPARE and CANARY.
- **BLOCKED:** T020 activation/PR B readiness. The contract requires all four class canaries to PASS; the current closed-human no-candidate result is not PASS. Global control, policies and scheduler must remain OFF.
- The nearest safe step is to wait until the stated human age lower bound, then run a fresh read-only closed-human qualification. Do not backdate, split, synthesize, increase the cap, or treat a no-op as a canary PASS.

## T018 closed-human PREPARE failure — 2026-10-14

Fresh diagnostic run [38616248892](https://github.com/krzysztofcal/arcadePlatform/actions/runs/38616248892) passed on main `e9fc88506baca68786efd291025b1dcfc2e1ff25`. Owner separately authorized PREPARE only for canonical Production `otbqfijerkieoxwpxjnm/7575202818581710058`, table `7f3d73e4-36c5-4b66-afe6-d1d41bea13e2`, cap 2 transactions / 4 entries.

[PREPARE run 38616939004](https://github.com/krzysztofcal/arcadePlatform/actions/runs/38616939004) failed after committing fresh **batch 4**, before proof registration: `cannot prune USER ledger history (user_transactions=2, user_entries=2, distinct_tables=1)`. `buildPruneEvidence()` recognized only the Stage closed-human policy. Production's outer prune policy dispatch already recognized both policies, but evidence validation failed first.

Read-only reconciliation confirmed primary archive private/MIME/bytes/SHA and identical repeated downloads:

- Primary path: `v1/sha256/28a2a4332723d3e60a7dfd04ab48f73132091782109780cb21c1696be39f947e.jsonl.gz`, 809 bytes.
- Compressed SHA-256: `28a2a4332723d3e60a7dfd04ab48f73132091782109780cb21c1696be39f947e`.
- Raw SHA-256: `20f8b84b3eeffec797d994fedbe4dc12fce48fe75b47e97568177b5b7872f90a`, 3359 bytes.
- Transactions: `8948e05e-ca00-4fc4-97ec-baff3ce710a1`, `f9529116-fc6f-419c-a563-90487d6845ef`; entries 4747–4750. Credits/debits 2000/2000, net 0.
- Batch is committed, **unproven**, with no recovery copies, destructive GO, prune or registry-cleanup receipt. All selected hot rows, registry, involved balances/sequences and lifecycle markers remained unchanged. Global/policy retention OFF, cap 2, workflow switch 0; no Production retention scheduler units installed.
- Operator restored WS cleanup override to 0 and restarted Production WS; config/process PASS for PID 3637526. Agent independently verified matching active PID and release `a00ededc18a98b30ff452bf166d4ef415577773e`; ledger/cleanup file hashes matched main. Cleanup must remain disabled under #992.

No retry or CANARY was performed. Preserve batch 4 and its primary bytes. Normal fresh PREPARE is blocked by this active batch; existing CANARY resume requires proof and recovery, so it cannot repair this incomplete preparation. The repair adds only exact-batch PREPARE recovery, under the existing lock, without export/new batch/GO/execute. See `prepare-recovery-plan.md`.

T018 closed-human remains **NOT PASS**, T020–T022 remain blocked. After owner review and merge, a separate explicit Production authorization is required to resume PREPARE for batch 4 and the exact archive SHA above. A subsequent exact-batch CANARY GO remains a separate gate. Implementing or merging the repair authorizes neither operation.

### Repair implementation verification

The existing archive-pruning, archive-export, archive-storage, Stage/Production automation, workflow-guard and escrow suites pass without remote credentials. New regressions first failed on the original policy/recovery branches, then passed with the fix. They cover both human policies, USER binding/direction/conservation, forbidden USER policies, exact batch resume, absent/ambiguous/wrong batch, cap, SHA, partial proof/receipts, destructive GO, recovery ambiguity and session loss. Real shared recovery helpers are exercised against private in-memory objects: two-copy creation, idempotent verification with no second upload/proof, and mismatched manifest rejection. Existing CANARY and Stage cases remain green.

`npm run syntax`, `npm run ci:guards`, migration inventory validation and `git diff --check` pass. `npm run check:all` fails on five unrelated missing XP badge anchors in existing design HTML; the identical output was reproduced against an unchanged main snapshot. No UI/design files were modified. Full repository test status is recorded in the PR handoff. No Production or Stage access, workflow dispatch, migration, Storage write, policy/scheduler/cleanup change, merge or deploy was performed while implementing this repair.

Full `npm test` subsequently **PASS** after installing the existing CI-prescribed WS dependencies (`npm ci --prefix ws-server --omit=dev`); no lockfile/dependency changes. The first attempt stopped at an unrelated maintenance test because `ws` was missing in the isolated checkout. Existing opt-in database tests retain their normal environment skips; no live Production/Stage tests were run. A separate reviewer inspected the recovery code and found no confirmed safety defect; the proposed real-helper recovery regression was added and passed.

## T018 batch 4 CANARY: pruning PASS, lifecycle incomplete — 2026-10-14

Owner-authorized [CANARY run 38625427304](https://github.com/krzysztofcal/arcadePlatform/actions/runs/38625427304) succeeded on main `67dc5076855311ed039df31a77ba7af2d105d575`. It pruned exactly 2 transactions / 4 entries from existing batch 4 at `2026-10-14T19:39:19.683188Z`; selected hot transaction/entry counts are zero. Proof/receipt ID hashes and both recovery copies match the previously recorded PREPARE. Account balances/sequences and conservation remain unchanged. The workflow created no Storage object or new batch.

Closed-human **intentionally retains** its 2 registry identities mapped to `archive_batch_id=4`. Null `registry_cleaned_*` is expected for this policy; registry deletion is not missing work. Read-only reconciliation nevertheless found `human_retention_complete_at=NULL` on exact table `7f3d73e4-36c5-4b66-afe6-d1d41bea13e2`, so the overall T018 result remains **NOT PASS**. No replay CANARY, marker write or rollback was performed after this finding. Preserve correct pruning, retained registry and all recovery artifacts. Do not restore USER history to hot ledger.

Root cause: Production `runProductionArchiveCycle()` reported successful pruning without invoking/verifying the existing `chips_complete_closed_human_table_retention(uuid,timestamptz)`. Stage already has a separate lifecycle-completion transaction and automatic finalization pattern. Operator confirms the existing Production lifecycle gate passes for batch cutoff `2026-09-14T18:39:21.779Z`; the existing protected routine and privileges are sufficient, so no migration is needed.

The corrective patch provides explicit owner/main `mode=lifecycle-completion` with exact batch/table/cutoff and separate `COMPLETE HUMAN RETENTION <batch>` confirmation. Under the existing lock it verifies full prune/proof/archive/retained-binding/recovery evidence and dry-run `already_pruned`, then locks/revalidates exact batch and table in a serializable transaction, invokes only the existing marker function if absent, and verifies the immutable marker. It never exports, creates another batch, prunes, authorizes GO, uploads recovery or edits registry/accounts/receipts.

Future closed-human CANARY and automatic pruning explicitly finalize and verify lifecycle before success. A completed CANARY retry never executes pruning again; if its marker is missing it requires the separate completion mode. Enabled automatic may resume marker-only finalization of its latest completed pruning and returns before selecting another batch. Diagnostic/PREPARE cannot invoke completion. Exact cutoff parameters use the existing text-typed timestamp pattern to preserve microseconds.

All Production operations remain blocked pending owner review/merge and a new **marker-only GO for batch 4**. Implementation is not authorization. Global/policy retention and scheduler remain OFF, cap2/fenceON and #992 cleanup stays disabled. T020–T022/PR B and Production activation must not begin without another user approval.

### Lifecycle corrective implementation verification

Existing Stage/Production automation, workflow guard, archive export/storage/pruning and escrow fundamental suites PASS. Regressions cover complete pruning with missing marker, immutable existing marker without a second completion write, wrong owner/mode/confirmation/batch/table/cutoff/proof/archive/recovery/registry, manifest drift under row lock, manual control-state drift, failed marker persistence, precise microsecond cutoff parameters, future CANARY pruning once then marker verification, completed CANARY verification-only retry and automatic marker-only resume without another export/prune. The separate reviewer confirmed existing DB functions are sufficient; its timestamp-precision finding was fixed with text-typed parameters and a regression.

Full `npm test`, syntax, CI guards, migration inventory validation and whitespace PASS; existing opt-in DB tests retain their normal environment skips. `check:all` retains the same five existing design HTML XP badge-anchor failures already reproduced on unchanged main. No migration, dependency, config or unrelated design change. No Production/Stage access, workflow dispatch, completion write, CANARY, merge, deploy or activation occurred during this implementation. Marker-only authorization remains pending.

PR #1107 review corrections: complete closed-human prune receipts now require both a non-null destructive GO timestamp and the exact GO batch ID, including completed automatic batches. A busy advisory lock in explicit lifecycle-completion raises an error rather than successful no-op; other modes retain intentional lock-busy no-op behavior. The completed-batch harness records valid GO, and fundamental regressions reject missing GO and busy completion while preserving prepare no-op. No Production operation is authorized or executed by these changes.

## Current PR B evidence matrix — all canaries PASS (2026-10-14)

Reviewed GitHub main `2b212b795c1e0648d61ee8d06b1bb3d0b2ff164f`, including merged #1106/#1107. The live #891 PASS comment at 2026-10-14T20:43:08Z supersedes its stale age BLOCKED body. The approved T022 handoff corrects that stale status and provides a Draft PR; #891 remains open for T023–T025.

Final human [lifecycle completion run 38633895421](https://github.com/krzysztofcal/arcadePlatform/actions/runs/38633895421) reports completed, dry-run already_pruned, one DB marker write and zero Storage writes. Independent reconciliation verified marker `2026-10-14T20:39:44.985066Z`, unchanged complete batch/proof/prune/GO, 0 hot rows, 2 retained mappings, unchanged balances/sequences/conservation and both recovery copies. No repeated pruning/export/new batch. Last observed controls: OFF/all policiesOFF/cap2/fenceON, workflow switch0, no Production scheduler units; operator freshly attested cleanup0 in config/process PID3637526. #992 remains a separate re-enable gate.

For planning, a scoped read-only audit additionally re-read only batches2/3/4 and downloaded their existing private primary/recovery artifacts through the existing verifier. Canonical database identity and all hashes below matched; no DB/Storage write or workflow dispatch occurred. This is evidence collection, not E3 authorization. Storage must be reverified with a fresh operator attestation before E3 apply.

Each ledger canary has 2 transactions /4 entries, credits=debits/net0, complete proof and matching prune ID hashes. Batch2 and4 retain exactly2 registry mappings; batch3 has a complete2-key cleanup and completed bot escrow retirement. Historical old manual batch1 and Stage IDs15/334 are not activation evidence.

### Batch 2 — production-ledger-auto-retention-30d-v1

- Raw archive SHA: `7d117aef6bbc21dbce030cc0859092bed132a82c764178f585b37cc6cf0d63f0`.
- Compressed archive / recovery archive SHA: `5e4ce1100e82555135bd761951beaaa83095a13d966306c003b7f474bf55f367`.
- Transaction proof / prune SHA: `ea3085b290ae32be4eb34419afb04ea55caddcbca0801fc7b1ca47972e3fd010`.
- Entry proof / prune SHA: `f224a1028f71b277fe725c6c6a2097b4c44872780100a7c46666bb8dab130aa6`.
- Proof verified at: `2026-09-13 21:54:01.998395+00`.
- Exact cutoff: `2026-08-14 21:54:00.245+00`.
- Pruned at: `2026-09-14 08:32:49.627231+00`.
- Destructive GO at: `2026-09-14 08:32:49.309998+00`.
- Destructive GO batch: `2`.
- Transaction IDs: `26899ac1-d3c2-4382-8954-06d98823278a`, `5815f81f-870a-4c3c-9879-ddeef0db4b1e`.
- Entry IDs: `4469`, `4470`, `4471`, `4472`.
- Recovery manifest SHA: `abb6b98096dd3aa04c98e450d8aea5eb9b6c5a19c2c993a134e2ca71f7caeaea`.
- Primary: `v1/sha256/5e4ce1100e82555135bd761951beaaa83095a13d966306c003b7f474bf55f367.jsonl.gz`.
- Durable archive: `recovery/v1/sha256/5e4ce1100e82555135bd761951beaaa83095a13d966306c003b7f474bf55f367.jsonl.gz`.
- Durable manifest: `recovery/v1/sha256/5e4ce1100e82555135bd761951beaaa83095a13d966306c003b7f474bf55f367.recovery.json.gz`.

### Batch 3 — production-ledger-bot-only-retention-7d-v1

- Raw archive SHA: `361ef011cfffae4fef297c1336af2127bcdfed8c633126d3149a866dcc1205d8`.
- Compressed archive / recovery archive SHA: `bec1c7db4fd65a3af000ee943c71cc100208af4a7f7cd1ab15706f9826d06ce1`.
- Transaction proof / prune SHA: `30998c2ebc5c57f806f3221c0646762ce94b0e35edc91c60fccec1659d222265`.
- Entry proof / prune SHA: `03d3abb1b360a614b48081beb0e9cf8fe51aadb79cacb8b6e4a9017d06951a9c`.
- Proof verified at: `2026-09-22 11:59:35.095601+00`.
- Exact cutoff: `2026-09-15 11:59:30.415+00`.
- Pruned at: `2026-09-22 14:46:43.156875+00`.
- Destructive GO at: `2026-09-22 13:00:06.487919+00`.
- Destructive GO batch: `3`.
- Transaction IDs: `856278b7-ddb3-4c46-af8f-a7fefda7f1c8`, `9e010041-66e0-4d95-9b4a-db95ca1389b2`.
- Entry IDs: `4741`, `4742`, `4743`, `4744`.
- Recovery manifest SHA: `cd1248863ff318addbfe581d037f70778afdd79176650af05519394f5231c189`.
- Primary: `v1/sha256/bec1c7db4fd65a3af000ee943c71cc100208af4a7f7cd1ab15706f9826d06ce1.jsonl.gz`.
- Durable archive: `recovery/v1/sha256/bec1c7db4fd65a3af000ee943c71cc100208af4a7f7cd1ab15706f9826d06ce1.jsonl.gz`.
- Durable manifest: `recovery/v1/sha256/bec1c7db4fd65a3af000ee943c71cc100208af4a7f7cd1ab15706f9826d06ce1.recovery.json.gz`.
- Bot table: `396a48fd-4b61-4992-8635-0820f3b68c74`; proof/cleanup keys SHA `2e78bf8cf3e598f0dcd83a61c81582f8746070459122307124d38d4ff0d602f5`, cleaned at `2026-09-22 14:46:43.156875+00`, count2, out-of-scope SHA `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. Table/account now absent is the expected retired state; no live bot marker can be required as a substitute for immutable receipts.

### Batch 4 — production-ledger-closed-human-table-retention-30d-v1

- Raw archive SHA: `20f8b84b3eeffec797d994fedbe4dc12fce48fe75b47e97568177b5b7872f90a`.
- Compressed archive / recovery archive SHA: `28a2a4332723d3e60a7dfd04ab48f73132091782109780cb21c1696be39f947e`.
- Transaction proof / prune SHA: `0d655736aff808a8604c4acf07ad3d09422ba9becbc39c6af26b727a847a0345`.
- Entry proof / prune SHA: `05ae84b7b64161c146501c8c114e6637cd65c6eef7c1373905ed92e87e241eda`.
- Proof verified at: `2026-10-14 19:28:07.024825+00`.
- Exact cutoff: `2026-09-14 18:39:21.779+00`.
- Pruned at: `2026-10-14 19:39:19.683188+00`.
- Destructive GO at: `2026-10-14 19:39:17.466354+00`.
- Destructive GO batch: `4`.
- Transaction IDs: `8948e05e-ca00-4fc4-97ec-baff3ce710a1`, `f9529116-fc6f-419c-a563-90487d6845ef`.
- Entry IDs: `4747`, `4748`, `4749`, `4750`.
- Recovery manifest SHA: `72e2f005c82dda1171380b3748078747ab68ac9c2e47c123a61b274c837bdd8e`.
- Primary: `v1/sha256/28a2a4332723d3e60a7dfd04ab48f73132091782109780cb21c1696be39f947e.jsonl.gz`.
- Durable archive: `recovery/v1/sha256/28a2a4332723d3e60a7dfd04ab48f73132091782109780cb21c1696be39f947e.jsonl.gz`.
- Durable manifest: `recovery/v1/sha256/28a2a4332723d3e60a7dfd04ab48f73132091782109780cb21c1696be39f947e.recovery.json.gz`.
- Human table: `7f3d73e4-36c5-4b66-afe6-d1d41bea13e2`; completion marker `2026-10-14T20:39:44.985066Z`. Retained mappings2 and null registry-cleanup tuple are intentional.

### Escrow retirement bound to batch3

Account `c29325f1-0715-453e-b090-fde88fa2ada7`, count1, account-set SHA `c342d5eb1395883fa642c17839a5a251438e59355ee9cba4c7f1fc6dffc0112f`. Immutable snapshot SHA `a35ad9c46440bed7c882a901c26ca18e832ce1ef1b9fff0b0da7ec8447e201ae`; object SHA `ae887c5e1b3d9441089d53604a7fb49a9fdb33ec9f3a264051db0acff3b6dc87` at `account-recovery/v1/sha256/ae887c5e1b3d9441089d53604a7fb49a9fdb33ec9f3a264051db0acff3b6dc87.json.gz`. Retirement receipt `2026-09-22T19:44:42.167617Z` from recorded T019 evidence; snapshot/account absence/no references remain a mandatory fresh E3 preflight check.

### PR B approved design decisions

- Decision: keep cap2 on manual target/proof/prune/lifecycle APIs and add explicit locked automatic context5000 across existing pipeline. Reason: target-only caps and SQL proof currently block5000 while global enabled alone is too broad. Rejected: global constant5000, env cap override, weakening full-table/USER predicates.
- Decision: E3 adds one narrow existing-30d automatic GO adapter and updates protected callers/ACLs, using the existing economic core. Reason: current `--automatic` rejects that class and no SQL automatic GO exists. Rejected: CLI-only admission or a second pruning implementation.
- Decision: same-batch automatic resume only if committed/proven and durable-complete; unknown/pending/partial state stops. Reason: preserve exact receipts and one-batch limit. Rejected: new export fallback, automatic proof/recovery repair or manual cap bypass.
- Decision: E3 binds owner-reviewed Storage preflight digest/time (<=15min), while SQL verifies exact immutable database evidence under lock. Reason: SQL cannot retrieve private Storage bytes. Rejected: new Storage extension/evidence service or treating hash strings alone as downloaded proof.
- Decision: one default-off UTC timer, dedicated Actions-only token, local flock and filtered nonterminal-run total_count guards. Reason: bounded calls avoid scanning growing completed-run history and cannot hide active runs behind pagination. Rejected: duplicate native cron, backlog catch-up, DB credentials in scheduler and retrying uncertain dispatch.

Architecture decisions are resolved and implementation was authorized; activation remains separately owner-gated. Exact implementation/E3 hashes are recorded in the handoff, never accepted as rollout permission. Before authoring/apply, reconcile upstream inventory/live history and obtain fresh private escrow/recovery/runtime attestation. These are evidence steps, not a reason to re-run completed canaries.

### Escrow / #992 dependency retained

Code review confirms `PRODUCTION_ESCROW_CANDIDATE_SQL` requires an absent bot table, whereas bot pruning sets its lifecycle marker without deleting `poker_tables`. With WS cleanup=0, future escrow schedules may legitimately find no candidate for newly completed bot tables. Keep the selector and account safety contract unchanged; document the backlog in T025. The completed batch3 retirement is unaffected. #992 cleanup requires its own audit and owner GO, outside PR B.

## PR B implementation / review handoff — 2026-10-15

Base main: `2b212b795c1e0648d61ee8d06b1bb3d0b2ff164f`; branch `feat/891-production-retention-pr-b`. E3 file `20260914092000_chips_ledger_production_retention_activation.sql` SHA-256: `88e622855c79b467fe03f063dc4c19e39394745e4ef5fc14ab2a7afede719460`. Manifest now validates111 source migrations and8 replacements, preserving every previous hash. The Draft PR identifies the final implementation commit.

User review required and implementation enforces manual cap2 after E3 and activated-policy automatic cap5000 at JS and lowest SQL boundaries, never GUC/env alone. SQL preserves one core per financial method via explicit-context overloads/manual delegates. Missing existing-30d automatic GO and safe same-batch resume are included; human completion is verified before SUCCESS. Disable-only clearing of activation fields repairs the original OFF constraint; reapply cannot reactivate.

Storage evidence is a separate operator preflight: private bucket plus primary/full recovery/manifest and escrow snapshot bytes are downloaded and verified through existing helpers before apply. The owner attestation binds those results, exact receipts, code/runtime identities and observation time; E3 checks pinned DB state under lock and <=15min freshness again before activation. SQL does not perform Storage HTTP requests, prove Storage availability or eliminate TOCTOU. Any unavailable/changed Storage evidence invalidates the attestation and stops the operator before E3.

Validation: `npm test` PASS (147 suites; existing opt-in DB skips remain, while the dedicated disposable PostgreSQL migration suite was run explicitly and PASS). Export/store/prune, Stage/Production automation and workflow/scheduler guard PASS. Syntax, CI guards, CSP (55 served documents), authoritative transport, migration inventory and whitespace PASS. `check:all` FAIL is the existing five missing XP badge anchors: `poker/designs/luxury-lobby/{index,landscape,portrait}.html`, `specs/1086-poker-felt/design/index.html`, `specs/792-premium-table-themes/design/index.html`. These files and the guard are unchanged. Remote checks are reported on the Draft PR.

Independent whole-branch review identified no P1; its scheduler skip-log finding was corrected and the guard rerun. This is code/test evidence, not Production rollout PASS. No Production connection/write, workflow dispatch, migration application, token/switch activation, scheduler installation, merge/deploy or WS cleanup change occurred in implementation. All T023+ gates remain closed.

Final fail-closed follow-up: completed bot cycles must revalidate as `already_cleaned`; existing30d uses `already_pruned`. Both reverify durable recovery before selecting a new archive. Escrow automatic admission is freshly checked under the lock and again by the SQL automatic guard inside execution, retaining the unchanged2-account retirement contract. Fundamental negative tests PASS; reviewer found no blocker in either follow-up.

### PR #1108 catalog correction — 2026-10-15

The original E3 `$before$` pins were calculated from authored E1 SQL, not the deployed Production `pg_proc.prosrc`. E2 does not replace these routines. A repeatable-read, read-only connection to `otbqfijerkieoxwpxjnm` / `7575202818581710058` reproduced 14 mismatches out of 18. All 18 required signatures remain pinned individually using the original exact byte hashing algorithm (only the system identifier is replaced); no fallback or whitespace normalization is accepted.

All 14 deployed definitions were compared with E1 and the E3 replacements, including quoted strings, security definer/invoker, owner and empty search_path. Nine differ only in formatting/comments; four additionally omit optional alias `AS`. The bot lifecycle gate's first NULL-table candidate prefilter has three LIKE prefixes instead of eleven: the eight omitted `poker:` prefixes cannot pass the following mandatory join/seed regex. Separate poker leave/inactive-cleanup and v1 registry branches are unchanged. This is equivalent eligibility, not permission to broaden accepted history. E3 financial bodies remain unchanged.

| Required function (public prefix omitted) | Difference | Reviewed deployed SHA-256 |
|---|---|---|
| `chips_assert_archive_prune_target(text,bigint)` | Formatting/comments only | `ffac8f9ad0cd0286adfd36abcd6021e3a50c73ccb5b71b75f16cd5536396fab1` |
| `chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamp with time zone,uuid[],text[])` | Redundant LIKE prefilter; same mandatory regex/union branches | `e6c20f8264a6f5fd13588655b3eb78845629375c953aaa05eefd7bd1a6d8d004` |
| `chips_assert_closed_human_table_lifecycle_gate(uuid,timestamp with time zone,bigint)` | Formatting/comments only | `acdfb054abff03c1f820770ef29574e77360f4bfe5c2e3c4622bdaef41bd6a65` |
| `chips_assert_production_retention_control(text,bigint,boolean)` | Formatting/comments only | `51bd8a947ef47ff98f1c97530ea9c6773b35e47fb164594dfb285ff548caeb37` |
| `chips_auto_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid)` | Formatting and optional alias AS | `ad9becaa511c1bef8a059908f814e7ffbf79755bbf753dde5c92270816313b31` |
| `chips_auto_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid)` | Formatting and optional alias AS | `6397d9e49b7c80a79655056b080ff16c3c12e1d54a34444b922bc4799c606f21` |
| `chips_complete_closed_human_table_retention(uuid,timestamptz)` | Formatting/comments only | `398f459c1f5a684bcbf7b8b4d774b5e3d9acb04b84cd63fcbfd54485b8b719c0` |
| `chips_guard_archive_batch_mutations()` | Formatting/comments only | `09da4d727aaaf195100bcb1c97df80d76d726aa9a00cff36a3e51927cd4ff34e` |
| `chips_guard_human_retention_marker()` | Formatting/comments only | `40a77a77a211596de75dfdff2a3650d375c80c849416eac714506154aff6d712` |
| `chips_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid,boolean,bigint)` | Formatting/comments only | `1cf157cb8a30162b9cd5151725d624ee6ddde4c0a57eb8543d93ea2f3405cff2` |
| `chips_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid,boolean,bigint)` | Formatting and optional alias AS | `037921f26080ca4822fdfed2311c9fb55c1a0cee7b27dd38f82b5866977eb63c` |
| `chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric)` | Formatting/comments only | `2eee1a2d728db25470008e93772c07c807d99853ba7cf581752b5eec1890462f` |
| `chips_register_bot_only_archive_proof(text,uuid[],bigint[],uuid,text[],text)` | Formatting/comments only | `e183f1c0df737a4b256ee5a8f9969f419e1a33b332cd1b24f96049c0ad286300` |
| `chips_retire_production_escrow_accounts(bigint,uuid[],text,text,text,boolean,text)` | Formatting and optional alias AS | `251b96819aa427dccbf7eddb56995cf6f9696aa8c5b825849bc2f4168d497551` |

Five routines are not replaced by E3: archive target, closed-human lifecycle gate, lifecycle completion, human marker guard and escrow retirement. Their `$after$` pins must retain the reviewed deployed hashes too. All other replacement body pins remain unchanged. The test-only frozen deployed catalog restores these 14 definitions solely in the disposable PostgreSQL fixture; it is not a migration or operational repair. Full activation/replay tests now start from the deployed catalog, and a raw-source comment mutation must fail the catalog guard.

Final fresh Production fingerprint preflight: **18/18 PASS**, transaction read-only ON, E3 absent, retention OFF, cap 2. No Production DDL/DML, activation, workflow dispatch or configuration change was performed. Breaking/financial impact: no new runtime behavior beyond the already reviewed E3 proposal; this corrects the exact baseline and retained-function replay pins. Any subsequent catalog drift still blocks E3. Storage preflight, fresh evidence and all separate owner gates remain mandatory; fingerprint PASS alone does not authorize E3.

### T023 failed activation and DDL delegation correction — 2026-10-15

Owner-approved E3 `ae8b44f133d716a35964b79b2e81788ae60b7fdc59c6249b88b366c33d6261a5` was attempted exactly once on main `04904e878734391ec24a235b9207324bb9b394e5` at09:33:08.737UTC. It failed with `permission denied for schema public`; independent read-only reconciliation confirmed E3 absent, all controls/policiesOFF,cap2,fenceON, original18 catalog/ACL unchanged, identical ledger/accounting/registry/lifecycle/receipts and all10 Storage objects. No retry, privilege repair, workflow/scheduler action or T024 occurred. All previous attestations/GO are consumed or expired.

Read-only membership audit found `supabase_admin`→`postgres` for the pruner with ADMIN=true,INHERIT=false,SET=false. The destination owner lacks CREATE(public). PostgreSQL16 requires the caller to be able to SET ROLE to the new owner, and the new owner to have CREATE on the namespace: [ALTER FUNCTION](https://www.postgresql.org/docs/16/sql-alterfunction.html), [GRANT](https://www.postgresql.org/docs/16/sql-grant.html). Superuser-only fixture execution had hidden this requirement.

The correction adds only transaction-scoped CREATE(public) for the pruner and an explicit postgres-granted membership edge ADMIN=false,INHERIT=true,SET=true. INHERIT permits replacing existing pruner-owned routines; SET permits ownership transfer. Before activation/COMMIT it revokes CREATE and only the edge GRANTED BY postgres. The managed provider edge and all its options are untouched. Unknown initial CREATE or an existing postgres-granted edge fails closed instead of overwriting permissions. The owner must have CREATE WITH GRANT OPTION and the pruner must already have USAGE.

Fundamental regression in the existing migration suite executes the **entire unchanged E3 financial body** as a real NOSUPERUSER session/current_user postgres on a disposable loopback PG16+ fixture, with separate bootstrap grantor and managed SET=false membership. PostgreSQL forbids demoting the bootstrap superuser, so fixture setup temporarily renames it and creates the real non-superuser postgres identity; scoped fixture object ownership and role names are restored in finally. No migration identity or function body is rewritten to evade the check. Missing CREATE and missing SET/ownership delegation are rejected; late attestation failure rolls back both grants; success restores exact grantor/ADMIN/INHERIT/SET and USAGE=true,CREATE=false. All29 after-body fingerprints pass under the non-superuser session. Existing cap/accounting/replay/disable and Stage cases remain in the same full suite.

DDL review covers namespace delegation, role ADMIN/SET/INHERIT, replacement ownership, all new overloads/owner transfers/ACL statements and activation/history permissions through full successful non-superuser execution. Financial function bodies, SECURITY settings, owners,18 before/29 after guards, RLS and activation conditions are unchanged. Local test setup uses superuser only for provisioning/cleanup, never to execute the regression's E3.

Corrected E3 SHA-256: `88e622855c79b467fe03f063dc4c19e39394745e4ef5fc14ab2a7afede719460`. This is a new artifact requiring owner review/merge, fresh full T023 preflight including DDL grantor/options/schema checks, and separate exact-file/hash/attestation GO. No Production grants or apply were performed for this corrective PR. T023 remains incomplete; T024/T025 remain closed.

### T023 live activity and delta-guard proposal — 2026-10-15, planning only

Read-only diagnosis explained the stopped attempt's six new transactions at11:02:31–11:02:34 UTC as three terminal bot cash-outs and three new-table seed buy-ins. A second matching cycle occurred at11:12:42–11:12:43. All12 transactions/24entries conserved value, matched registry/funding/table provenance, and all5 affected accounts reconciled balance/complete entry sequences. Protected canary2/3/4 receipts, registry, lifecycle, retirement and all10 actual Storage GET/bytes/SHA/MIME remained identical. These are historical diagnostic findings, not new readiness evidence or authorization. The old `74304d…` attestation/GO cannot be reused.

Decision proposed in [plan.md](plan.md#t023-live-ledger-drift-correction--proposal-for-review-2026-10-15): one local delta validator, complete historical row identity proofs, narrow seed/terminal-bot allowlist with dynamic cardinality, same validation in preflight/final admission/postcommit reconciliation. No arbitrary net0 admission. E3 fingerprint/financial bodies/DDL/ACL and all protected gates remain unchanged.

P1 review correction: global equality was both `readiness.mjs::capture()`/`unchanged` and an extra Python pre-run comparison; it is not a standalone durable runner helper. The previously proposed exact-BEGIN/suffix framing and SHARE locks are withdrawn. Reading E3 shows its top-level effect is guarded activation/history, not execution of its newly defined prune routines. `chips_activate_production_retention()` does not consume global financial hashes/counts for any transfer/deletion. A normal writer committing after S2 therefore invalidates global equality but not a financial premise of activation. E3's advisory lock and exact protected row locks/receipts checks remain unchanged. No demonstrated financial invariant justifies blocking all poker writers.

Rejected-lock impact: SHARE blocks INSERT/UPDATE/DELETE; NOWAIT only affects our acquisition. E3's120s statement timeout is per statement, not a transaction/lock-hold cap, so the previous proposal could delay buy-in/cash-out/settlement materially. Revised decision: no added locks, pause, extra grant, SQL split or E3 change. Existing E3 DDL/row contention is still possible; zero latency is not promised.

P2 decision: immutable S0/S1 row-set artifacts in the attestation; fresh S2 before submission; independent read-only MVCC snapshots S3/S4 afterwards. Validate adjacent and cumulative deltas, preserving all old identities/content and accounting exactly for new complete writer transactions, entries, registry and account/sequence changes. An old created_at or preallocated small ID does not exclude a late commit. No global-count, net0-only, high-watermark or permanent-quiescence rule. All strict protected checks remain; unsupported drift before submit stops apply, unsupported drift discovered after submit prevents a success claim and requires read-only diagnosis, never retry. Reconciliation observes the gap rather than claiming to prevent it. Concurrent privileged maintenance is excluded; snapshots cannot prove absence of privileged transient write-and-revert between observations.

Reuse pure/read-only binding/funding helpers; application `postTransaction` validators are private and financial writer methods must never run as diagnostics. No new package, generic policy engine, backend export, SQL migration or Stage change. Unknown operations/provenance remain NO-GO before submission or FAIL/uncertain after submission. See plan for exact local files, method contracts, requested fundamental regression cases and owner gates. Proposal has not been implemented or run against Production.

P2 review clarification (#1110): `shared/poker-domain/terminal-close.mjs::postTerminalBotCashout()` writes `metadata.reason=BOT_TERMINAL_CASH_OUT` and a distinct `metadata.closeReason`; the initial reviewed delta admission allows only `closeReason=WS_INACTIVE_TABLE_CLOSE`, not the default `TERMINAL_CLOSE` or other callers' reasons. Unknown/missing/swapped fields fail closed. The CONTINUOUS_BOT caller is actually `ws-server/poker/persistence/continuous-bot-table-repository.mjs::createManagedTable()` (there is no shared-domain repository file in this revision); it supplies `idempotencyPrefix=managed-bot-seed-buyin` and `fundingReason=BOT_SEED_BUY_IN` to `shared/poker-domain/bots.mjs::seedBotsForJoin()`, which writes the matching key, `BOT_SEED_BUY_IN:` reference and metadata reason. Validate those together. Mutable seat status/stack or table phase is not historical funding evidence: later phase progression, INACTIVE seats or legal closure can coexist with a valid seed. Preserve positive immutable funding/registry/identity lineage; missing lineage is not excused by a state transition. This only clarifies the existing narrow validator plan; E3/runner, S0–S4 and no-extra-lock decision are unchanged.

## T024 identity simplification — owner decision2026-10-15

The owner rejected an extra technical account/App after comparing the working Stage VPS→Actions model. Production will dispatch as existing owner `krzysztofcal` with a separate narrowly scoped Production fine-grained PAT, explicitly supplied via the root-protected environment and isolated gh configuration. No Stage/agent/private ambient token reuse. The discarded principal has no remaining runtime constant/configuration/branch; no financial evidence or migration is removed.

T023 is already post-commit-verified: exact E3 SHA `88e622855c79b467fe03f063dc4c19e39394745e4ef5fc14ab2a7afede719460`; original one-time submission16:00:54.453Z. The historical runner FAIL and absent original S4 remain truthful; separate read-only F0/F1 finalization29/29 metadata, Storage10/10 and financial/protected validation passed. Private evidence report SHA `93bb53d9d1384ee1205aa8d0d73825fba94a3799dd69ad0d06156aba91528153`. No E3 reapply is part of T024.

Installed Production timer/service remain inactive and timer disabled; source correction must be reviewed/merged and then the exact installed script replaced by root in OFF state. Stage timer remains active/enabled and is not changed. No scheduler activation, PAT provisioning, live dispatch or Production DB/Storage operation occurs during this implementation.


## #1119 — completed human history after legal WS cleanup (2026-10-16)

The closure recommendation in Draft PR #1118 is superseded. Natural Production runs [38866974684](https://github.com/krzysztofcal/arcadePlatform/actions/runs/38866974684) and [38900239807](https://github.com/krzysztofcal/arcadePlatform/actions/runs/38900239807) hit P9231 after #992 legitimately removed completed canary table 7f3d73e4-36c5-4b66-afe6-d1d41bea13e2. The SQL dry-run checks live lifecycle before returning already_pruned, so latestCompleted batch 4 blocks the next selector. Earlier financial/canary PASS evidence remains historical evidence, not proof that this interaction works. Keep #891, #992 and #1119 open pending separate reviewed Production authorization and natural post-fix observation.

Implementation contract and tests are in specs/1119-production-human-terminal-revalidation/. Production automatic completed-history verification checks exact archive/proof/GO/prune, both recovery copies, retained mappings and zero hot rows independently of the live table. A missing table additionally requires immutable committed-marker evidence; exact legacy canary 4 may use E3's marker-checked activation.

PR #1120 review found that post-commit Storage publication could lose proof on process failure and excluded manual CANARY. The revised design removes that unmerged upload mechanism: an additive, owner-gated Production-only migration creates an empty immutable DB receipt table. All manual/automatic marker finalization writes/verifies the receipt in the same locked transaction. WS already skips locked rows and cannot delete an uncommitted marker; receipt and marker commit together, and the receipt has no table FK that cleanup could cascade away. Existing functions, E3, Stage, financial archive/recovery and WS remain unchanged. Missing schema stops before export/GO/prune. A separate reviewed exact migration GO is required before changed workflow rollout; no Production application, backfill or financial write is performed by this implementation.
