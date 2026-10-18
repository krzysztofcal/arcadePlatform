# Research and decisions — #1117 V2

## Authority and scope

2026-10-17 issue V2 supersedes V1 OTP-bound reauthentication architecture and blocked PR #1123 PoC. Owner now authorizes implementation/preparation and fundamental tests, not destructive Stage or Production/deployment/merge. Do not resume OVH or OTP experiments. Normal verified owner and explicit irreversible confirmation are required; supported optional fresh password/Google login must match server-verified UUID. Refresh/checkbox/redirect alone is not claimed as fresh authentication. Real standard-login Stage smoke remains an activation check under separate fixture authorization.

## Reused components and findings

- supabase-admin.mjs::verifySupabaseJwt verifies JWT, but local signature alone does not prove ACTIVE or Auth existence. Add lifecycle checks at actual protected effects. Official backend Admin deleteUser hard delete is sufficient provider contract; reconcile not-found after ambiguous result, never mark completed after error/dispatch.
- shared/poker-domain/leave.mjs and WS authoritative-leave-adapter/finalizeDeferredLeavesAfterSettlement are the only table-exit path. Existing leave behavior must be audited for all-in/side-pot participation; do not auto-fold all-in. Enumerate unresolved hand participation in addition to current seats. WS runtime is authoritative.
- chips-ledger.mjs::postTransaction and gift-purchase BURN show canonical balanced posting/idempotency. Final amount/receipt must survive lost response; closed retired USER cannot receive new ordinary posting. chips_accounts Auth FK and both ownership CHECKs require coordinated retirement and retention proof updates; no CASCADE/history deletion or SYSTEM conversion.
- store-upstash, xp-leaderboard-maintenance, start-session, calculate-xp and xp-identity have direct SETEX/ZADD/ZREM writers outside Lua. Require identity-aware final mutation fences, including admin/sync targets and Redis restart epoch; cleanup alone cannot prevent resurrection. No PG+Redis atomic transaction.
- Profile/avatar: pending row finalize TTL five minutes does not limit roughly two-hour signed-upload capability. Preserve paths until expiry/grace/final removal. Confirm temporary-only bucket and disable/drain all old issuers before legacy horizon; reconcile lost rows/orphans, do not blindly sweep mixed content.
- Welcome/Daily/once existing payout transactions must add private versioned verified-email HMAC proof atomically with ledger+bonus_claims. Counts based on paid outcomes; preserve global quota after cascade. History without verified identity proof cannot be magically reconstructed. Legal basis/LIA/rights, retention and HMAC rotation remain release decisions. No lifetime recognition promise, rolling annual reset or raw email store.

## V2 design decisions

One durable private request per old UUID; persisted step/lease/receipt/retry and incident state, no own challenge/OTP/proof tables. Existing WS tick scans requests even without tables. Financial and Storage obligations precede Auth deletion. Freeze errors fail closed; bounded scheduled waits are distinguished from stalled incidents. Feature cannot accept requests until all lifecycle/financial/bonus/Storage integrations pass. Preparing implementation is not release readiness.

## Infrastructure and remaining evidence

Current main baseline 9a43f4cf. Main baseline DB Stage Apply PR ran for drafts; this Draft already adds the draft guard and keeps proposals outside canonical migrations and must not dispatch/apply migrations under current authorization. V2 read-only Stage and Production pg_constraint refresh confirmed the same eight public Auth FKs and both USER ownership checks; catalog-evidence.json records the scoped result. Original detailed inventory remains historical. Preserve exact target separation. Read-only catalog refresh may inspect constraints/policies only, never unrelated user data/secrets. No shared Stage/Production mutations are intended.

## Primary documentation

- https://supabase.com/docs/reference/javascript/auth-admin-deleteuser — official hard-delete backend API.
- https://supabase.com/docs/guides/auth/managing-user-data — Storage ownership and surviving issued JWT caveats.
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword — standard password login.
- https://supabase.com/docs/reference/javascript/auth-signinwithoauth — standard Google OAuth; do not invent stronger freshness guarantees.

## Targeted review requirements

Review all-in settlement, late credits/final seal, both USER checks/retention proofs, SQL lock order and leases, all Redis writers, same-email new UUID, claim atomicity/quota, upload-capability horizon, secret/log minimization and false completion. Existing tests do not establish live configuration; unfinished work stays unchecked in tasks.md. No implementation milestone is labeled full feature completion until integrated evidence exists.

## Integrated preparation evidence and critical review

Implemented code is now connected through account-delete, existing account UI, WS tick and concrete financial/Storage/Redis adapters, but disabled by runtime and default-false database gates. No Stage/Production data mutation or deployment occurred. Fundamental CI-equivalent suite: 146 local tests passed; focused V3/full-flow tests reran after final review. Official Admin deletion is tested with exact-target HTTP fixtures; this is not a live provider test. PGlite verifies transactional rollback/constraints, not multi-connection PostgreSQL lock timing.

