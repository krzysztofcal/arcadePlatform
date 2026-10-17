# Proposed data model — no schema changes executed

## Private deletion request

`account_deletion_requests`: `request_id` UUID PK, `old_user_id` unique UUID without Auth FK, status `PENDING|PROCESSING|FINALIZING|COMPLETED`, durable step/progress receipts, intent/accepted/progress/completed times (accepted_at only after SQL and Redis fences confirmed), per-step lease owner/generation/until, wait_reason/due_at, next_attempt_at, consecutive_failures (diagnostic only), redacted error_code and incident flag. RETRY is scheduling metadata, never restoration of ACTIVE. One request per old UUID; marker continues denying pending/retired identity. After completion keep minimum operational evidence only for approved retention; existing retired financial identity and Auth nonexistence remain authorization evidence, not a permanent email tracker.

Progress records store immutable per-table outcome references, final BURN payload/amount/transaction receipt and cleanup manifest/cursors. No raw email/password/OTP/JWT; no wholesale user snapshot. External effects persist intent before call and reconcile before next state. RLS enabled; revoke client/PUBLIC grants, server-only access.

## Single-use proof

`account_deletion_challenges`: random challenge UUID and reserved request_id (no PENDING deletion row before confirmation), old UUID/original validated session_id/request_id/challenge-generation binding, purpose `account_delete`, creation/expiry (5 minutes), attempts limit (5), consumed_at, server-only verification receipt and authoritative email-version binding (non-raw fingerprint using dedicated HMAC). No reusable login token retained. Proposed issuance rate <=3 per user/15 minutes with existing rate-limit store. TTL and provider rate limits both apply; no OTP verification bypass if store unavailable. Proof consumption and request creation in same transaction; existing accepted request is returned idempotently without requiring reuse of consumed proof.

## Retired financial account

Existing `chips_accounts` retains `id`, `account_type='USER'`, all entries and sequence. Add `retired_user_id` nullable UUID, `retired_at` nullable timestamptz. Valid live USER: live user_id non-null, retired fields NULL, system_key NULL. Valid retired USER: user_id NULL, retired_user_id non-null, retired_at non-null, status closed, balance zero, system_key NULL. Non-USER rules unchanged. Preserve live Auth FK; no FK from retired UUID to Auth. Both existing ownership CHECKs replaced consistently; live/retired uniqueness enforced; server guard prevents identity appearing in both forms or making new wallet for retired UUID. Trigger/privilege constraints enforce monotonic retirement and forbid retired identity/account edits except existing authorized retention operations. Retention/snapshots use historical identity coalesce without reclassifying USER as SYSTEM. No new accounting enum needed.

## Private reward identity and confirmed payouts

Use one private recognized identity with HMAC version/digest aliases, saturated successful welcome count (0..3), last successful update and program-purpose reference; no Auth FK or raw email/profile/login/IP/device history. Paid proof source key prevents duplicate import/replay; at most three welcome proofs retained for eligibility, discard detail when reconciliation no longer needs it while retaining count. Welcome count never expires while program continues; counter update and ledger payout commit together. Identity row lock also protects the first missing receipt. Version aliases resolve to same identity; do not assume deleted identities can be re-HMACed without email.

Receipts for Daily: identity/family poker_daily/UTC date unique, retain day-end+48h for reconciliation, no backdating or old-day retry payout after pruning. Once: identity/immutable campaign UUID unique while campaign can be claimed/reopened; global max_total_claims uses monotonic successful-paid count independent of Auth cascade and receipt pruning. Under campaign row lock increment only on newly committed payout in same tx as ledger, bonus_claims and identity proof; known historical claims initialize it once before activation without minting CH or decrement on deletion. Source dedupe covers retry/import; no duplicate receipt+claim counting.

Purpose retention proposal (legal sign-off pending): welcome marker until genuine final program closure, once marker until campaign irreversibly closed and unresolved payouts reconciled, then purge within 30 days; annual necessity review, no renewal by failed claim/login and no reset by renaming/pausing program. Same program cannot restart with erased counters. Daily expiry as above. Individual erasure/objection/restriction handled under approved GDPR workflow; proof erasure may limit recognition, not change business cap. Separate financial audit retention must not be reused as covert perpetual bonus tracking.

Stable HMAC derivation key may need to last as long as dependent proof; rotate wrapping/access secrets separately. Changing derivation key needs old recognition versions until no unencountered identity depends on them. Lost/compromised key is an incident blocking protected payout pending reviewed resolution, never silent counter reset. No extra general identity framework/table beyond private identity and paid receipts justified.


## Cleanup manifest and obligations

Extend existing profile_avatar_uploads with signing intent, capability_not_after/cleanup_after, cleanup state and tracked output path. Five-minute expires_at only controls finalize eligibility. Preserve consumed/expired rows until two-hour capability horizon plus validated in-flight/clock grace and confirmed final removal; do not delete the only pointer from cleanupExpiredUploads or finalize finally. Existing request progress holds only paths needed before Auth cascade, per-step leases and Redis cursor/TTL evidence. Legacy rows already removed require global pending-bucket orphan reconciliation after old-issuer quiescence; deletion activation waits for that rollout gate (research.md). Do not drop `profile_avatar_uploads`/profile pointers before copying required paths. Random public `.webp` keys have no user prefix, so track before upload; never infer complete ownership from filename matching alone.

Table obligations reference existing authoritative receipts; do not add a duplicate escrow/settlement ledger. All-in pending detach must preserve the existing hand participant until settled; use existing deferred seat semantics with narrowly extended marker. No Auth cascade can delete active financial obligations.

## Redis mutation ownership (existing structures only)

No new registry/table. Existing permits/epoch fence each UUID's creating/renewing operations, including raw SET/SETEX/projection writes moved into existing-store guarded execution. Random server-session keys carry a validated owner in their value; touch checks existing owner/session atomically and does not create missing sessions. Hashed state/migration keys use trusted existing key builders; no prefix-based ownership guess. Admin/sync use target UUID context. Cleanup manifest/index/legacy scan must cover these keys and exact leaderboard members; removal keeps BLOCKED/epoch evidence and other users/shared sets intact. Current memory adapter mirrors denial semantics, not an unfenced fallback.

## FK treatment

`chips_accounts.user_id` retained for live only. `bonus_campaigns.created_by` and `bonus_campaign_eligible_users.created_by` become nullable SET NULL (or equivalent audited scrub before hard delete); other users/campaigns survive. Own profile/favorites/bonus eligibility/bonus_claims/avatar-upload cascades stay after independent proof/path preservation. Poker and financial UUIDs without Auth FK require explicit retention/cleanup, not blind cascading.
