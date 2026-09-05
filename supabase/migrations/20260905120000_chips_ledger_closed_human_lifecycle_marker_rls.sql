begin;

-- The completion function is owned by the archive pruner.  Keep its UPDATE
-- path separate from the bot-only marker policy and require the same session
-- latch that the immutable human-marker trigger checks.
create policy chips_archive_pruner_human_retention_marker_update
  on public.poker_tables
  as permissive
  for update
  to chips_ledger_archive_pruner
  using (
    has_human_participant is true
    and human_retention_complete_at is null
    and coalesce(pg_catalog.current_setting('chips.closed_human_lifecycle', true), '') = '1'
  )
  with check (
    has_human_participant is true
    and human_retention_complete_at is not null
    and coalesce(pg_catalog.current_setting('chips.closed_human_lifecycle', true), '') = '1'
  );

commit;
