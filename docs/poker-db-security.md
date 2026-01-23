# Poker database security

## Tables

### public.poker_state
- Readers: server-only (contains private deck state).
- Writers: server-only.
- Notes: Enforced by RLS (no client select policies; service role bypasses RLS). API responses must strip `deck` before returning state to clients.

### public.poker_hole_cards
- Readers: authenticated users (RLS allows only `auth.uid() = user_id`).
- Writers: server-only (service role from Netlify functions).
- Notes: clients never receive other players' hole cards or any mapping of hole cards by user.
