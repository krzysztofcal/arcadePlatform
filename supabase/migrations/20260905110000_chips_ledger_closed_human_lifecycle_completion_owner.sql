begin;

-- The existing completion function is SECURITY DEFINER and its immutable
-- TABLE marker trigger requires the archive-pruner effective user.  Transfer
-- only this function's ownership so the existing body can be called safely;
-- no function body, marker state, or policy state is changed here.
do $check$
begin
  if not exists (
    select 1
      from pg_catalog.pg_roles
     where rolname = 'chips_ledger_archive_pruner'
  ) then
    raise exception 'chips_ledger_archive_pruner role is required for lifecycle completion';
  end if;
  if pg_catalog.to_regprocedure(
       'public.chips_complete_closed_human_table_retention(uuid,timestamptz)'
     ) is null then
    raise exception 'existing closed-human lifecycle completion function is required';
  end if;
end;
$check$;

grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
grant update (human_retention_complete_at) on public.poker_tables to chips_ledger_archive_pruner;
alter function public.chips_complete_closed_human_table_retention(uuid, timestamptz)
  owner to chips_ledger_archive_pruner;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

commit;
