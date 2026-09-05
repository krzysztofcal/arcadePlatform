begin;

create policy chips_stage_closed_human_table_retention_policy_pruner_select
  on public.chips_stage_closed_human_table_retention_policy
  as permissive
  for select
  to chips_ledger_archive_pruner
  using (policy_id = 'stage-ledger-closed-human-table-retention-30d-v1');

commit;