Review corrections: separate WS TABLE_BUY_IN ledger now fences actual USER entries; retired historical lookup cannot reopen wallets; UUID guests have explicit anonymous checks (no existing Auth/deletion/retirement); Redis V3 cleanup consumes only its owner index, never other owners' key lists; private WS enqueue is checked under lifecycle lock; campaign cleanup acquires sorted campaign locks before lifecycle to avoid inversion with claims. Frozen BURN payload is stored as an original JSON string so JSONB key reordering cannot change an idempotency hash. Financial mismatch remains an operator incident even from a stale worker.

Redis V3 local implementation resolves owner discovery with an atomic owner index; legacy mode deliberately refuses completion. The owner's XP-only reset decision removes the need to reverse-engineer old migration hashes. Live old-writer drain, exact reset/backup and private cutover attestation remain required before completion on real targets. Retention and final-writer work are preserved; schema/runtime/real-provider verification remain gated. Do not claim R1–R8 fully PASS or merge readiness from local fixtures.

Reward protection requires a DB-approved key check/version and history_ready; no default approval or empty-history reset. Legal basis, legitimate-interest assessment, rights/retention and rotation continuity remain separate launch review. Storage requires verified old-issuer cutover plus maximum capability lifetime/grace, exact bucket inventory attestation and reconciliation of uncertain signing; manifests persist beyond five-minute finalization TTL. No cutover marker is seeded.

CI portability review: XP policy imports remain dependency-light via lazy Redis adapter import, and the existing WS artifact fixture now mirrors Docker's /app/ws-server plus /app/shared layout. No checks were disabled. Finalizer SQL lock/statement waits are locally bounded to five seconds; incidents emit a redacted operator klog event containing request reference only.

## T04d completed locally — 2026-10-18

`supabase/manual/1117-account-deletion-retention-v2.sql` patches only the closed-human branch of the effective `chips_prune_committed_archive_batch_internal`, preserving #981 registry-cleaned retry, policy/cutoff/receipt/conservation checks and bot/SYSTEM/ESCROW exclusions. Composite predicate accepts active original USER or closed-zero retired USER with exact historical UUID, no system key and a retirement timestamp. Unexpected function definitions fail closed. No applied migration, old payload hash, archive object or immutable receipt changes.

`chips-ledger-archive-export.mjs` resolves historical USER identity for new exports and recognizes the same retired shape. Optional retirement fields are read through to_jsonb so deploying code before schema does not break the existing exporter. Existing stored exports/checksums are not rewritten. Local tests execute the production export shape CTE on retired and old-schema fixtures, reject wrong identity/nonzero retired wallet, and prove the entire effective #981 pruner definition is unchanged outside the narrow replacement. Separate schema apply/archive-prune smoke remains required.

## T02f completed locally — 2026-10-18

See writer-audit.md for supported HTTP/WS/SQL/admin/internal paths. Added final guards for favorites, gift buyer/recipient, administrator actor, table creation/replay, new hand entry, auth/resume binding and heartbeat. Preparing removes exact-owner local WS sessions and private replay fragments; invalidated sockets cannot recreate fragments. Existing internal settlement remains eligible for deleting participants. Narrow SQL try-lock triggers cover privileged profile/favorite/upload/claim helpers without blocking cleanup DELETE or unchanged historical creator. No broad database middleware/framework.

75 focused lifecycle/Redis/ledger/persistence/session tests passed; admin/quick-seat/persistence regression 46 passed with explicit test-only XP_CORS_ALLOW=https://arcade.test. Initial test runs without that allowlist returned expected CORS denial, and a replay fixture used an invalid global-sequence offset; both diagnosed rather than disabling production guards. Real PostgreSQL contention and exact-SHA WS preview remain launch evidence.

## Redis read-only inventory and decision boundary — 2026-10-18

New issue requirement was read before Redis work. Existing main/agent results reused; no Redis implementation/cutover was started. Netlify linked-site environment assigns UPSTASH_REDIS_REST_URL/TOKEN, XP_KEY_NS and session TTL through `all`, with no matching TOML override. Preview and Production therefore select the same configured endpoint and `kcswh:xp:v2` namespace. This is NOT evidence for two isolated Redis datasets; environment ownership cannot be inferred from these legacy keys. No endpoint, credentials, UUIDs or raw keys are recorded here.

At 2026-10-18 12:11 UTC, SCAN completed its read-only traversal (571 unique keys observed), TYPE/PTTL metadata only; no GET/value inspection, writer drain, backup or mutation. Concurrent writes/expiry mean this is observational inventory, not a cutover snapshot or completeness proof.

