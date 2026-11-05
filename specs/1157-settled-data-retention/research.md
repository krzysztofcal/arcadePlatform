# Research: settled user-linked data inventory (#1157)

**Baseline main**: `bce85654046d1848b5ae01be1cf0b03c74430380` · **Date**: 2026-11-05
**Method**: code, migrations and docs only. No Supabase, Storage, Redis or VPS reads were made by the agent; one owner-run `grep` of five non-secret WS keys is recorded below.

## Already bounded

| Data | Mechanism | Effective window |
|---|---|---|
| `poker_actions`, `poker_hole_cards` | `ws-server/poker/persistence/action-history-cleanup.mjs` | Production file `/etc/arcadeplatform/ws-server.env` (owner check 2026-11-05): bot action 6 h, bot settled 1 d, human action 1 d, human settled 7 d |
| CLOSED `poker_tables` (+ seats/state) | `ws-server/poker/persistence/closed-table-cleanup.mjs` | key absent from the Production file, code default `DEFAULT_CLOSED_TABLE_RETENTION_MS` = 7 d |
| `poker_requests` | no time-based cleanup (`netlify/functions/_shared/poker-idempotency.mjs` deletes single requests only); FK `references public.poker_tables (id) on delete cascade` (`20260117090000_poker_phase1_authoritative_seats.sql`) | bounded by table lifetime (CLOSED + 7 d); **unbounded for a table that stays OPEN > 12 months** (D6) |
| Bot-only ledger (SYSTEM↔ESCROW) and closed-human table ledger detail | #891 Production retention, `scripts/ops/chips-ledger-production-automation.mjs` | 7 d / 30 d hot, **then moved to private Storage archives** |
| XP day/week leaderboards (Redis) | `EXPIREAT` in `netlify/functions/_shared/xp-ledger.mjs` | period end |
| Profile, favorites, bonus claims/eligibility, avatars on account deletion | `ws-server/poker/runtime/account-deletion.mjs` | at deletion |

The file value is what systemd loads at the next start. It is not proof of the running process environment.

## Unbounded, user-linked (gaps)

| Data | User link | Current use | Source |
|---|---|---|---|
| Storage bucket `chips-ledger-archive`: `v1/sha256/*.jsonl.gz`, `recovery/v1/sha256/*.jsonl.gz`, `*.recovery.json.gz`, `account-recovery/v1/sha256/*.json.gz` | full transaction/entry rows incl. `user_id` | recovery evidence only; runtime never reads Storage | `scripts/ops/chips-ledger-archive-store.mjs` (`ARCHIVE_BUCKET`), `specs/004-production-retention/research.md` |
| `chips_transaction_idempotency` | `user_id`, keys embed user UUIDs (e.g. `poker:settlement:${tableId}:${handId}:${userId}`), `replay_transaction`/`replay_entries` jsonb; `archive_batch_id` points at pruned batches | replay/dedupe on key collision | `supabase/migrations/20260811170000_chips_transaction_idempotency_registry.sql`, `docs/issue-874-stage-2b3-ledger-idempotency-registry.md` |
| `poker_gift_purchases` | `buyer_user_id`, `recipient_user_id` | dedupe by `purchase_key`, per-table rate limit and per-seat counts while the table is live | `shared/poker-domain/gift-purchase.mjs` |
| `account_deletion_requests` | `old_user_id` (unique), `progress` jsonb | tombstone fence: `account_is_active()`, `netlify/functions/_shared/store-upstash.mjs` alias checks, ledger burn | `20261018184941_account_self_deletion_v2.sql` |
| Retired `chips_accounts` (`retired_user_id`) + `chips_account_snapshot` | retired UUID | tombstone fence in `store-upstash.mjs`; balance evidence | `20251218230000_chips_ledger_fixups.sql` |
| Hot USER ledger rows outside closed-human-30d (bonuses, welcome, deletion burn, gift payments, other USER transactions) | `chips_transactions.user_id`, USER `chips_entries` | define `entry_seq`/balance of live accounts | `20260812100000_chips_ledger_archive_pruning.sql` (prunable selector requires zero USER entries) |

## Not user-linked (out of scope)

`account_deletion_release` (single control row), `chips_production_human_lifecycle_receipts` (batch, table, hashes), `chips_ledger_archive_batches` (counts, hashes, timestamps; `account_retirement_account_ids_sha256` is a set hash), retention policy/control tables. `private.account_reward_*` were dropped by `20261020190000_account_bonus_uuid_policy.sql`.

## Outside the codebase

Supabase backups/PITR, VPS journald, Netlify function logs, GitHub Actions logs/artifacts. These are documented as provider limits in Privacy/Data safety; no implementation.

## Egress constraints (agents.md "Supabase egress")

Archive objects are already read by the store/prune verification (`STORAGE_GET_*`). Expiry must not download objects. Selection uses `chips_ledger_archive_batches` metadata in SQL; deletion uses Storage object DELETE by exact path; SQL cleanup returns counts only and is bounded per run.
