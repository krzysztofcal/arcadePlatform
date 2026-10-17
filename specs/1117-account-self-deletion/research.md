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

Current main baseline 9a43f4cf. DB Stage Apply PR currently runs for drafts; implementation must guard drafts before including schema changes and must not dispatch/apply migrations under current authorization. V2 read-only Stage and Production pg_constraint refresh confirmed the same eight public Auth FKs and both USER ownership checks; catalog-evidence.json records the scoped result. Original detailed inventory remains historical. Preserve exact target separation. Read-only catalog refresh may inspect constraints/policies only, never unrelated user data/secrets. No shared Stage/Production mutations are intended.

## Primary documentation

- https://supabase.com/docs/reference/javascript/auth-admin-deleteuser — official hard-delete backend API.
- https://supabase.com/docs/guides/auth/managing-user-data — Storage ownership and surviving issued JWT caveats.
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword — standard password login.
- https://supabase.com/docs/reference/javascript/auth-signinwithoauth — standard Google OAuth; do not invent stronger freshness guarantees.

## Targeted review requirements

Review all-in settlement, late credits/final seal, both USER checks/retention proofs, SQL lock order and leases, all Redis writers, same-email new UUID, claim atomicity/quota, upload-capability horizon, secret/log minimization and false completion. Existing tests do not establish live configuration; unfinished work stays unchecked in tasks.md. No implementation milestone is labeled full feature completion until integrated evidence exists.

## Initial implementation evidence

Durable request/lease/ACTIVE foundation and official Auth HTTP adapter are implemented but not wired to public acceptance or WS scheduler. Transactional adapters must call assertDeletionLease in their effect transaction; Auth requires durable-intent authorization before reconciliation/deletion. Financial incidents survive stale workers. Phase-specific receipts and actual financial/Storage/fence adapters remain unfinished. All-in pending detach now preserves showdown eligibility and post-settlement cash-out through existing Leave. Local schema proposal is outside automatic migrations; no Production inventory bypass. Draft workflow guard and dedicated CI fundamentals job are included. No feature activation or live destructive probe was performed.