| Family | Keys | Without TTL | Notes / writer / ownership |
| --- | ---: | ---: | --- |
| total | 80 | 80 | canonical legacy XP; owner-approved reset direction, live execution separately gated |
| daily | 96 | 96 | calculate-xp; identity+period in key, legacy counters included in reset; new V3 Warsaw day/week semantics preserved |
| profile | 25 | 25 | fixed legacy XP cache; remove XP-only JSON, reset only XP fields in mixed records |
| migration pair | 359 | 359 | xp-identity; SHA-256(anonId\|UUID), numeric value not read; both original inputs not retained, cannot reverse/guess owner |
| migration user | 2 | 2 | hash(UUID), matchable only from authorized known UUID inventory; legacy XP conversion proof reset selected, with no legacy import afterwards |
| server-session | 1 | 0 | start-session/touch; remaining TTL approximately 76,616s; owner in protected value not read; do not force logout |
| shared all-time board | 1 | 1 | XP projection, reset legacy XP board only under separate GO; V3 ordinary cleanup removes exact member only |
| other namespace/infrastructure | 7 | 7 | outside current XP/profile prefix; not classified/read/deleted |

No session/state/lock/registry keys were observed in this traversal; that is not historical proof none can return. Configured session TTL is 604800s. The existing theoretical no-TTL session setting still requires finite V3 bounds.

**Owner update, 18 October:** the later explicit decision supersedes the earlier preservation proposal. Prefer reset of all historical XP (including owner/friend), levels, boards, XP sessions and conversion markers. Preserve Auth, identity profiles, avatars, CH, Poker, bonuses and archives. Mixed records require field-only XP reset. Do not guess owners of opaque hashes. Live reset remains unauthorized.

