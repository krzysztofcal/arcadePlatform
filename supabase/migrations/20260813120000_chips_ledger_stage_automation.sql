begin;

alter table public.chips_ledger_archive_batches
  add column source_policy_id text;

alter table public.chips_ledger_archive_batches
  add constraint chips_ledger_archive_batches_source_policy_check
  check (
    source_policy_id is null
    or source_policy_id = 'stage-ledger-auto-retention-30d-v1'
  );

create index chips_ledger_archive_batches_stage_automation_idx
  on public.chips_ledger_archive_batches (project_ref, source_policy_id, status, pruned_at, created_at)
  where source_policy_id = 'stage-ledger-auto-retention-30d-v1';

create or replace function public.chips_guard_archive_source_policy_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.source_policy_id is distinct from old.source_policy_id then
    raise exception 'Archive source policy is immutable';
  end if;
  return new;
end;
$$;

create trigger chips_ledger_archive_source_policy_guard
before update on public.chips_ledger_archive_batches
for each row execute function public.chips_guard_archive_source_policy_mutations();

revoke all on function public.chips_guard_archive_source_policy_mutations()
  from public, anon, authenticated, service_role;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_attribute
     where attrelid = 'public.chips_ledger_archive_batches'::pg_catalog.regclass
       and attname = 'source_policy_id'
       and not attisdropped
  ) then
    raise exception 'Stage automation policy column is missing';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_trigger
     where tgrelid = 'public.chips_ledger_archive_batches'::pg_catalog.regclass
       and tgname = 'chips_ledger_archive_source_policy_guard'
       and not tgisinternal
  ) then
    raise exception 'Stage automation policy immutability trigger is missing';
  end if;

  if pg_catalog.has_function_privilege(
       'anon',
       'public.chips_guard_archive_source_policy_mutations()',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.chips_guard_archive_source_policy_mutations()',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.chips_guard_archive_source_policy_mutations()',
       'execute'
     ) then
    raise exception 'Stage automation policy guard is executable by an API role';
  end if;
end;
$$;

commit;
