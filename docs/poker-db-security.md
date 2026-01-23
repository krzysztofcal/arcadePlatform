# Poker database security

## Tables

### public.poker_state
- Readers: server-only (contains private deck state).
- Writers: server-only.
- Notes: Enforced by RLS + revoked client grants (no SELECT/INSERT/UPDATE/DELETE for anon/authenticated, and any policies are dropped by migration). API responses must strip `deck` before returning state to clients.

### public.poker_hole_cards
- Readers: server-only (Netlify Functions using service role; clients receive myHoleCards only via API).
- Writers: server-only (Netlify Functions using service role).
- Notes: direct client grants revoked for anon/authenticated; no direct client SELECT/INSERT/UPDATE/DELETE.
- Notes: hole cards for a hand are deleted when phase transitions to HAND_DONE.

## API notes
- poker-get-table is public; private fields are stripped from state, and myHoleCards are only returned for authenticated, seated ACTIVE users via server lookup.
