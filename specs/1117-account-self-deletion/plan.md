# Account Danger Zone Implementation Plan

> Execution is blocked until owner reviews this package and gives separate GO. Use the existing SpecKit implementation workflow only after its Constitution Check; no implementation is authorized by this document.

**Branch**: `docs/1117-account-self-deletion` | **Date**: 2026-10-16 | **Spec**: [spec.md](spec.md)

**Goal**: owner-verified self-deletion at any time, immediate suspension, safe Poker/CH completion and fresh recreation with retained reward limits.

**Architecture**: one private durable request, shared lifecycle fence, existing authoritative WS Leave/settlement and existing WS maintenance tick for retries; canonical final BURN and closed USER retirement, Storage/Redis cleanup, hard Auth deletion last. One private verified-email HMAC reward-proof mechanism extends current welcome and campaign transactions.

## Technical Context

- JavaScript ESM on current Node/Netlify/Ubuntu WS runtime; browser globals/IIFE for JSP compatibility. Existing `postgres`, Supabase HTTP/Admin API, Redis/Upstash, sharp and Node test runner/PGlite; no new dependencies.
- PostgreSQL is authority for lifecycle and accounting; WS remains authority for gameplay. Redis remains XP store and must serialize writes against lifecycle acceptance.
- Scope: account UI, backend authentication and protected writes, Poker deferred exit, ledger retirement/retention, bonuses and privacy. No broad refactor or infrastructure setup.
- Performance: acceptance performs bounded proof verification + one DB transaction, never waits for hand settlement. Existing janitor tick scans <=10 due requests, separate from open tables. No extra periodic service. Financial correctness wins over claiming immediate completion.
- Unresolved release gates: R5 retention/legal policy, R6 exact fresh-proof feasibility, Storage capability expiry and legacy Redis cleanup limits. Concrete proposed contracts are defined; do not implement an insecure approximation if feasibility fails.

## Constitution Check (before and after design)

| Principle | Assessment |
|---|---|
| KISS/YAGNI | PASS design: reuse ledger, Leave, campaign tx, WS tick; focused lifecycle/proof modules only, no framework/cron/worker service. |
| Authoritative WS | PASS design: Netlify persists intent; WS table queues alone perform gameplay transitions and bootstrap/recovery. |
| Fail closed / environment separation | PASS documentation scope; R1–R8 are feature gates, not runtime PASS. No migrations/Stage mutations/deployments now; future current-task GO needed. |
| JSP / CSS / klog / CSP | Explicit frontend task; no new inline script unless matching SHA updated in `netlify.toml`. |
| Fundamental tests / concrete plans | Backend business, ledger concurrency, WS state/recovery only; no UI/CSS/JSP/glue suites. Concrete paths/contracts below and in tasks. |
| Merge policy | Documentation PR only, never self-merge. No implementation PR or deployment. |

Post-design: no constitution exception requested. Privacy/provider unknowns block execution and release; they are not waived by the architecture.

## Project Structure and exact responsibilities

| Layer | Existing targets | Planned additions / changes |
|---|---|---|
| Deletion API | `_shared/supabase-admin.mjs` auth/transactions; `_shared/api-cors.mjs` | New `netlify/functions/account-delete.mjs::handler()` for challenge/verify/confirm/status; reuse endpoint for GET rather than add status function. |
| Lifecycle | Existing `shared/` domain, Netlify and WS DB adapters | New `shared/account-deletion.mjs`: `withAccountLifecycleLock(tx,userIds,fn)`, `assertAccountActive(tx,userId)`, `requestAccountDeletion(tx,input)`, `advanceAccountDeletion(deps,requestId)`. Private DB helper handles RLS active check with restricted privileges. No new generic job framework. |
| Proof | Existing Supabase HTTP auth wrapper | New `_shared/account-delete-proof.mjs`: `issueDeletionChallenge(auth,deps)`, `verifyDeletionChallenge(auth,challengeId,code,deps)`; server receives proof, never browser assertions. |
| Economy | `_shared/chips-ledger.mjs::postTransaction/getOrCreateUserAccount/fetchCurrentUserAccountSnapshot` | Fence all USER recipients before writes, preserve internal historical replay, prevent closed account recreation; final burn from frozen persisted amount/payload. |
| Poker | `shared/poker-domain/leave.mjs`, both poker-reducer copies, `ws-server/poker/persistence/*leave*`, `ws-server/poker/handlers/{auth,leave}.mjs`, `ws-server/server.mjs` | All-in pending detach preserving participation; force exit via existing queue; check deletion for auth/commands/private broadcasts, resume via startup/janitor/settled callback. |
| XP/profile | `start-session.mjs`, `calculate-xp.mjs`, `_shared/xp-{ledger,identity,leaderboard,leaderboard-maintenance}.mjs`, `_shared/store-upstash.mjs`, `_shared/user-profile.mjs`, `_shared/profile-avatar.mjs` | Serialize grants/conversion/save, deny old UUID guest input, guard provisioning, durable cleanup manifests and bounded purge. |
| Reward proof | `_shared/welcome-bonus.mjs`, `_shared/bonus-campaigns.mjs`, welcome/bonus APIs | New `_shared/reward-identity.mjs`: authoritative verified-email/HMAC lookup, lock and receipt helpers, same caller tx. Extend existing claim transactions/status mapping. |
| UI | `account.html`, `js/account-page.js::wireEvents`, `js/auth/supabaseClient.js`, `js/user-ui-state.js`, `js/xpClient.js`, `js/i18n.js`, `account.html` existing account-local style block | Confirm/proof/accepted states, cache reset, explicit cap denial and pending deletion semantics. Verify actual stylesheet reference before changing. |
| Privacy | `legal/{privacy,terms}.{en,pl}.html` | Approved purpose/retention, forfeiture, delayed finalization, financial audit and public-copy limits. |

