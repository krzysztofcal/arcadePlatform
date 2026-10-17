# Account Danger Zone Implementation Plan

> Execution is blocked until owner reviews this package and gives separate GO. Use the existing SpecKit implementation workflow only after its Constitution Check; no implementation is authorized by this document.

**Branch**: `docs/1117-account-self-deletion` | **Date**: 2026-10-16 | **Spec**: [spec.md](spec.md)

**Goal**: owner-verified self-deletion at any time, immediate suspension, safe Poker/CH completion and fresh recreation with no-timeout welcome and campaign-purpose reward limits.

**Architecture**: one private durable request, shared lifecycle fence, existing authoritative WS Leave/settlement and existing WS maintenance tick for retries; canonical final BURN and closed USER retirement, Storage/Redis cleanup, hard Auth deletion last. One private verified-email HMAC reward-proof mechanism extends current welcome and campaign transactions.

## Technical Context

- JavaScript ESM on current Node/Netlify/Ubuntu WS runtime; browser globals/IIFE for JSP compatibility. Existing `postgres`, Supabase HTTP/Admin API, Redis/Upstash, sharp and Node test runner/PGlite; no new dependencies.
- PostgreSQL is authority for lifecycle and accounting; WS remains authority for gameplay. Redis remains XP store and must serialize writes against lifecycle acceptance.
- Scope: account UI, backend authentication and protected writes, Poker deferred exit, ledger retirement/retention, bonuses and privacy. No broad refactor or infrastructure setup.
- Performance: acceptance performs bounded proof verification + one DB transaction, never waits for hand settlement. Existing janitor tick scans <=10 due requests, separate from open tables. No extra periodic service. Financial correctness wins over claiming immediate completion.
- Unresolved release gates: R5 retention/legal policy, R6 exact fresh-proof feasibility, legacy-safe Storage rollout/grace bound and legacy Redis cleanup limits. Concrete proposed contracts are defined; do not implement an insecure approximation if feasibility fails.

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

Lock hierarchy: Auth-row shared read lock when stable confirmed-email proof is required (before other locks), then table/campaign locks → reward identity rows (if applicable) → lifecycle locks sorted by UUID → ledger account locks. Do not acquire a table/campaign/identity after lifecycle. Acceptance only takes lifecycle; finalizer does per-table work before final lifecycle seal. Claim/replay/import operations use one ordering. In-flight effects that committed before marker are accounted for; effects not yet committed must fail or finish under a lock that acceptance waits for.

### 3. Durable intent, Poker exit and financial finalization

T008–T012. Endpoint persists verified owner intent/proof consumption as PENDING; DB denies access immediately. Confirm Redis Lua suspension fence, then record accepted_at and return accepted 202 without awaiting hands/uploads. Interim durable suspension_preparing/retrying is truthful and resumes automatically; SQL+Redis are not one transaction. See research.md R2 timeout/restart ordering. Start/reuse request lease in existing WS tick/startup; no detached Netlify promise. Authoritative per-table queue discovers all seats/hand obligations, performs non-all-in Leave, preserves all-in until settlement and retries deferred cash-out.

After all per-user obligations are conclusively settled, lock lifecycle and wallet, recheck final predicate, freeze burn amount and canonical payload in request progress, post BURN with `account-delete:<request-id>:burn:v1`, close USER and retire ownership in same transaction. A zero wallet records no-burn evidence. Replay reads receipt, not current zero balance. Block all late new postings while allowing non-mutating historical reconciliation. Preserve table escrow provenance; do not require opponents' escrow to be zero.

Update narrow retention/snapshot identity semantics and test Production/Stage contracts independently with fixtures before retiring USER. No rewriting hashes, financial entries or old idempotency keys.

### 4. Complete data cleanup and hard Auth deletion

T013–T014. Remove all indexed/legacy Redis/session/profile/favorites data through bounded operations and durable progress; drain in-flight writes and prevent resurrection. Keep minimal Storage manifest before deleting profile/upload rows; export existing internal `deleteStorageObject()` narrowly if needed. Unlike current `removeAvatar()`, final cleanup must retain and retry failures.

Signed uploads are documented valid two hours. Extend existing upload rows so five-minute finalize expiry, consumed cleanup and finally cannot erase capability/path evidence. Before deletion activation drain every old issuer/cleanup invocation, wait last old issuance+2h+validated in-flight/clock grace, then reconcile legacy untracked objects in dedicated pending bucket. Missing old rows cannot be recovered per user; require global legacy-drain evidence. For each new request wait tracked capability horizon and final exact-path removal; no COMPLETED before this. See research.md rollout sequence. Track public output created by in-flight finalize for compensation. Privacy copy describes CDN/browser/backups limitations.

Only after finances and cleanup, call existing Supabase HTTP Admin hard-delete path using server secret handling. External calls are outside DB transactions with persisted step intents and bounded timeout. Reconcile old UUID on uncertain response, recheck lease generation and all prerequisites, then mark COMPLETED. Re-registration after Auth deletion gets a new UUID even if acknowledgement write retries. Completed-request status is minimal, not a retained public profile.

### 5. Reward continuity and fresh onboarding

