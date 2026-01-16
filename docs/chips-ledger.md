# Chips Ledger — Architecture & Invariants

## Purpose

The Chips Ledger is the **authoritative accounting system** for virtual chips used across the Arcade Platform and future sub-domains (e.g. poker.kcswh.pl).

Chips represent a **virtual currency** that:
- can be earned via gameplay or rewards,
- can be purchased with real money (future),
- can be spent, burned, or redistributed,
- must be auditable, non-cheatable, and consistent.

All chip balances are persisted in **Supabase Postgres** using a strict ledger model.

---

## Core Design Principles

1. **Ledger, not counters**  
   Balances are derived from immutable entries, not updated directly.

2. **Append-only**  
   Ledger rows are never updated or deleted. Corrections are done via compensating entries.

3. **Double-entry accounting**  
   Every transaction must balance to zero (Σ entries = 0).

4. **Server-authoritative**  
   Only backend services (Netlify Functions using service role) may write.

5. **Idempotent writes**  
   Retried requests must not duplicate chip movements.

---

## Schema Overview

### `chips_accounts`
Represents **who owns chips**.

Each account has:
- an owner (USER or SYSTEM),
- a balance (maintained automatically),
- a strictly increasing per-account entry sequence.

Account types:
- `USER` — one per authenticated user
- `SYSTEM` — platform accounts (e.g. HOUSE, TREASURY)
- `ESCROW` — temporary holding (e.g. tables, tournaments)

Key invariants:
- USER accounts must never have a negative balance
- SYSTEM accounts are identified by a unique `system_key`
- Balances are updated only via ledger entries

---

### `chips_transactions`
Represents the **intent** of a chips operation.

A transaction groups multiple ledger entries into a single atomic action
(e.g. buy-in, payout, rake, mint).

Contains:
- `idempotency_key` — prevents duplicate execution
- `tx_type` — semantic classification (MINT, BURN, BUY_IN, etc.)
- metadata for auditing and debugging

A transaction **by itself does not move chips**.

---

### `chips_entries`
Represents **actual balance changes**.

Each row:
- affects exactly one account,
- has a signed `amount` (positive or negative),
- belongs to a transaction,
- is assigned a per-account monotonic `entry_seq`.

Hard rules:
- entries are append-only
- entries within a transaction must sum to zero
- account balances are updated automatically on INSERT only

This table is the **source of truth**.

---

### `chips_account_snapshot`
Stores the **latest known balance per account**.

Purpose:
- optional optimization for fast reads,
- avoids recalculating balances from all entries.

This table:
- has at most one row per account,
- may be rebuilt from ledger data if needed,
- does not replace the ledger as the source of truth.

---

## Critical Invariants (DO NOT VIOLATE)

These rules are enforced at the database level and must be preserved by all future code:

- Ledger tables are **append-only**
- `UPDATE` / `DELETE` on ledger rows is forbidden
- Every transaction must be **balanced**
- USER balances must never go below zero
- SYSTEM accounts must be unique (`system_key`)
- Idempotency keys must be unique per transaction
- Corrections are done via **new transactions**, never edits

Breaking any of these invalidates the accounting model.

---

## Backend Usage Rules

- Only Netlify Functions using the **Supabase service role** may write
- Clients must never write directly to ledger tables
- All chip movements must be executed as:
  1. create transaction
  2. insert balanced entries
  3. commit atomically

Future read access may be exposed via:
- views
- RPC functions
- limited RLS policies

---

## What Is Intentionally Not Implemented (Yet)

This is a **foundation layer only**.

Not included at this stage:
- client UI for chips
- payments / billing
- poker integration
- XP → chips conversion
- public RLS read policies
- reporting dashboards

These will be built on top of this ledger.

---

## Mental Model (Summary)

> Chips are money.
> Money is never edited.
> Money only moves via balanced, auditable transactions.

If you keep this mental model, the system will stay correct.

---

## Initial funding required

- The treasury must hold chips before any `BUY_IN` can succeed.
- Migration `supabase/migrations/20251221000000_chips_seed_treasury_genesis.sql` seeds **1,000,000** chips via a normal, balanced ledger transaction (`MINT` from `SYSTEM/GENESIS` to `SYSTEM/TREASURY`) keyed by `seed:treasury:v1`.
- The seed uses the same guarded posting shape as runtime transactions (no direct balance edits) and is safe to re-run thanks to the fixed idempotency key. Apply migrations normally (e.g. `supabase db push` or `psql "$SUPABASE_DB_URL" -f supabase/migrations/20251221000000_chips_seed_treasury_genesis.sql`).
- Verify the seed by checking that `SYSTEM/TREASURY` has a positive balance and the ledger contains a single transaction with idempotency key `seed:treasury:v1`. Without this migration, `BUY_IN` calls return `400 { "error": "insufficient_funds" }` because the treasury balance is zero.

---

## Netlify production configuration (required)

Use the Supabase **Transaction pooler (IPv4) connection string** (port **6543**, includes pooling) with `?sslmode=require`, then redeploy:

```
netlify env:set SUPABASE_DB_URL "postgresql://<user>:<pass>@<host>:6543/<db>?sslmode=require" --context production
netlify env:set CHIPS_ENABLED "1" --context production
netlify deploy --prod
```

Connection string source: Supabase Dashboard → Settings → Database → Connection string → **Transaction pooler** → URI (IPv4-compatible). Keep existing Supabase auth env vars (`SUPABASE_URL`, `SUPABASE_ANON_KEY`/`SUPABASE_ANON_KEY_V2`, `SUPABASE_JWT_SECRET`/`SUPABASE_JWT_SECRET_V2`). Netlify builds do **not** hot-reload env vars, so a redeploy is required after any env change.

> Note: JWT verification now uses local signature validation with `SUPABASE_JWT_SECRET`. Missing secrets will cause auth to fail, so ensure the Netlify env is populated for each deploy context.

### Verification after deploy

Check production env values (redeploy only if env vars changed):

```
netlify env:list --context production
# If you updated env vars, redeploy the site so functions see the new values:
netlify deploy --prod
```

Sanity checks (after redeploy):
- Missing token should return `401` with reason `missing_token`.
- If `SUPABASE_DB_URL` is not set, function logs will show `chips_sql_config_missing`.
- SQL or connectivity issues surface as `chips_sql_error` logs with Postgres fields (code/constraint/table/etc.).