`_shared/` targets above mean `netlify/functions/_shared/`. New symbols are proposed interfaces, not claims that they already exist. Exact entities: [data-model.md](data-model.md); HTTP/WS contracts: [contracts/account-deletion.md](contracts/account-deletion.md).

## Six implementation stages and dependencies

### 1. Resolve gates and establish database invariants

T001–T004. Approve R5/R6 and any feasibility probe; capture current catalogs again, inspect grants/views/triggers/functions and provider capability horizon. Record actual migration filenames through normal Supabase CLI **only after GO**, not in this documentation change.

Plan two logical forward-only migrations under `supabase/migrations/`: `account_deletion_lifecycle` (private request/proof, active predicate, retirement constraints/FKs/RLS) and `reward_identity_receipts` (private identities/paid receipts/import markers). If retention proof definitions require a separate migration, add `account_deletion_retention_compatibility`. Generate timestamps with `supabase migration new <name>` and append exact filenames to these artifacts before SQL is authored; never guess them. Creating even an empty migration here would violate documentation-only scope.

Production has consolidated contracts: prepare separately reviewed equivalent contract under `supabase/production-migrations/` and its manifest only under Production authorization. Do not replay Stage migration history. Neither Stage automatic PR apply nor Production contract is authorized now. Future migration PR push can mutate shared Stage automatically; require explicit GO before that push under this task's stronger constraint.

Apply lifecycle and reward rules behind the not-yet-exposed deletion path, backfill trusted existing payouts before any hard deletion. Never enable new-account bypass during a staged rollout.

### 2. Install suspension and posting barriers

T005–T007. Extend shared authentication and the independent mint verifier; preserve provided-invalid-JWT rejection and normal guests. Add RLS/invoker/private read protection. All SQL mutations recheck under common lifecycle lock; central ledger protects every USER recipient including admin credits. Integrate Redis XP/source/conversion guards with the same lock across bounded writes. WS checks authenticated commands and private emission; no ACTIVE cache. Physical socket close is bounded notification after marker observation, while authorization is immediate.

Lock hierarchy: table/campaign locks → reward identity rows (if applicable) → lifecycle locks sorted by UUID → ledger account locks. Do not acquire a table/campaign/identity after lifecycle. Acceptance only takes lifecycle; finalizer does per-table work before final lifecycle seal. Claim/replay/import operations use one ordering. In-flight effects that committed before marker are accounted for; effects not yet committed must fail or finish under a lock that acceptance waits for.

### 3. Durable intent, Poker exit and financial finalization

T008–T012. Endpoint commits verified confirmation/proof consumption and PENDING atomically, returns 202 without holding connection. Start/reuse request lease in existing WS tick/startup; no detached Netlify promise. Authoritative per-table queue discovers all seats/hand obligations, performs non-all-in Leave, preserves all-in until settlement and retries deferred cash-out.

