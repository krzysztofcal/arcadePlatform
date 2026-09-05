begin;

-- The canonical Stage workflow connects as postgres.  Keep the function
-- SECURITY DEFINER owner as the archive pruner and grant only invocation ACL
-- to the workflow caller; no table or API-role privileges are added.
grant execute on function public.chips_complete_closed_human_table_retention(uuid, timestamptz)
  to postgres;

do $check$
declare
  function_owner text;
  is_security_definer boolean;
begin
  select pg_catalog.pg_get_userbyid(proowner), prosecdef
    into function_owner, is_security_definer
    from pg_catalog.pg_proc
   where oid = 'public.chips_complete_closed_human_table_retention(uuid,timestamptz)'::pg_catalog.regprocedure;

  if function_owner is distinct from 'chips_ledger_archive_pruner'
     or is_security_definer is not true then
    raise exception 'Closed-human lifecycle completion must remain SECURITY DEFINER owned by chips_ledger_archive_pruner';
  end if;

  if not pg_catalog.has_function_privilege(
       'postgres',
       'public.chips_complete_closed_human_table_retention(uuid,timestamptz)',
       'execute'
     ) then
    raise exception 'Canonical Stage workflow caller is missing lifecycle completion EXECUTE';
  end if;

  if pg_catalog.has_function_privilege(
       'anon',
       'public.chips_complete_closed_human_table_retention(uuid,timestamptz)',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.chips_complete_closed_human_table_retention(uuid,timestamptz)',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'public.chips_complete_closed_human_table_retention(uuid,timestamptz)',
       'execute'
     ) then
    raise exception 'Closed-human lifecycle completion must not be executable by an API role';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc functions
      cross join lateral pg_catalog.aclexplode(
        coalesce(functions.proacl, pg_catalog.acldefault('f', functions.proowner))
      ) privileges
     where functions.oid = 'public.chips_complete_closed_human_table_retention(uuid,timestamptz)'::pg_catalog.regprocedure
       and privileges.grantee = 0
       and privileges.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Closed-human lifecycle completion must not be executable by PUBLIC';
  end if;
end;
$check$;

commit;
