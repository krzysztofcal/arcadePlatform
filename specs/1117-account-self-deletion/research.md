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

Preferred isolation is a second database within the existing Upstash account, not a new account. Public [Redis pricing](https://upstash.com/pricing/redis) lists one Free database; up to ten databases have no additional database-count charge, which does not mean ten free databases. PAYG is $0.20/100K commands, storage $0.25/GB (first GB free), bandwidth first 200GB/month free; 1M commands would be about $2 before other billable usage. Actual account plan/quota cannot be verified with the application REST token; no management credentials were found in documented locations. Provisioning, budget/plan and configuration need separate GO. Namespace isolation is the fallback; both modes require environment validation.

### Latest Redis decision — 18 October 2026

Use one reviewed V3 per-environment contract and a controlled XP-only legacy reset, not historical XP migration. No dual-read/import from legacy after cutover. Prefer independent Stage/Preview database under the existing Upstash account; current Production database stays in place. Actual account eligibility/cost approval is still an operational gate. Namespace fallback must reject cross-environment configuration. Keep T04d/T02f and financial retention unchanged. Detailed scope, drain, backup, rollback and GO/NO-GO are in [redis-cutover.md](redis-cutover.md); live reset/provision/configuration/deploy/apply remain unauthorized.

## Targeted final review and local evidence

No extra framework, service, table or anonymous-history migration was added. Existing release row carries cutover evidence. All current XP writers use centralized key helpers and guard/index execution, including acceptance-OFF V3 and non-UUID anonymous restart fencing. Foreign/private-index self references fail before cleanup mutations. Reset manifest hashes bind snapshot values/types/TTLs as well as key/action; drift or incomplete snapshots cannot reuse an approval hash. No PostgreSQL+Redis atomicity is claimed. The index retains conservative references to expired keys until account cleanup; it contains key names only, not old session payloads. Old binaries/URLs require an operational drain: new Lua cannot protect old raw writes by itself.

146/146 local CI-equivalent fundamentals passed. After the index self-reference finding was fixed, 8/8 V3/reset/session tests and 1/1 full local deletion scenario passed again. The full flow uses actual PGlite schemas/request/lease/phase/Poker Leave/showdown/payout/deferred cash-out/ledger retirement/Storage safety and indexed local Redis cleanup; no unconditional done:true cleanup stub. Main pot 200 + positive wallet 75 burns once; side pot 100 and the other identity remain. Auth HTTP success-response loss reconciles exact UUID. Real Redis Lua/provider/PostgreSQL contention and Stage integration are still NOT RUN. Live reset runner is intentionally absent: the pure reset planner cannot mutate any service. No remote resource was created, reset or reconfigured.
