# Proposed data model — no schema changes executed

## Private deletion request

`account_deletion_requests`: `request_id` UUID PK, `old_user_id` unique UUID without Auth FK, status `PENDING|PROCESSING|FINALIZING|COMPLETED`, durable step/progress receipts, accepted/progress/completed times, lease owner/generation/until, next_attempt_at, consecutive_failures, redacted error_code and incident flag. RETRY is scheduling metadata, never restoration of ACTIVE. One request per old UUID; marker continues denying pending/retired identity. After completion keep minimum operational evidence only for approved retention; existing retired financial identity and Auth nonexistence remain authorization evidence, not a permanent email tracker.

Progress records store immutable per-table outcome references, final BURN payload/amount/transaction receipt and cleanup manifest/cursors. No raw email/password/OTP/JWT; no wholesale user snapshot. External effects persist intent before call and reconcile before next state. RLS enabled; revoke client/PUBLIC grants, server-only access.

## Single-use proof

`account_deletion_challenges`: random challenge UUID, old UUID/session binding, purpose `account_delete`, creation/expiry (5 minutes), attempts limit (5), consumed_at, server-only verification receipt and authoritative email-version binding (non-raw fingerprint using dedicated HMAC). No reusable login token retained. Proposed issuance rate <=3 per user/15 minutes with existing rate-limit store. TTL and provider rate limits both apply; no OTP verification bypass if store unavailable. Proof consumption and request creation in same transaction; existing accepted request is returned idempotently without requiring reuse of consumed proof.

## Retired financial account

Existing `chips_accounts` retains `id`, `account_type='USER'`, all entries and sequence. Add `retired_user_id` nullable UUID, `retired_at` nullable timestamptz. Valid live USER: live user_id non-null, retired fields NULL, system_key NULL. Valid retired USER: user_id NULL, retired_user_id non-null, retired_at non-null, status closed, balance zero, system_key NULL. Non-USER rules unchanged. Preserve live Auth FK; no FK from retired UUID to Auth. Both existing ownership CHECKs replaced consistently; live/retired uniqueness enforced; server guard prevents identity appearing in both forms or making new wallet for retired UUID. Trigger/privilege constraints enforce monotonic retirement and forbid retired identity/account edits except existing authorized retention operations. Retention/snapshots use historical identity coalesce without reclassifying USER as SYSTEM. No new accounting enum needed.

## Private reward identity and successful-payment receipts

One private identity row has internal random ID, versioned HMAC digest(s), expiry derived from surviving proofs, no Auth FK. Digest aliases for active/previous key versions resolve to this same identity. Store only supported versions and enforce unique digest/version; serialize key consolidation to prevent split counters.

Paid receipt fields: identity ID, reward scope `welcome|poker_daily|once`, scope key (welcome fixed, Daily fixed family, once immutable campaign UUID), UTC period (Daily only), paid_at, expires_at, minimal private source/ledger reference for dedupe. No public UUID/email mapping. Welcome receipts count retained confirmed grants, maximum three eligibility; imported historical count may already exceed three and must deny further claims. Daily unique identity/family/day; once unique identity/campaign. Unique source receipt prevents replay/import double count. Proof and CH/bonus_claims commit together using caller tx. Receipt remains independent of Auth cascade.

Proposed retention (R5 NOT APPROVED): welcome/once per-payment 12 months; Daily day-end +48 hours; expire each receipt independently; prune empty identities and obsolete aliases using existing WS request-maintenance tick bounded cleanup (no new cron). No failed-attempt renewal. A campaign lasting beyond this window needs an approved compatible policy. Financial audit retention is separate; proof reference does not authorize indefinite anti-farming reuse of ledger.

## Cleanup manifest and obligations

Keep only necessary object paths, signed-capability not-after, bounded operation leases and Redis cleanup cursor/remaining TTL horizon until cleanup confirmed. Do not drop `profile_avatar_uploads`/profile pointers before copying required paths. Random public `.webp` keys have no user prefix, so track before upload; never infer complete ownership from filename matching alone.

Table obligations reference existing authoritative receipts; do not add a duplicate escrow/settlement ledger. All-in pending detach must preserve the existing hand participant until settled; use existing deferred seat semantics with narrowly extended marker. No Auth cascade can delete active financial obligations.

## FK treatment

`chips_accounts.user_id` retained for live only. `bonus_campaigns.created_by` and `bonus_campaign_eligible_users.created_by` become nullable SET NULL (or equivalent audited scrub before hard delete); other users/campaigns survive. Own profile/favorites/bonus eligibility/bonus_claims/avatar-upload cascades stay after independent proof/path preservation. Poker and financial UUIDs without Auth FK require explicit retention/cleanup, not blind cascading.