Latest owner decision: keep exactly one existing Upstash Free database, with logical namespace isolation. Earlier second-database proposals are withdrawn. Public [Redis pricing](https://upstash.com/pricing/redis) lists one Free database and 500K commands/month, 10GB/month bandwidth and roughly 250/256MB storage. Actual account quota/cycle is not visible through the application token; public FAQ still mentions an older daily limit. No paid option or auto-upgrade is assumed. Configuration/cutover, not provisioning, requires future GO.

### Latest Redis decision — 18 October 2026

Use one reviewed V3 per-environment contract and a controlled XP-only legacy reset, not historical XP migration. No dual-read/import from legacy after cutover. Use the existing single Upstash Free database with stage/prod namespaces; shared endpoint/credentials are explicitly accepted. No new database/account/instance/subscription or paid upgrade. Immutable build pins plus runtime configuration must reject cross-environment/downgrade errors; combined Free quota verification remains an operational gate. Keep T04d/T02f and financial retention unchanged. Detailed scope, drain, backup, rollback and GO/NO-GO are in [redis-cutover.md](redis-cutover.md); live reset/configuration/deploy/apply remain unauthorized.

## Targeted final review and local evidence

No extra framework, service, table or anonymous-history migration was added. Existing release row carries cutover evidence. All current XP writers use centralized key helpers and guard/index execution, including acceptance-OFF V3 and non-UUID anonymous restart fencing. Foreign/private-index self references fail before cleanup mutations. Reset manifest hashes bind snapshot values/types/TTLs as well as key/action; drift or incomplete snapshots cannot reuse an approval hash. No PostgreSQL+Redis atomicity is claimed. The index retains conservative references to expired keys until account cleanup; it contains key names only, not old session payloads. Old binaries/URLs require an operational drain: new Lua cannot protect old raw writes by itself.

146/146 local CI-equivalent fundamentals passed. After the index self-reference finding was fixed, 8/8 V3/reset/session tests and 1/1 full local deletion scenario passed again. The full flow uses actual PGlite schemas/request/lease/phase/Poker Leave/showdown/payout/deferred cash-out/ledger retirement/Storage safety and indexed local Redis cleanup; no unconditional done:true cleanup stub. Main pot 200 + positive wallet 75 burns once; side pot 100 and the other identity remain. Auth HTTP success-response loss reconciles exact UUID. Real Redis Lua/provider/PostgreSQL contention and Stage integration are still NOT RUN. Live reset runner is intentionally absent: the pure reset planner cannot mutate any service. No remote resource was created, reset or reconfigured.

Final TTL review: session IP limits now reuse atomicRateLimitIncr; administrative day/week ZADD and EXPIREAT share the existing guarded Lua mutation (including unchanged-score repairs). This closes crash windows that could leave temporary keys without TTL. Focused V3/maintenance/legacy-fence regression: 31 tests passed. Existing two Playwright backend XP award scenarios passed after explicit memory-fixture pinning.

## Free-only review: actual read-only metrics and capacity (18 October, 16:29 UTC)

No data values/UUIDs were read or published. Three read-only commands on the existing configured database: INFO stats, INFO memory, DBSIZE. Aggregate: **571 keys**, **159135 total_commands_processed**, **4 instantaneous_ops_per_sec**, **maxmemory=67108864 bytes (64MiB)**, **maxmemory_policy=noeviction**. used_memory=0 is a provider-reported value, not reliable evidence of zero storage use. The cumulative counter is not a monthly billable usage counter and the instantaneous rate is not a traffic forecast. No plan ID, reset cycle, current monthly usage/bandwidth or reliable occupied storage was available. The application REST token cannot call the management API; no management credentials are configured. No usage polling or mutation was performed.

Public [Free pricing](https://upstash.com/pricing/redis): one DB, 500K commands/month, 10GB bandwidth/month and roughly 250/256MB storage; [older FAQ](https://upstash.com/docs/redis/help/faq) still describes 10K/day. Observed 64MiB differs from the current public storage tier. Therefore actual entitlement/headroom is **UNVERIFIED**, not assumed to match public limits and not a reason to buy anything. [Management stats](https://upstash.com/docs/devops/developer-api/redis/get_database_stats) exposes actual monthly read/write/script requests/bandwidth, but requires unavailable authorized management access. Verify dashboard/account metrics before activation.

Command budget: namespaces share ONE combined quota; pipelining only saves network round trips. A guarded single-UUID write currently does epoch GET + permit-init EVAL + fenced mutation EVAL (3 top-level Redis calls), conversion can check two UUIDs (4 calls), plus caller reads. A cleanup page uses 2 GETs + one bounded Lua; fixed page budget <=100. Idle WS ticks scan SQL only and add no Redis polling. Index ZADDs occur inside the existing mutation EVAL, with one grouped multi-member ZADD per owner (implemented here), not another network call per key. Do not assume internal Lua operations are free quota: script billing counters must be reconciled on the actual plan. Conservative capacity planning should consider both external calls and nested Lua work, not count an HTTP pipeline as one command.

An illustrative 20–30 top-level calls per full authenticated XP award/sync gives at most ~16.6K–25K such requests/month out of a nominal 500K BEFORE leaderboard/status reads, Stage traffic, scripts' actual accounting and other consumers. This is a planning envelope, not measured traffic or a capacity guarantee. Four ops/s sustained would exceed that budget, but one instantaneous sample does not establish sustained usage. No automatic Free compliance PASS.

No-cost operational options if real headroom is low: use existing XP sync frequency/rate limits and backoff, avoid idle/tab-hidden polling and unnecessary admin backfills; pause discretionary Stage load; batch index registrations (done), use bounded owner-index cleanup rather than full Redis scans, and later combine epoch/permit reads in the existing Lua only with preserved SQL authorization/fencing tests. Do not cache ACTIVE permits across deletion/restarts or weaken financial/security guards. Account-lifetime owner-index references to expired keys consume storage: capture actual index growth/headroom and, only if needed, plan bounded guarded removal of proven expired references during existing maintenance (no new worker). Quota errors are retry/unavailable, never a trigger to provision or upgrade. Activation NO-GO if projected combined use exceeds actual Free headroom.

F1 rebuild audit: immutable artifact pins alone do not survive a fresh build after all provider variables are deleted. The existing build generator therefore includes a committed per-environment minimum-version floor (currently 2/2, unchanged activation state); cutover must raise the approved target to 3 in code. A fundamental fixture simulates that approved configuration commit and proves a subsequent build with all V3 variables lost fails without overwriting the existing V3 pin. Both Netlify and existing WS packaging use that generator. No floor was raised under the current GO.

### P2: missing Redis credentials after V3 activation (2026-10-18)

V3 without a nonblank `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` uses no memory fallback: Redis operations reject with `xp_store_unavailable` and XP/session/leaderboard/public-XP/admin-maintenance HTTP boundaries return 503 with no-store. No zero-XP response or weaker in-memory rate limit is accepted. Imports remain available so independent Poker/CH settlement continues; deletion recovery retries rather than declaring cleanup complete. `XP_TEST_MODE=1` retains explicit memory fixtures; pre-cutover V2 compatibility and existing TTL/reset protections remain unchanged. One configuration-failure regression covers missing URL/token and blank credentials, read/write/rate-limit failure and HTTP 503 without network access.

Operational gates remain: independently verify actual Upstash Free entitlement/monthly usage; approve allowlisted XP-only reset manifest and rollback/NO-GO evidence; prepare exact-SHA Stage fixtures and provider/Redis/Poker/CH deletion checks. Local fixtures do not establish Stage success. No reset, environment configuration change, shared migration, deployment, activation or merge is authorized by this change.
