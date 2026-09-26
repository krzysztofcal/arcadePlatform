# Data Model: NORMAL/SLOW per-tier pools

Proposed schema only. No migration is part of this PR. [Spec](spec.md) and [contracts](contracts/bot-quarantine.md) define behavior. Use existing USER accounts, tables, seats, state and ledger; no new per-user budget or refill receipt entities.

## 1. Existing chips_accounts USER access fields

| Proposed field | Constraint / meaning |
| --- | --- |
| poker_auto_class | NOT NULL, NORMAL or SLOW, default NORMAL; automatic transition only NORMAL→SLOW |
| poker_access_override | NOT NULL, AUTO/FORCE_NORMAL/FORCE_SLOW, default AUTO |
| poker_access_revision | positive bigint, monotonic on actual access mutation |
| poker_auto_slow_at | nullable timestamp, set on first automatic transition only |
| poker_access_updated_at / poker_access_updated_by | timestamp and authenticated Admin UUID for manual changes; system transition identifies backend actor, never client-supplied authority |

Fields apply to USER rows; no client-write grants. Effective class is derived, not another stored enum. FORCE_NORMAL→NORMAL; FORCE_SLOW→SLOW; AUTO→automatic state. FORCE_NORMAL suppresses new automatic promotion while active; it never clears a previously durable SLOW. Admin writes only override and metadata, never overwrite automatic state. Automatic writes only transition field(s) with revision comparison/locked reconciliation so concurrent overrides survive.

## 2. poker_access_policy (new purpose-specific singleton)

`id=1` primary key/check; `slow_threshold_ch` positive safe-integer CH (1..9007199254740991), initially 1000000000; `revision` positive bigint initially 1, increases on successful change; `updated_at` non-null and `updated_by` authenticated Admin UUID (initial provisioning backend actor). No independent WS environment threshold override. No generic key/value settings API.

Cache representation: value+revision+loadedAt; user snapshots carry automatic/override/revision. Refresh interval and max age 30 seconds, outside settled-hand hot path; batch only connected/still-seated IDs. Unknown/expired values cannot authorize new admissions/funding. Actual transitions may perform needed persistence; unchanged settled hands add no classification DB access.

## 3. Existing poker_tables / participation

Add `is_slow_only boolean NOT NULL DEFAULT false`; backend-only false→true, never revert. Project to `tableMeta.isSlowOnly` and lobby `slowOnly`. Keep existing `STANDARD/CONTINUOUS_BOT`, owner/status/state and one-way `has_human_participant`.

- Active count: distinct nonterminal tables with current human seat/financed participation for user; include disconnected/pending-leave participation until existing leave/cash-out releases it. Rejoin does not insert a new membership/count.
- Pending count: owned OPEN STANDARD, never accepted human participation (`has_human_participant=false`), no human/bot seats, empty safe initial state, no bot funding history; no historical creation quota. Closed tables excluded.
- First accepted JOIN atomically creates active participation and sets human marker so pending predicate ceases to match. A denied JOIN leaves seat/buy-in/marker unchanged.
- SLOW owner promotion needs all pending safety proofs under table/state lock, no ledger/source history ambiguity and no managed lifecycle; it occurs with accepted fresh admission, not Create. Empty with past funding does not qualify.
- Both cap values are fixed V1 constants 4; no Admin tuning or stored counters. Shared `pg_advisory_xact_lock` key derives identically from `poker-table-slots:v1` and canonical user UUID. Hash collision can only serialize extra users, never skip validation. Acquire before count/decision/mutation; transaction release, never session locks. Existing owner/status and seat/user indexes should serve bounded EXISTS/count-to-five queries; add narrowly scoped index only if query review proves missing access path.

## 4. Tier bankrolls and poker_bot_tier_policy

