# Proposed account-deletion and reward contracts

All interfaces below are proposed, not implemented. No arbitrary target UUID/email accepted. Use existing origin/CORS policy, same-origin bearer-authenticated JSON, `Cache-Control:no-store`; require explicit allowed origin, reject cross-site requests, never log proof/token/password/email. CORS is not authorization. Provider configuration and R6 feasibility remain blocking gates.

## One endpoint: `/.netlify/functions/account-delete`

- `POST {action:'challenge'}`: validate current owner/session and authoritative confirmed email, issue purpose-bound five-minute OTP challenge through proven existing Supabase transport, return `{challengeId,expiresAt}` only. Issuance rate <=3/user/15min, five verification attempts, fail closed on limiter/service failure. Google-only uses the same verified-email possession proof; missing trustworthy email cannot silently pass.
- `POST {action:'verify',challengeId,code}`: server verifies new challenge response, returned old UUID, original session and email version. Return single-use opaque deletion authorization bound to that challenge; retain only its hash/receipt. It must not be usable to delete another session's account. Do not return provider refresh tokens. Alternatively combine verification and confirmation in one POST if this avoids unnecessary stored authorization; keep same bindings and atomic consumption.
- `POST {action:'confirm',challengeId,authorization,confirmation:'DELETE_ACCOUNT',acknowledgeForfeiture:true}`: revalidate owner/explicit confirmation and consume proof in transaction with PENDING, one request/UUID. Return 202 `{requestId,status:'PENDING',accepted:true,completed:false}`. Existing accepted request returns its real state idempotently without consuming proof again, only to authenticated owner or previously issued narrow status capability.
- `GET`: authenticated owner gets minimal status. After suspension general app APIs deny access; this endpoint alone may use identity-only signature/session verification and an owner-matched request query. After Auth is removed, use a random >=256-bit read-only status capability issued on acceptance (hash stored, short finite lifetime, no financial/profile reads); transport it only in Authorization/header, not URLs/logs. Without capability/valid owner return generic 401/404; no public UUID lookup. Capability expiration never blocks background completion; support reference can resolve incidents through authorized operators.
- Status shape `{requestId,status,accepted:true,completed:boolean,retryable:boolean}` with redacted phase/incident message and optional next retry time. Do not expose table IDs, balances, email HMACs, old transaction/history or internal diagnostics.
- Errors: 400 malformed/confirmation missing; 401 invalid session/proof; 403 wrong subject/session or account suspended on general APIs; 409 proof email changed; 429 challenge limits; 503 dependency unavailable. Pending hand/CH balance is never a reason to reject a verified request.

Status capability proposal: 24h absolute TTL, rotation by valid owner while still present, no account authority. UI may stop polling on expiry without claiming deletion complete. Owner reviews delayed completion/status UX with architecture.

## Internal lifecycle interfaces

`withAccountLifecycleLock(tx,userIds,fn)`: transaction-scoped locks sorted/deduplicated by UUID. `assertAccountActive(tx,userId)`: authoritative Auth existence plus request/retired state; explicit denial on unavailable state. `requestAccountDeletion(tx,{oldUserId,sessionId,proofReceipt,confirmation})`: consume and upsert intent; no network/table action under lock. `advanceAccountDeletion(deps,requestId)`: fenced step progression and durable retry; only trusted WS service adapters can invoke financial/table actions.

Ordinary operations after suspension return terminal `account_deletion_pending` or `account_deleted`; clients stop retries and clear account/award session. Valid anonymous gameplay remains unchanged; presenting old UUID as an anonymous source does not bypass suspension. Internal settlement permission comes from server code and persisted obligation, never request JSON, JWT metadata or client-selected purpose.

## WS contract

No new public gameplay command. Existing Leave/settlement/queue adapters are reused internally. Auth/reconnect/protected frames/private snapshots recheck lifecycle; pending user denied and sessions invalidated. Optional terminal notification `{type:'accountDeletionPending'}` contains no private financial state, followed by close; lack of notification cannot permit action. No user commands/automatic rebuy/re-entry after marker. Non-all-in folds through current Leave; all-in pending detach preserves normal showdown before cash-out/BURN. Existing public/lobby data requires separate minimization of removed profile identity.

## Reward response contract

Keep current welcome/bonus response shapes and existing UUID idempotency keys. Add reasons `welcome_bonus_limit_reached`, `already_claimed_by_identity`, `verified_email_required`, `reward_identity_unavailable` with eligible=false. Recreated account must not receive old UUID/transaction receipt or streak via status; show denial and next UTC eligibility only. A replay by original valid active UUID can retain existing receipt semantics. GET is advisory; POST checks identity, account, UTC/campaign policy and pays atomically. No extra CH source or signup rejection.

## Closure and recovery contract

Only finalizer may close/retire USER or hard-delete Auth. Completed means financial seal/receipt, required private cleanup, capability horizon and verified Auth removal all done. Retry unknown outcome by original idempotency/progress evidence. No API returns completed for a durable intent alone. Incident does not re-enable account; operator tooling must use current access controls and preserve audit evidence.
