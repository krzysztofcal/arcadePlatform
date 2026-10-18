# Data model — V2, proposed schema only

## Private deletion request

`account_deletion_requests`: request_id UUID PK, old_user_id unique UUID without Auth FK, status PENDING/PROCESSING/RETRY/ERROR/COMPLETED, phase, accepted_at, progress/completed times, next_attempt_at, wait reason/not_before, lease owner/generation/until, redacted error/incident. One UUID has one request; replay returns its real state. Store frozen per-table/financial receipts, required cleanup paths and cursors only. No email/password/JWT/OTP or wholesale profile snapshots. RLS/revoked client grants; no public UUID enumeration. No account_deletion_challenges table, verification receipt or custom proof token.

PENDING/preparing intent blocks SQL immediately; accepted_at requires Redis fence acknowledgement too. Original owner may query minimal status while Auth exists. A 24-hour read-only status capability after Auth removal is implemented with a stored SHA-256 hash and expiry; plaintext is returned only to the verified owner; never make status bearer a financial authority. Missing post-delete access must not prevent background recovery or falsely claim completion.

## Retired USER wallet

Keep chips_accounts id/type USER, entries, sequence and provenance. Add retired_user_id/retired_at; live USER has user_id and no retired fields/system_key. Retired USER has null user_id, retired UUID/time, status closed, balance zero and null system_key. Replace both ownership CHECKs consistently; keep live FK, no FK from retired UUID to Auth. Enforce monotonic retirement and prevent wallet recreation for old UUID. Retention/snapshot/archive proofs recognize historical USER identity without rewriting hashes or reclassifying SYSTEM. Campaign creator FKs must be scrubbed/SET NULL without destroying others' campaign data.

## Recognized reward identity

Private versioned HMAC verified-email identity, welcome paid count saturated at three, Daily family+UTC-day receipt, once campaign UUID receipt, historical source dedupe. No Auth cascade and no raw email. Lock identity/campaign and write ledger, proof and bonus_claims atomically; quota paid count independent of Auth cascade. Welcome no rolling 12-month reset or 24h cooldown; policy retention/legal/rotation determines actual recognizable horizon and is a release gate, not a lifetime-recognition promise. Daily rejects backdated payout after proof pruning; once campaign rename/pause/reopen retains identity. New UUID never inherits streak or permissions.

## Storage and cache

Preserve signed upload paths through provider capability expiry plus validated in-flight/clock grace and confirmed final removal. Five-minute finalize TTL is not upload capability expiry. Quiesce all legacy issuers before cutoff; prove bucket temporary-only before global orphan sweep, include records already lost. Do not complete while late upload can recreate files. Existing request manifest holds only required paths. Redis permits/epoch guard every UUID-associated create/renew write including admin/sync/guest conversion and memory parity. Removal-only operations remain exact-target and do not remove fences.

Local-only initial schema proposal: `supabase/manual/1117-account-deletion-requests-v2.sql`; executed only in PGlite tests. No automatic migration or live schema has changed. Additional local-only wallet-retirement, reward-identities and avatar-tracking proposals accompany it. No canonical migration or live schema changes. Private reward config requires approved key/version/history; avatar cutover attestation is not auto-seeded. Read-only status token is not financial authority. Retired USER archive compatibility and legacy Redis ownership remain unfinished.
