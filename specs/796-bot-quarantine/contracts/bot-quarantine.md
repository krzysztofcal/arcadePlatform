# Contracts: NORMAL/SLOW admission and periodic tier pools with manual RESTRICTED

Historical filename retained for the PR link. This contract implements the requirements of [spec.md](../spec.md), sourced solely from the live #1018 snapshot including its manual RESTRICTED amendment. Local T001–T029 evidence remains historical; the final amendment requires T030–T036, a new exact-SHA WS gate and the pre-merge Stage acceptance T037.

## 1. Effective access and cache

Automatic=NORMAL/SLOW only; override=AUTO/FORCE_NORMAL/FORCE_SLOW/FORCE_RESTRICTED; effective=override result or durable automatic, therefore NORMAL/SLOW/RESTRICTED. FORCE_NORMAL and FORCE_RESTRICTED change only effective state. Threshold evidence still persists automatic NORMAL→SLOW under either override; no automatic path can set RESTRICTED, and durable automatic SLOW is never cleared or blocked. Return to AUTO immediately derives effective SLOW from persisted state, without waiting for another threshold check. FORCE_NORMAL/FORCE_RESTRICTED cannot reverse `is_slow_only`. UNKNOWN is a transient absence of trustworthy data, never a durable restriction.

Final JOIN reads authoritative wallet/policy/access in its existing transaction. Settled checks compare the existing authoritative settled human stacks against cached threshold; no wallet sum and no other-table reads. Fresh connected/still-seated snapshots are refreshed outside hands at ≤30s interval, max age 30s, monotonic revisions; failed refresh cannot renew freshness. JOIN/reconnect hydrates and confirmed local transitions update the cache. No per-hand policy/account/override/tier policy queries or unchanged-hand writes. An actual durable transition can lock/reconcile current access revision, preserving a concurrent override, and persist required marker changes. Effective RESTRICTED permits settlement, leave and cash-out but authorizes no new bot seed, replacement or managed top-up.

