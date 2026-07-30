-- Convert legacy double-serialized JSON scalar strings to native JSONB.
-- Guarded per-row with jsonb_typeof = 'string' for idempotency.
-- All four columns are updated in a single transaction so the migration
-- either completes atomically or rolls back entirely.

begin;

update public.poker_actions
   set meta = (meta #>> '{}')::jsonb
 where jsonb_typeof(meta) = 'string';

update public.poker_state
   set state = (state #>> '{}')::jsonb
 where jsonb_typeof(state) = 'string';

update public.poker_hole_cards
   set cards = (cards #>> '{}')::jsonb
 where jsonb_typeof(cards) = 'string';

update public.poker_requests
   set result_json = (result_json #>> '{}')::jsonb
 where jsonb_typeof(result_json) = 'string';

commit;
