# Contracts: NORMAL/SLOW admission and periodic tier pools

Historical filename only. This contract implements the requirements of [spec.md](../spec.md), sourced solely from live #1018. No implementation exists in this PR.

## 1. Effective access and cache

Automatic=NORMAL/SLOW; override=AUTO/FORCE_NORMAL/FORCE_SLOW; effective=override result or durable automatic. FORCE_NORMAL suppresses new automatic promotion while active and preserves earlier SLOW for Return to AUTO. UNKNOWN is a transient absence of trustworthy data, never a durable restriction.

Final JOIN reads authoritative wallet/policy/access in its existing transaction. Settled checks compare the existing authoritative settled human stacks against cached threshold; no wallet sum and no other-table reads. Fresh connected/still-seated snapshots are refreshed outside hands at ≤30s interval, max age 30s, monotonic revisions; failed refresh cannot renew freshness. JOIN/reconnect hydrates and confirmed local transitions update the cache. No per-hand policy/account/override/tier policy queries or unchanged-hand writes. An actual durable transition can lock/reconcile current access revision, preserving a concurrent override, and persist required marker changes.

Admin response reports committed revision, `refreshIntervalSeconds=30`; clients must not mistake saved for immediate WS propagation. The next relevant point after refresh uses that revision; an expired cache cannot authorize new admission/funding. Settled comparisons and existing legal settlement continue; inability to establish a new classification cannot block payout. Refresh includes disconnected seated humans, batched bounded IDs only, with no platform account sweep.

## 2. Create / final JOIN / 4+4 contract

Shared user-scoped PostgreSQL transaction advisory key: stable derivation of `poker-table-slots:v1` + canonical UUID, identical in Create/fallback/JOIN. Acquire before any count-consuming table/state/account locks; Quick Seat order is user→existing match lock→table/state→ordered accounts. Count query starts after lock acquisition under READ COMMITTED. Both adapters use one helper; no app-only lock or counter.

Create: authenticate owner, count pending as defined in data-model, reject fifth before INSERT table/state/ESCROW. Existing STANDARD empty initialization only, no classifier/seed/MINT. Trusted managed null-owner creation remains a separate existing internal path; public callers cannot impersonate it.

JOIN: authenticate identity and existing ownership/membership, lock user then table/state, recognize financed rejoin first. Rejoin consumes no new slot and remains legal despite current class/limit. Fresh JOIN classifies wallet, checks distinct active count <4 and existing tier/capacity/progression rules before buy-in/bot funding. NORMAL→ordinary only. SLOW→SLOW-only, or own STANDARD safely promotable empty table (no human/bot seats, no prior bot funding, safe initial state, not terminal/retired). Another owner's or any prefunded/managed ordinary table is denied. Unknown history is not proof of empty/unfunded.

Accepted fresh promotion, seat/buy-in/state and human marker commit together. Denied JOIN may commit an actual automatic transition, but not promotion, new seat/funding/slot or `has_human_participant`; earlier true stays true. Existing seated effective SLOW may independently require sticky table marker even when a new candidate is denied. First accepted human JOIN removes the pending predicate and adds active participation atomically. Another user joining an owner's pending table decreases only owner's pending count; no second owner lock is needed. Leave/close release slots through existing transactions.

Neutral existing denial shape carries proposed reasons `poker_access_incompatible`, `poker_access_unavailable`, `poker_active_table_limit`, `poker_pending_table_limit`; no other player's balance/override is disclosed. Never report a seat/create success after denial or unknown commit.

## 3. Settled transition / runtime authority

`runSettledRolloverCommand` uses the just-settled authoritative state before `prepareSettledHandRollover` can plan positive next-hand funds; `commitSettledHandRollover`/existing restore is only after persistence confirmation. Pure comparisons are bounded to this table's active humans. Actual NORMAL→SLOW/marker deltas go through `writeViaDb` under existing table/state and ordered account locks, reconciling access revision only when a change is needed. New automatic state and required marker commit atomically before permitting SLOW funding. A concurrent FORCE_NORMAL can suppress effective promotion; earlier true is never reversed.

Known effective SLOW makes table sticky SLOW-only, including existing occupied CONTINUOUS_BOT; this is metadata/economic policy, not a new lifecycle. No kick or second settlement. Existing NORMAL financed participants can rejoin/finish/leave; new NORMAL cannot enter. New SLOW may enter a SLOW-only table subject to ordinary rules; there is no added all-seated-same-class requirement in the transitional case. Managed rotation must not transfer a SLOW player to fresh ordinary funded inventory. UNKNOWN never flips false→true and never blocks otherwise legal payout. Leave does not run a new threshold detector; it may persist already known SLOW marker under existing lock without a policy prerequisite for payout.

## 4. Exact funding / provenance