T015–T018. Derive trusted identity from confirmed authoritative email (lock/read consistently with Auth change), HMAC version/domain separate from JWT secret. Single identity row lock handles absent proof; saturated welcome paid count <=3 has no timeout during program lifetime, with minimal transactional dedupe evidence. Purpose-end erasure and annual necessity/rights review replace arbitrary 12-month expiry. Extend existing campaign tx with Daily family/day or once campaign-ID uniqueness, original idempotency keys, ledger and bonus_claims. Preserve amount/streak and other policies. Preserve global campaign max claims despite Auth cascades.

Before enforcement/deletion, backfill confirmed live accounts with private source-receipt dedupe; no historical email reconstruction. Missing HMAC/proof/confirmed email fails only protected claim. Key lifecycle preserves recognition of deleted identities; no arbitrary old-key retirement or rolling welcome reset. Daily proof expires only after day-end+reconciliation margin; once markers remain while campaign can reopen. Program/campaign termination purge and individual rights handling require R5 legal approval.

### 6. UI/legal, fundamental checks and authorized release gates

T019–T022. Expose UI only after all safety stages. Show warning, fresh proof, preparing/accepted/pending/waiting_storage_expiry/completed/incident correctly; potentially >2h storage wait is normal, requires no login/manual resume and is excluded from overdue incident detection. Not-before cleanup time is not an ETA. Show honest no-welcome/low-balance onboarding. Legal copy owner-reviewed. Run deterministic suites in [quickstart.md](quickstart.md); targeted manual Preview check covers presentation, not a new UI suite.

After separate GO: disposable Stage password+Google users; fault injection/restart, multi-table all-in, same-email recreation, 1/2/3/4 welcome and Daily/once proofs. WS Preview Deploy must use exact latest runtime-affecting SHA before E2E smoke; Netlify PR checks do not deploy WS. Production activation/migration/deployment separate GO, no self-merge, irreversible deletion has no rollback. Rollback means stop accepting new deletion while continuing safe recovery of accepted requests; never restore old UUID/assets or erase committed proofs.

## Review Focus and revised design gates

1. SQL/Redis are not a distributed transaction: durable suspension_preparing intent, Redis atomic Lua fence before accepted_at, delayed command/Redis restart tests in T005/T007/T012. Never clear an uncertain fence by compensating a lost SQL reply.
2. Lock hierarchy remains table/campaign → reward identity → sorted users → ledger. Acceptance takes no table/campaign locks; Redis network deadlines do not prove cancellation; all mutating Lua commands require an ACTIVE permit plus matching Redis recovery epoch, never missing-marker=ACTIVE. Private WS read-check followed by send is a TOCTOU: delivery authorization/send must serialize against acceptance via lifecycle lock (no await gap outside that lock), or prove equivalent ordering. Already transmitted bytes cannot be recalled.
3. All-in remains eligible through showdown/side-pot (both reducers and hole-card selection), then cash-out/BURN; R1 preserves both CHECKs/FK and historical identity/replay/retention without rewriting hashes (T009–T012).
4. Existing tick accepted. Max ten fetched requests, one bounded step/request, lease acquired only at step start, 15s elapsed work budget yielding between steps, per-step 120s lease with <=15s external deadlines/<=5s DB deadlines, no lease heartbeat framework. Remove ten-error cutoff; one incident after 30min overdue actionable progress, immediate financial inconsistency incident. Deliberate Storage/hand waits do not count. Durable no-table scan, unknown outcome reconciliation and service-outage fail-closed behavior in T011/T014.
5. Legacy signed URLs require tracked-path preservation plus global old-issuer quiescence/drain before deletion activation (T013/T014); no per-user reconstruction claim for rows already removed. Actual grace bound and dedicated-bucket scope require proof.
6. Global campaign quota is a monotonic successful-paid count initialized from known evidence and incremented only for new payout under campaign lock. Commit ledger + bonus_claims + identity proof/count + quota together; cascade/receipt pruning never decrements it (T017/T018). No third ledger or reward framework.
7. Privacy policy preserves three welcome payments without timeout and once markers while reopenable; legal/LIA/rights and recognition-key continuity remain R5 blocker. Supported API docs do not prove OTP request freshness/Google-only compatibility: R6 minimal Stage PoC is separately gated, not executed.

**R1–R8 after revision:** R1/R2/R3/R4/R7/R8 REQUIRED CHANGES (design clarified; future tests needed), R5 UNRESOLVED legal/policy sign-off, R6 UNRESOLVED security feasibility. No runtime PASS inferred from docs. Package ready for owner review; **not ready for unrestricted implementation GO** until R5 sign-off, R6 proof and legacy Storage rollout/grace evidence. Separate narrowly scoped PoC GO can resolve feasibility; no deployment/migration implied by it.


## Complexity Tracking

No constitution violations. Two focused shared modules and one proof helper are justified by Netlify/WS and cross-campaign reuse. Private durable DB rows are necessary for restart safety; reusing WS maintenance avoids a new worker. Six stages, 22 tasks; estimate 10–15 engineering days plus external review/authorized verification. Documentation and feasibility gates can be reviewed independently; partial public deletion cannot be released safely.
