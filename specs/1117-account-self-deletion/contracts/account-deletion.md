## Verified Stage boundary

Stage schema is applied with release=false. Missing Storage/legacy Redis cutover still forbids completion. Real tests found and fixed readonly Lua argument mutation and postgres.js JSON parameter encoding. Official Auth fixture teardown is not a successful account-delete finalizer. See research.md current evidence/NOT TESTED matrix and tasks.md current authorization. No monthly billing gate remains; quota errors remain unavailable/retryable.

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

New private key discovery must be deterministic from server UUID and approved environment namespace. No whole-Redis SCAN in the ordinary deletion workflow. Prefix iteration is permitted only within that owner's namespace; shared projection member removals are exact. Legacy scanning is a one-time controlled inventory/reset procedure, not a runtime fallback. done:true requires verified writer drain, approved/verified legacy outcome, sticky BLOCKED+epoch and zero remaining private keys/member fragments. Missing proof or opaque legacy ownership remains incomplete.

Configured Preview/Production currently share Redis/namespace. No reset, forced logout, copy/remove or configuration switch is authorized by this code-preparation task. Separate owner approval must identify the actual shared target and preservation/backup scope.

### Latest Redis decision — 18 October 2026

Use one reviewed V3 per-environment contract and a controlled XP-only legacy reset, not historical XP migration. No dual-read/import from legacy after cutover. Use the existing single Upstash Free database with stage/prod namespaces; shared endpoint/credentials are explicitly accepted. No new database/account/instance/subscription or paid upgrade. Immutable build pins plus runtime configuration must reject cross-environment/downgrade errors; owner accepts combined Free-quota exhaustion risk; billing/monthly headroom is not a release gate. Keep T04d/T02f and financial retention unchanged. Detailed scope, drain, backup, rollback and GO/NO-GO are in [redis-cutover.md](../redis-cutover.md); shared V2 reset and Production remain unauthorized; isolated Stage operations follow the current GO.

### Follow-up review: Free-only / immutable configuration / elapsed TTL

One existing Free database is the approved topology, with exact stage/prod namespaces and shared credentials. No provisioning/purchase/plan change. V3 cutover requires raising the committed per-environment minimum-version floor from 2 to 3 under separate GO, the generated artifact's immutable version/environment pins and complete matching runtime variables; deleting runtime variables cannot silently choose V2 or Production. Netlify, WS and background imports share the resolver. Legacy/unpinned artifacts remain supported only before the authorized cutover; all old issuers must then be retired. The reset manifest captures Redis TIME/expiry and content hash, not a future exact PTTL expectation: natural countdown/verified expiry is allowed, unknown absence/ownership-content/type/expiry-policy change is NO-GO, and the future executor must atomically check+mutate with current TTL preservation. Read-only Free usage evidence is incomplete (see research.md); this does not authorize a paid alternative. T04d/T02f, bonus proofs, all-in/BURN/Auth-last and release guards are unchanged.

## Tracking before acceptance

ACCOUNT_DELETION_AVATAR_TRACKING_ENABLED=1 can record/retain upload/output and previous-avatar manifests with ACCOUNT_DELETION_ENABLED=0; both flags default off, and no flag is deployed here. It is allowed only after legacy signers AND manifest-deleting cleanup handlers are retired. Storage done still requires real maximum capability horizon, in-flight reconciliation and confirmed exact-path removal. Netlify branch config permission failure keeps Preview unavailable; no fallback to shared V2 is authorized.