`getBotFundingSystemKeyForBuyIn` becomes explicitly tier+table-class aware and rejects missing/disabled policy or unprovisioned pair. Mapping is data-model §4, never arbitrary browser metadata. Ordinary CONTINUOUS_BOT initial seed selects exact NORMAL pool; a sticky SLOW-only occupied table selects exact SLOW pool. All positive seed/replacement/top-up callers use the same resolved policy, fresh enough under §1, table lock and current membership. Unknown member class fails closed, even if other members are known.

Only SYSTEM→ESCROW TABLE_BUY_IN in game runtime. No MINT in JOIN/seed/replacement/top-up, no cross-class/tier/TREASURY fallback. Existing source/hash/replay identity for TABLE_BUY_IN remains. Missing funds trigger safe no-funding restore/prepare/persist, generalized from current 500-only handling. Payout uses actual recorded source attribution, including legacy TREASURY; table marker or override never rewrites historical provenance.

## 5. Scheduled refill

One dispatch-only GitHub-hosted job, primary trigger VPS systemd every three hours. Only current DB UTC bucket `[00,03,06,09,12,15,18,21]` is eligible; derive start from trusted clock, not user input. After locks, recheck current bucket before posting; stale queued invocation rolls to current bucket or no-ops, never mints backlog. Bounded transaction timeout prevents a request waiting across buckets from using an old allowance.

For each enabled exact pool: policy FOR SHARE→pool advisory lock→stable ordered ledger account locks; fresh balance plus committed pool/bucket check across revisions. Balance >= threshold means no-op; balance < threshold and unused bucket posts one configured amount. Key is `poker-pool-refill:<exact-system-key>:<policy-revision>:<UTC-bucket>`, stable payload/hash including original amount. Existing postTransaction replay verifies original identity before new calculation. Same pool/bucket ledger uniqueness spans revisions; changing threshold/amount or disable/re-enable cannot grant a second refill after commit. Before any old-key retry, recover the committed result; never substitute new amount under old identity. No-op does not consume a refill; later eligible retry in the same bucket may perform its sole amount.

Extend ledger validation with a backend-only scheduled-pool capability: exactly GENESIS debit/exact mapped SYSTEM credit, balanced positive safe amount and typed purpose/tier/class/revision/bucket metadata, valid target/environment/policy. Public metadata alone cannot enable SYSTEM MINT. Reject arbitrary account, tableId linkage, malformed revision, unsafe integer, disabled/unprovisioned tier or unknown target. One pool operation is atomic; another independent pool may proceed after a failed pool transaction, with explicit per-pool results. Unknown commit requires registry/ledger recovery, not blind second issuance. Normal system ledger/audit history remains; no table-linked retention extension.

VPS contains only GitHub dispatch credential, repo/ref/environment configuration, no DB secret/SQL. Dedicated workflow uses workflow_dispatch only, validated actor/repo/ref and separate Stage/Production environment gates; dry-run/read-only is default. systemd install/activation is explicit future operation, not an automatic side effect of docs or bootstrap.

## 6. Admin interfaces

Reuse `requireAdminUser`, normal error/JSON/klog patterns and external admin-page JS. Proposed endpoints:

| Endpoint | Request / effect | Validation |
| --- | --- | --- |
| `admin-user-poker-access` | GET target user's automatic/override/effective/revision; POST userId, override, expectedRevision | Admin only; enum; target USER; stale revision rejected; row audit metadata, preserve automatic state |
| `admin-poker-policy` | GET singleton and explicit tiers/pool balances; POST scope=access with slow_threshold_ch, or scope=tier with buy_in/enabled/four threshold/amount fields; expectedRevision | Admin only; positive safe integers, provisioned pair before enabled, complete policy revision, authenticated actor/time |

Reuse existing Admin user detail/list/Ops summary read surfaces where already loaded; no duplicate polling/product. Do not expose other users' class/override in public lobby. Backend row revision/actor/time plus existing structured klog audit identify changes; no reuse of table-action audit for unrelated entities. Class changes affect future authority only; never force mid-hand eviction. Browser global JS only; new inline script if unavoidable requires CSP SHA.

## 7. Lobby / Quick Seat interfaces

Keep one shared live inventory `activeLobbyTablesById` and existing `lobby_snapshot` envelope; add boolean `slowOnly` per entry from committed runtime metadata. Publish only the authenticated user's effective class/revision/availability via a small self access message `poker_access` on connection/cache refresh/confirmed transition; no per-subscriber table filtering or DB joins. `poker-realtime.js` handles it; `poker.js::canViewLobbyTable` filters/marks incompatible fresh targets while preserving own financed resume. Unknown self state shows neutral unavailable fresh admission; no guess of NORMAL.

DB `selectExistingActiveSeat` preference stays first. Fresh `selectCandidate/recommendSeatAtTable` add ordinary/SLOW-only predicate based on server-resolved class. `createAndRecommend` calls the same pending-limited empty Create helper; final SLOW owner JOIN may promote. Existing Quick Seat response shape remains; no authorization proof. Stale recommendation can fail final JOIN class/active cap. No #869 personalized offers or WS selection migration.
