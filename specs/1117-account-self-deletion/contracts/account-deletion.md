# Account deletion contract — V2

Proposed interfaces are not activation approval. No custom OTP/challenge endpoint or proof receipt. Official Supabase Auth only; backend service-role secret never reaches browser/logs.

## Netlify account-delete

`POST /.netlify/functions/account-delete`: verified bearer owner, explicit allowed Origin (not merely CORS headers), application/json, body `{confirmation:"DELETE_ACCOUNT",acknowledgeForfeiture:true}`. Reject client target user_id/email, unknown fields and malformed payload. Server obtains UUID from verified Auth, checks account/session ownership and durable lifecycle; normal verified owner plus explicit irreversible consent per V2. Optional fresh login must use supported isolated password/Google API with same server-verified UUID; no JWT refresh/iat or unchecked redirect claim. No expiry/challenge token from old OTP design.

Before endpoint activation all SQL/Redis/WS/private-delivery fences and finalization integrations must pass. Without complete configuration return 503 before acceptance, never a fake PENDING. Duplicate accepted request returns existing state even if ordinary app authorization is now suspended. SQL preparing intent persists despite Redis outage; response must distinguish preparing from fully accepted. `accepted:true` requires acknowledged full fence; `completed:true` only after safe final cleanup and successful/reconciled Auth removal.

`GET` returns minimal owner-matched request state, no arbitrary UUID lookup. While blocked, this endpoint alone may validate identity for status/replay; general APIs deny. After hard deletion, status delivery uses a 24-hour read-only capability (SHA-256 hash/expiry stored, no financial authority) or support reference; lack of browser access does not stop recovery.

Implemented status: `{requestId,status,phase,accepted,completed,retryable,requiresIntervention}`; durable phase is preparing/poker/burn/cleanup/auth/completed. POST additionally returns a statusToken once; GET accepts `Authorization: Deletion <token>` with requestId (never token in URL). Duplicate POST rotates this read-only token. Expiry returns 404; recovery continues without browser access. Do not expose table IDs, balances, HMACs, old history or internal errors. UI distinguishes accepted, processing, completed, intervention; Storage may exceed two hours. 400 invalid confirmation/body; 401 invalid auth; 403 wrong origin/owner; 405 unsupported method; 503 unavailable/incomplete safety dependencies. Balances and active tables never require user manual clearance.

## Internal finalization

requestDeletion derives identity from trusted caller; assertAccountActive denies missing/deleting/retired UUID. advanceDeletion uses persisted phase and lease generation; only trusted WS adapters perform Leave/settlement. All-in remains eligible through showdown/side-pot. Wait for all obligations, then one balanced BURN with original idempotency receipt and retirement, cleanup, Auth last. Financial mismatch creates incident and stops destruction. Retried Auth delete first reconciles exact UUID with official Admin API; no provider physical-erasure certificate. Never delete a replacement UUID found by email.

## Existing API impacts

Protected HTTP/WS/JWT operations require ACTIVE at final effect boundary, including admin recipients and Redis raw writers. Internal settlement is explicit trusted code, not client flags. New account same email/Google has new UUID and resources; welcome fourth payout denied, Poker Daily same-day denied, once campaign repeat denied by recognized identity. Global campaign quota survives bonus_claims cascade. Existing other campaign responses and ordinary Poker Leave compatibility retained.

## Disabled preparation boundary

New POST requires ACCOUNT_DELETION_ENABLED=1 and account_deletion_release.enabled=true. Both are unapproved for activation. Legacy Redis cleanup currently returns incomplete for unprovable ownership; Auth deletion must not run, not even for no-table/zero-balance users. No false COMPLETED. Existing deletion recovery remains independent of the new-acceptance release row.

## Redis ownership/cutover contract — 18Oct owner requirement

New private key discovery must be deterministic from server UUID and approved environment namespace. No whole-Redis SCAN in the ordinary deletion workflow. Prefix iteration is permitted only within that owner's namespace; shared projection member removals are exact. Legacy scanning is a one-time controlled inventory/migration procedure, not a runtime fallback. done:true requires verified writer drain, approved/verified legacy outcome, sticky BLOCKED+epoch and zero remaining private keys/member fragments. Missing proof or opaque legacy ownership remains incomplete.

Configured Preview/Production currently share Redis/namespace. No reset, forced logout, copy/remove or configuration switch is authorized by this code-preparation task. Separate owner approval must identify the actual shared target and preservation/backup scope.
