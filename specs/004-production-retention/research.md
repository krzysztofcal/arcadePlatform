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

## Current owner-gated evidence — T017/T018/T019 (2026-09-22)

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
