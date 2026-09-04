begin;

-- PR #919 originally added this index, but Stage EXPLAIN/replay showed no
-- materialized improvement (replay still 57014 at the 120s bounded timeout).
-- Keep the schema drift ordered: the earlier migration stays in history because
-- it was already applied to the shared Stage DB by apply-stage; this migration
-- removes the index so the final schema does not retain an unjustified index.
drop index if exists public.chips_transaction_idempotency_candidate_selector_idx;

commit;