Admin override mutation is a single WS-owned operation (§25 of #1018): Admin UI → Netlify Admin auth → one internal WS request → WS fail-close → one DB transaction (`SELECT ... FOR UPDATE`, expectedRevision check, atomic row update, read policy, persist SLOW if applicable) → WS cache/socket update → release fail-close → exact ACK. Netlify authenticates the admin and forwards the actor ID with zero local DB write, zero pre-invalidation, zero confirmation retries, and zero recovery polling. WS owns the runtime guard (`activePokerAccessMutations`), short-lived fail-close lifecycle, single DB transaction, authoritative cache and socket broadcast. Stale expectedRevision returns 409 stale_revision with zero DB update; truly concurrent requests return 409 poker_access_mutation_in_progress. Guard and fail-close are cleaned up in finally. The 25s periodic refresh and 30s cache TTL are decoupled from Admin Save correctness.

## 2. Create / final JOIN / 4+4 contract

Shared user-scoped PostgreSQL transaction advisory key: stable derivation of `poker-table-slots:v1` + canonical UUID, identical in Create/fallback/JOIN. Acquire before any count-consuming table/state/account locks; Quick Seat order is user→existing match lock→table/state→ordered accounts. Count query starts after lock acquisition under READ COMMITTED. Both adapters use one helper; no app-only lock or counter. Active lookup requires a narrow user_id-leading poker_seats access path, pending lookup a created_by-leading poker_tables path, each matched to the final status/participation predicate. Stop after five qualifying distinct tables, use selective indexed table-specific EXISTS checks, and never scan global tables/seats per fresh JOIN/Create. T027 recorded the final query shape and local PostgreSQL EXPLAIN on the disposable fixture; an existing adequate index is reused only with that evidence, otherwise T002 adds the required narrow index.

Create: authenticate owner, count pending as defined in data-model (the four-table cap covers both ordinary and `is_slow_only` `STANDARD` tables), reject fifth before INSERT table/state/ESCROW. Existing STANDARD empty initialization only, no classifier/seed/MINT. Trusted managed null-owner creation remains a separate existing internal path; public callers cannot impersonate it.

JOIN: authenticate identity and existing ownership/membership, lock user then table/state, recognize financed rejoin first. Rejoin consumes no new slot and remains legal despite current class/limit. Fresh JOIN classifies wallet, checks distinct active count <4 and existing tier/capacity/progression rules before buy-in/bot funding. NORMAL→ordinary only. SLOW→SLOW-only, or own STANDARD safely promotable empty table (no human/bot seats, no prior bot funding, safe initial state, not terminal/retired). RESTRICTED→ordinary bot-free STANDARD only, with targetBotCount zero and no new bot buy-in; SLOW-only, bot-populated, funded-by-bot or CONTINUOUS_BOT targets are denied before buy-in. Another owner's or any prefunded/managed ordinary table is denied. Unknown history is not proof of empty/unfunded.

Accepted fresh promotion, seat/buy-in/state and human marker commit together. Denied JOIN may commit an actual automatic transition, but not promotion, new seat/funding/slot or `has_human_participant`; earlier true stays true. Existing seated effective SLOW may independently require sticky table marker even when a new candidate is denied. First accepted human JOIN removes the pending predicate and adds active participation atomically. Another user joining an owner's pending table decreases only owner's pending count; no second owner lock is needed. Leave/close release slots through existing transactions.

Neutral existing denial shape carries reasons `poker_access_incompatible`, `poker_access_unavailable`, `poker_active_table_limit`, `poker_pending_table_limit`; no other player's balance/override is disclosed. Never report a seat/create success after denial or unknown commit.

## 3. Settled transition / runtime authority

`runSettledRolloverCommand` uses the just-settled authoritative state before `prepareSettledHandRollover` can plan positive next-hand funds; `commitSettledHandRollover`/existing restore is only after persistence confirmation. Pure comparisons are bounded to this table's active humans. Actual NORMAL→SLOW/marker deltas go through `writeViaDb` under existing table/state and ordered account locks, reconciling access revision only when a change is needed. New automatic state and required marker commit atomically before permitting SLOW funding. A concurrent FORCE_NORMAL or FORCE_RESTRICTED keeps its effective state but must not cancel the automatic SLOW write. A new table marker follows effective SLOW, not automatic SLOW/RESTRICTED alone; earlier true is never reversed. Return to AUTO uses the persisted automatic state without another threshold comparison.

Known effective SLOW makes table sticky SLOW-only, including existing occupied CONTINUOUS_BOT; this is metadata/economic policy, not a new lifecycle. Effective RESTRICTED is human-only and does not create a table marker or new lifecycle. No kick or second settlement. Existing NORMAL/RESTRICTED financed participants can rejoin/finish/leave; new NORMAL cannot enter a SLOW-only table. New SLOW may enter a SLOW-only table subject to ordinary rules; there is no added all-seated-same-class requirement in the transitional case. Managed rotation must not transfer a SLOW player to fresh ordinary funded inventory, and a RESTRICTED human cannot receive new replacement/top-up funding. UNKNOWN never flips false→true and never blocks otherwise legal payout. Leave does not run a new threshold detector; it may persist already known SLOW marker under existing lock without a policy prerequisite for payout.

## 4. Exact funding / provenance

`getBotFundingSystemKeyForBuyIn` becomes explicitly tier+table-class aware and rejects missing/disabled policy or unprovisioned pair. Mapping is data-model §4, never arbitrary browser metadata. Ordinary CONTINUOUS_BOT initial seed selects exact NORMAL pool; a sticky SLOW-only occupied table selects exact SLOW pool. All positive seed/replacement/top-up callers use the same resolved policy, fresh enough under §1, table lock and current membership. Unknown member class fails closed, even if other members are known.

Only SYSTEM→ESCROW TABLE_BUY_IN in game runtime. No MINT in JOIN/seed/replacement/top-up, no cross-class/tier/TREASURY fallback. Existing source/hash/replay identity for TABLE_BUY_IN remains. Missing funds trigger safe no-funding restore/prepare/persist, generalized from current 500-only handling. Payout uses actual recorded source attribution, including legacy TREASURY; table marker or override never rewrites historical provenance.

## 5. Scheduled refill

One dispatch-only GitHub-hosted job, primary trigger VPS systemd every three hours. Only current DB UTC bucket `[00,03,06,09,12,15,18,21]` is eligible; derive start from trusted clock, not user input. After locks, recheck current bucket before posting; stale queued invocation rolls to current bucket or no-ops, never mints backlog. Bounded transaction timeout prevents a request waiting across buckets from using an old allowance.

For each enabled exact pool: policy FOR SHARE→pool advisory lock→stable ordered ledger account locks; fresh balance plus committed pool/bucket check across revisions. Balance >= threshold means no-op; balance < threshold and unused bucket posts one configured amount. Key is `poker-pool-refill:<exact-system-key>:<policy-revision>:<UTC-bucket>`, stable payload/hash including original amount. Existing postTransaction replay verifies original identity before new calculation. Same pool/bucket ledger uniqueness spans revisions; changing threshold/amount or disable/re-enable cannot grant a second refill after commit. Before any old-key retry, recover the committed result; never substitute new amount under old identity. No-op does not consume a refill; later eligible retry in the same bucket may perform its sole amount.

Extend ledger validation with a backend-only scheduled-pool capability: exactly GENESIS debit/exact mapped SYSTEM credit, balanced positive safe amount and typed purpose/tier/class/revision/bucket metadata, valid target/environment/policy. Public metadata alone cannot enable SYSTEM MINT. Reject arbitrary account, tableId linkage, malformed revision, unsafe integer, disabled/unprovisioned tier or unknown target. One pool operation is atomic; another independent pool may proceed after a failed pool transaction, with explicit per-pool results. Unknown commit requires registry/ledger recovery, not blind second issuance. Normal system ledger/audit history remains; no table-linked retention extension.

VPS contains only GitHub dispatch credential, repo/ref/environment configuration, no DB secret/SQL. Dedicated workflow uses workflow_dispatch only, validated actor/repo/ref and separate Stage/Production environment gates; dry-run/read-only is default. Fresh/rebuilt VPS only: bootstrap.sh may install reviewed new artifacts disabled; never run it on an existing live VPS. Existing hosts use a separate owner-approved targeted upgrade/install flow following infra/vps/README.md and docs/chips-ledger-stage-automation.md, with read-only inventory and rollback manifest before installation. Installation and activation are separate: no code deploy/install/bootstrap automatically enables or starts the new timer or dispatches a workflow.

The WS runtime gate (manual exact-runtime-SHA WS Preview Deploy, verified workflow success and targeted smoke) is independent of the Stage acceptance refill canary. The Stage-only canary performs real Stage ledger MINT only through the already registered `chips-ledger-stage-scheduled-automation.yml` owner-only `poker-bot-pool-refill-canary` mode, supporting both `NORMAL` and `SLOW` pool classes with optional `POKER_BOT_REFILL_BUY_IN` filtering (100 or 500 CH), and must use the exact reviewed PR SHA as dispatched `GITHUB_SHA`, checkout HEAD and worker reviewed ref. Pre-merge Stage acceptance and continuous inventory restoration (including NORMAL verification and T084 SLOW 100 CH restoration) have been executed on Stage. The standalone `poker-bot-pool-refill.yml` and `arcade-poker-refill-dispatch` remain the post-merge scheduler path with unchanged Production gates and both NORMAL/SLOW class evaluation. Production migration, Production refill, and VPS timer activation remain strictly unauthorized and not run; PR merge remains separately unauthorized.

## 6. Admin interfaces

Reuse `requireAdminUser`, normal error/JSON/klog patterns and external admin-page JS. Endpoints:

| Endpoint | Request / effect | Validation |
| --- | --- | --- |
| `admin-user-poker-access` | GET target user's automatic/override/effective/revision; POST userId, override, expectedRevision | Admin only; enum; target USER; stale revision rejected; row audit metadata, preserve automatic state |
| `admin-poker-policy` | GET singleton and explicit tiers/pool balances; POST scope=access with slow_threshold_ch, or scope=tier with buy_in/enabled/four threshold/amount fields; expectedRevision | Admin only; positive safe integers, provisioned pair before enabled, complete policy revision, authenticated actor/time |

Reuse existing Admin user detail/list/Ops summary read surfaces where already loaded; no duplicate polling/product. Do not expose other users' class/override in public lobby. Backend row revision/actor/time plus existing structured klog audit identify changes; no reuse of table-action audit for unrelated entities. Class changes affect future authority only; never force mid-hand eviction. Browser global JS only; new inline script if unavoidable requires CSP SHA.

## 7. Lobby / Quick Seat interfaces

Keep one shared live inventory `activeLobbyTablesById` and existing `lobby_snapshot` envelope; add boolean `slowOnly` per entry from committed runtime metadata. Publish only the authenticated user's effective class/revision/availability via a small self access message `poker_access` on connection/cache refresh/confirmed transition; no per-subscriber table filtering or DB joins. The repository's `poker/poker-ws-client.js` handles the frame (the issue wording calls this `poker-realtime.js`); `poker.js::canViewLobbyTable` filters/marks incompatible fresh targets while preserving own financed resume. Unknown self state shows neutral unavailable fresh admission; no guess of NORMAL.

DB `selectExistingActiveSeat` preference stays first. Fresh `selectCandidate/recommendSeatAtTable` add ordinary/SLOW-only predicate based on server-resolved class. `createAndRecommend` calls the same pending-limited empty Create helper; final SLOW owner JOIN may promote. Existing Quick Seat response shape remains; no authorization proof. Stale recommendation can fail final JOIN class/active cap. No #869 personalized offers or WS selection migration.

## 8. Manual RESTRICTED amendment

`FORCE_RESTRICTED` is accepted only by the existing Admin-authorized override mutation. The row keeps its automatic NORMAL/SLOW value, revision, `updated_at` and `updated_by`; `resolveEffectiveClass` derives RESTRICTED and WS/cache normalization carries that state. An unauthorized caller, stale revision or malformed override performs zero mutation.

Fresh RESTRICTED `executePokerJoinAuthoritative` checks the locked table, active authoritative seats and existing bot funding claims before posting the user's buy-in. It accepts only `STANDARD`, ordinary (`is_slow_only=false`) and bot-free targets; `targetBotCount=0`, no SYSTEM→ESCROW bot buy-in and no fallback to NORMAL/SLOW/TREASURY. Existing financed rejoin is recognized before this fresh filter and remains legal. Quick Seat uses the same ordinary/bot-free predicate after its existing rejoin-first path; Create remains an empty STANDARD fallback and final JOIN is authority.

The live WS lobby remains one `activeLobbyTablesById`/`lobby_snapshot` stream. Each entry may expose the already available `botCount` and lifecycle fact without a viewer-specific query. Browser filtering hides SLOW-only, bot-populated and CONTINUOUS_BOT fresh targets for RESTRICTED, while `rejoinableTableIds` remains an early legal resume path. `CONTINUOUS_BOT` stays NORMAL and never becomes a RESTRICTED lifecycle.

Settled rollover consults `settledAccessStatus` and the existing cache. If any seated human is effective RESTRICTED, settlement proceeds with `allowBotFunding=false`: no replacement, managed top-up or new seed is planned, and no mid-hand kick/escrow unwind occurs. Unknown cache uses the existing no-new-funding recovery. This adds no per-hand DB policy read and no runtime MINT.

The immutable `20260927100000_poker_bot_quarantine_policy.sql` is not edited. `20260927110000_poker_force_restricted.sql` is the sole forward-only schema extension and is recorded in the exhaustive Production manifest as `needs-production-equivalent`; automatic DB Stage Apply may move shared Stage from the current 98 applied baseline to 99. Production compatibility continues on the legacy path until separate migration/cutover GO.

## 9. Corrective pre-merge amendment — Settled rollover retry and Continuous Bot Table controlled inactivity (§26)

1. **Settled Bot Funding Decision**:
`decideSettledBotFunding({ snapshot, buyIn, isSlowOnly, tableMarkerTransition, lifecycleKind, effectiveRestricted, legacySystemKey, nowMs })` explicitly separates:
- **Unknown** (`missing_snapshot`, `expired_snapshot`, `unknown_tier_policy`): `{ known: false, allowed: false, systemKey: null, reason }`.
- **Authoritative No-Funding** (`restricted`, `tier_disabled`, `tier_unprovisioned`, `invalid_buy_in`): `{ known: true, allowed: false, systemKey: null, reason }`.
- **Allowed** (tier enabled + provisioned exact class/tier): `{ known: true, allowed: true, systemKey, poolClass, reason: "funding_allowed" }`.
`resolveSettledBotFundingSystemKey(options)` wraps `decideSettledBotFunding` returning `systemKey` if `allowed === true`, else `null`.

2. **Settled Rollover Retry Lifecycle**:
In `ws-server/server.mjs::runSettledRolloverCommand({ tableId, generationKey, attempt })`:
- When DB state is required (`hasSupabaseDbUrl && !isGuestTableId(tableId)`):
  - If `settledAccessStatus.known !== true` or `fundingDecision.known !== true`:
    - Do NOT advance state or call `prepareSettledHandRollover(allowBotFunding: false)`.
    - Preserve the same settled `generationKey`.
    - Schedule retry via existing `scheduleSettledRolloverRetry({ tableId, generationKey, attempt: attempt + 1 })`.
    - Return `{ ok: true, changed: false, retryable: true, reason }`.
  - If no-funding is authoritative (e.g. `effectiveRestricted`, `tier_disabled`, `tier_unprovisioned`):
    - `allowBotFunding = false`.
    - `prepareSettledHandRollover` evaluates players without bot funding. If `not_enough_players`, returns unchanged without retry.
- When DB state is not required (`!hasSupabaseDbUrl || isGuestTableId(tableId)`):
  - Treats access as known (`effectiveRestricted: false`), snapshot as `{ schemaBacked: false, expiresAtMs: Number.MAX_SAFE_INTEGER }`.
  - Rollover runs with legacy / economy-free rules without indefinite retry.

3. **Continuous Bot Table Controlled Inactivity**:
In `ws-server/poker/persistence/continuous-bot-table-repository.mjs`:
- In `reconcile()`: checks schema-backed tier 100 policy and provisioning before creating tables or seeding bots.
- If tier 100 is disabled or unprovisioned:
  - Supervisor enters controlled inactive state: `desiredCount = 0`, zero table creation, zero seed, graceful retirement of open continuous tables below minimum occupancy.
  - Returns `{ ok: true, controlledInactive: true, reason: "tier_disabled" | "tier_unprovisioned", status }`.
  - Does NOT churn, rollback or spam error logs every sweep.
- In `createManagedTable()`: defense-in-depth preflight throws `tier_disabled` / `tier_unprovisioned` before any table mutation.

## 10. Percentage-based hysteresis and reversible AUTO semantics (§26 / T059–T074)

1. **Reversible AUTO Classification**:
   - `AUTO / NORMAL` + evidence >= slow_threshold_ch -> automatic `SLOW`.
   - `AUTO / SLOW` + authoritative recovery evidence < derived slow_recovery_threshold_ch -> automatic `NORMAL`.
   - Hysteresis band `[recovery, entry)` preserves the current automatic class.
   - Any `FORCE_*` override suppresses durable automatic mutations; effective class follows the override while durable automatic class is preserved.
   - Return to AUTO re-evaluates the durable class using current authoritative evidence and thresholds.
2. **Derived Recovery Threshold**:
   - Stored in `poker_access_policy` as `slow_hysteresis_bps` (range 100–5000 bps, default 500 bps = 5%).
   - Derived integer formula: `slow_recovery_threshold_ch = floor((slow_threshold_ch * (10000 - slow_hysteresis_bps)) / 10000)`.
   - In Admin API, hysteresis is required on access policy PATCH (`slowHysteresisBps` or `slowHysteresisPercent`); missing hysteresis fails with 400 `invalid_slow_hysteresis_bps` rather than falling back to default.
3. **Depleted SLOW Pool Human Join Isolation**:
   - Empty or depleted bot bankroll does not block a valid human JOIN.
   - Bot funding attempts run in an isolated savepoint; bot funding failure (`insufficient_funds`) rolls back only the bot seat/funding, while the human JOIN commits successfully.

## 11. Production rollout preparation and continuous table restoration contract (§27 / T075–T084)

1. **Production P1 Contract (`20260929201500_poker_bot_quarantine_production_contract.sql`)**:
   - Single atomic transaction guarded by `chips.production_project_ref = 'otbqfijerkieoxwpxjnm'` and `pg_control_system().system_identifier = '7575202818581710058'`.
   - Requires E1 (`20260914090000`) and E2 (`20260914091000`) applied, and existing `POKER_BOT_BANKROLL` present.
   - Rejects drifted or partial #1018 schema.
   - Installs #1018 dark/off:
     - Preserves existing `POKER_BOT_BANKROLL` (1,000,490 CH) without modifying ID, balance, status or provenance.
     - Provisions missing pools `POKER_BOT_BANKROLL_100`, `POKER_BOT_SLOW_BANKROLL_100`, and `POKER_BOT_SLOW_BANKROLL_500` at balance 0.
     - Adds `chips_accounts` columns with `poker_auto_class='NORMAL'`, `poker_access_override='AUTO'`, `poker_access_revision=1`, and CHECK constraint accepting `FORCE_RESTRICTED`.
     - Adds `poker_tables.is_slow_only` with one-way sticky trigger.
     - Creates `poker_access_policy` singleton with conservative defaults `1,000,000,000 / 500 bps / 950,000,000` and revision 1.
     - Creates `poker_bot_tier_policy` with 100 and 500 tiers disabled (`enabled=false`, revision 1).
     - Installs indexes and enables RLS denying anon/authenticated.
     - Records only P1 in `supabase_migrations.schema_migrations`; the 4 Stage versions remain intentional gaps.
   - Produces zero financial transactions, entries, MINTs, or tables.
2. **Continuous Table Restoration Contract**:
   - Future Production deployment target is **2 tables** (never copy Stage/Preview 5).
   - Managed tables are always NORMAL-funded from `POKER_BOT_BANKROLL_100`.
   - `POKER_BOT_SLOW_BANKROLL_100` funds only SLOW STANDARD play and must never fund continuous tables.
   - Both 100 CH pools must be active and positive before enabling managed profile.
   - Stage pre-merge acceptance (T084) uses the owner-gated Stage refill canary for `SLOW / buy_in=100` (0 -> 2000 CH), then restores Stage `CONTINUOUS_BOT_DEFAULT` (desired 5, 3 bots each funded from `POKER_BOT_BANKROLL_100`).