After all per-user obligations are conclusively settled, lock lifecycle and wallet, recheck final predicate, freeze burn amount and canonical payload in request progress, post BURN with `account-delete:<request-id>:burn:v1`, close USER and retire ownership in same transaction. A zero wallet records no-burn evidence. Replay reads receipt, not current zero balance. Block all late new postings while allowing non-mutating historical reconciliation. Preserve table escrow provenance; do not require opponents' escrow to be zero.

Update narrow retention/snapshot identity semantics and test Production/Stage contracts independently with fixtures before retiring USER. No rewriting hashes, financial entries or old idempotency keys.

### 4. Complete data cleanup and hard Auth deletion

T013–T014. Remove all indexed/legacy Redis/session/profile/favorites data through bounded operations and durable progress; drain in-flight writes and prevent resurrection. Keep minimal Storage manifest before deleting profile/upload rows; export existing internal `deleteStorageObject()` narrowly if needed. Unlike current `removeAvatar()`, final cleanup must retain and retry failures.

Signed upload expiry must be proven; five-minute pending-row TTL is insufficient. Wait actual maximum token validity plus bounded in-flight grace, then final origin rescan/removal; no COMPLETED before this. Track public output created by in-flight finalize for compensation. Privacy copy describes CDN/browser/backups limitations.

Only after finances and cleanup, call existing Supabase HTTP Admin hard-delete path using server secret handling. External calls are outside DB transactions with persisted step intents and bounded timeout. Reconcile old UUID on uncertain response, recheck lease generation and all prerequisites, then mark COMPLETED. Re-registration after Auth deletion gets a new UUID even if acknowledgement write retries. Completed-request status is minimal, not a retained public profile.

### 5. Reward continuity and fresh onboarding

T015–T018. Derive trusted identity from confirmed authoritative email (lock/read consistently with Auth change), HMAC version/domain separate from JWT secret. Single identity row lock handles absent proof; welcome paid receipts count <=3 under proposed approved horizon. Extend existing campaign tx with Daily family/day or once campaign-ID uniqueness, original idempotency keys, ledger and bonus_claims. Preserve amount/streak and other policies. Preserve global campaign max claims despite Auth cascades.

Before enforcement/deletion, backfill confirmed live accounts with private source-receipt dedupe; no historical email reconstruction. Missing HMAC/proof/confirmed email fails only protected claim. Rotation reads overlapping versions; expiry does not accidentally reset daily proof before UTC boundary. Policy for long-lived once campaigns is an explicit R5 prerequisite.

### 6. UI/legal, fundamental checks and authorized release gates

T019–T022. Expose UI only after all safety stages. Show warning, fresh proof, accepted/pending/completed/incident correctly and honest no-welcome/low-balance onboarding. Legal copy owner-reviewed. Run deterministic suites in [quickstart.md](quickstart.md); targeted manual Preview check covers presentation, not a new UI suite.

After separate GO: disposable Stage password+Google users; fault injection/restart, multi-table all-in, same-email recreation, 1/2/3/4 welcome and Daily/once proofs. WS Preview Deploy must use exact latest runtime-affecting SHA before E2E smoke; Netlify PR checks do not deploy WS. Production activation/migration/deployment separate GO, no self-merge, irreversible deletion has no rollback. Rollback means stop accepting new deletion while continuing safe recovery of accepted requests; never restore old UUID/assets or erase committed proofs.

## Review Focus and acceptance gates

1. Lifecycle read-check/write race and lock inversion: T005/T006/T007/T012 concurrency assertions.
2. All-in loses pot eligibility or shared escrow is burned: T009/T010 winner/loser/side-pot assertions.
3. External call succeeds after timeout/lease expiry: T011/T014 durable reconciliation and no duplicate effects.
4. Recreated UUID farms through identity/key/campaign/UTC changes: T016/T018 atomic payout proofs and preserved streak rules.
5. Personal data reappears through signed upload, lazy provisioning or guest XP: T007/T013/T014 barriers and delayed-completion evidence.

R1–R8 mapping and fixed findings: [research.md](research.md). No implementation readiness claim until R5/R6 approved and all other gates proven by future tests and authorized runtime checks.

## Complexity Tracking

No constitution violations. Two focused shared modules and one proof helper are justified by Netlify/WS and cross-campaign reuse. Private durable DB rows are necessary for restart safety; reusing WS maintenance avoids a new worker. Six stages, 22 tasks; estimate 10–15 engineering days plus external review/authorized verification. Documentation and feasibility gates can be reviewed independently; partial public deletion cannot be released safely.
