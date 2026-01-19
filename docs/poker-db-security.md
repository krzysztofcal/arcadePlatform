# Poker DB Security Contract (Pre-Migration)

This document defines **current access expectations** for poker-related tables. It is a contract for future migrations and code review.

## Table access matrix

| Table | Allowed readers | Allowed writers | Notes |
| --- | --- | --- | --- |
| `public.poker_hole_cards` | **Server-only** (Netlify Functions using Supabase service role) | **Server-only** (Netlify Functions using Supabase service role) | Hole cards are private and must never be exposed to clients. |
| `public.poker_actions` | TBD (server-only for now) | Server-only | Action log is written by server handlers; client access is not defined yet. |
| `public.poker_seats` | TBD (server-only for now) | Server-only | Client access is not defined yet; server owns seat updates. |
| `public.poker_tables` | TBD (server-only for now) | Server-only | Client access is not defined yet; server owns table lifecycle. |
| `public.poker_state` | TBD (server-only for now) | Server-only | State updates are server-owned. |
| `public.poker_requests` | Server-only | Server-only | Idempotency ledger for handlers. |

### poker_hole_cards (non-negotiable)

- Hole cards are **server-only**.
- Clients must never query `public.poker_hole_cards` directly.
- Access must be via Netlify Functions using the Supabase **service role** key.

## Non-goals for now

- Spectator mode or read-only public tables.
- Client-side direct reads of any poker tables.
- Public APIs for poker history queries.

## How to verify later (SQL checks)

Run these SQL queries after applying migrations:

```sql
select relrowsecurity, relforcerowsecurity
from pg_class
where relname = 'poker_hole_cards';
```

```sql
select schemaname, tablename, policyname, roles, permissive, cmd
from pg_policies
where tablename = 'poker_hole_cards';
```

Expected results:
- `relrowsecurity = true` and `relforcerowsecurity = true` for `poker_hole_cards`.
- Either no policies for `poker_hole_cards` (service-role-only access), or explicit deny-by-default policies.