| buy_in | NORMAL SYSTEM key | SLOW SYSTEM key |
| --- | --- | --- |
| 100 | POKER_BOT_BANKROLL_100 | POKER_BOT_SLOW_BANKROLL_100 |
| 500 | POKER_BOT_BANKROLL | POKER_BOT_SLOW_BANKROLL_500 |

Existing account IDs, balances and ledger provenance remain, including the 500 POKER_BOT_BANKROLL. Only new pool accounts start at zero; provisioning never resets an existing balance and does not MINT. New tiers need an explicit exact pair mapping and enabled policy before bots are allowed; `POKER_BUY_IN_TIERS_JSON` alone is insufficient. Do not auto-create/fallback a missing pool during runtime. If either mapped account is absent/invalid, new tier funding is unavailable.

New purpose-specific `poker_bot_tier_policy`: `buy_in` primary key positive safe integer; `enabled` boolean NOT NULL default false; `normal_refill_threshold_ch`, `normal_refill_amount_ch`, `slow_refill_threshold_ch`, `slow_refill_amount_ch` each positive safe-integer CH; `revision` positive monotonic bigint; `updated_at` non-null, `updated_by` authenticated operator identity. Disabled is the way to stop refills/funding, not invalid zero/negative amounts. All amounts and resulting balances must remain safe integers. Backend-only, RLS enabled on exposed public tables with no anon/authenticated policy or write grant.

Initial Stage tuning examples, not Production authorization:

| Tier | NORMAL threshold | NORMAL amount | SLOW threshold | SLOW amount |
| --- | --- | --- | --- | --- |
| 100 | 2000 | 5000 | 1000 | 2000 |
| 500 | 5000 | 10000 | 2000 | 5000 |

Policy enablement follows deliberate provisioning/cutover. Purpose-specific mapping owns account keys; public/Admin inputs cannot redirect a tier to arbitrary SYSTEM/TREASURY accounts. Admin controls thresholds, amounts and enabled status only, with optimistic revision check and actor/time metadata.

## 5. Existing ledger/idempotency for scheduled MINT

No new receipt table. Reuse `chips_transactions`, `chips_entries`, `chips_transaction_idempotency` and payload hash. Post one balanced MINT GENESIS→exact pool for one configured amount. Metadata includes `purpose=poker_pool_refill`, `bankrollSystemKey`, `buyIn`, `poolClass`, `policyRevision`, `bucket` (UTC start of current 3h interval). No tableId/funding key binding.

Identity: `poker-pool-refill:<bankrollSystemKey>:<policyRevision>:<bucket>`. Existing committed transactions supply an additional unique purpose-scoped pool+bucket guard across revisions (narrow partial expression index on existing transaction metadata). This supports indexed lookup and prevents a revision edit opening a second allowance. Validate required typed metadata before insertion so NULL cannot evade the guard. No reinterpretation of old transactions/manifests; normal system ledger/audit history remains, with no table-linked retention additions.

The scheduler locks policy FOR SHARE, then exact pool serialization, then necessary ledger accounts in stable ID order; Admin update uses policy FOR UPDATE. Same-bucket committed record wins regardless of new settings. Balance/eligibility read and MINT commit are one transaction; no-op creates no fake receipt. Only current bucket is eligible; a restarted old invocation cannot mint a missed bucket. Existing replay can return an old committed result but never create a historical operation. Check DB UTC bucket after acquiring locks, immediately before mutation, with bounded transaction timeout.

## 6. State changes and trust boundaries

Automatic NORMAL→SLOW is sticky; override may change freely among its three values. Table false→true is irreversible in V1, independent of override and lifecycle. Mixed financed participation is grandfathered; fresh compatibility and new funds follow sticky table class. UNKNOWN has no durable class value and cannot set table marker. It denies new finance/admission only.

Authoritative runtime state remains WS; DB seat/count facts enforce transactional capacity, not a competing poker simulation. Admin server auth and operational environment guards are mandatory. No schema/code is applied until separate implementation instruction and future Stage-effect declaration; Production is separate GO.
