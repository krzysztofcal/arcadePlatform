begin;

revoke all on function public.chips_assert_archive_prune_stage()
  from public, anon, authenticated, service_role;
grant execute on function public.chips_assert_archive_prune_stage()
  to chips_ledger_archive_pruner;

grant chips_ledger_archive_pruner to postgres;
set role chips_ledger_archive_pruner;

revoke all on function public.chips_archive_uuid_ids_sha256(uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.chips_archive_bigint_ids_sha256(bigint[])
  from public, anon, authenticated, service_role;
revoke all on function public.chips_register_archive_id_proof(
  text, uuid[], bigint[], text, integer, timestamptz, timestamptz, uuid,
  timestamptz, uuid, timestamptz, timestamptz, jsonb, bigint, bigint,
  text, text, numeric, numeric, numeric
) from public, anon, authenticated, service_role;
revoke all on function public.chips_prune_committed_archive_batch(text, uuid[], bigint[], boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.chips_archive_uuid_ids_sha256(uuid[]) to postgres;
grant execute on function public.chips_archive_bigint_ids_sha256(bigint[]) to postgres;
grant execute on function public.chips_register_archive_id_proof(
  text, uuid[], bigint[], text, integer, timestamptz, timestamptz, uuid,
  timestamptz, uuid, timestamptz, timestamptz, jsonb, bigint, bigint,
  text, text, numeric, numeric, numeric
) to postgres;
grant execute on function public.chips_prune_committed_archive_batch(text, uuid[], bigint[], boolean)
  to postgres;

reset role;
revoke chips_ledger_archive_pruner from postgres;

do $$
begin
  if pg_catalog.has_function_privilege(
       'anon',
       'public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean)',
       'execute'
     )
    or pg_catalog.has_function_privilege(
       'authenticated',
       'public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean)',
       'execute'
     )
    or pg_catalog.has_function_privilege(
       'service_role',
       'public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean)',
       'execute'
     )
    or pg_catalog.has_function_privilege(
       'anon',
       'public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric)',
       'execute'
     )
    or pg_catalog.has_function_privilege(
       'authenticated',
       'public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric)',
       'execute'
     )
    or pg_catalog.has_function_privilege(
       'service_role',
       'public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric)',
       'execute'
     ) then
    raise exception 'Archive proof or prune function remains executable by an API role';
  end if;

  if not pg_catalog.has_function_privilege(
       'postgres',
       'public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean)',
       'execute'
     )
    or not pg_catalog.has_function_privilege(
       'postgres',
       'public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric)',
       'execute'
     )
    or not pg_catalog.has_function_privilege(
       'chips_ledger_archive_pruner',
       'public.chips_assert_archive_prune_stage()',
       'execute'
     ) then
    raise exception 'Archive proof or prune function is missing its required executor';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_auth_members memberships
      join pg_catalog.pg_roles granted_role on granted_role.oid = memberships.roleid
      join pg_catalog.pg_roles member_role on member_role.oid = memberships.member
      join pg_catalog.pg_roles grantor_role on grantor_role.oid = memberships.grantor
      where granted_role.rolname = 'chips_ledger_archive_pruner'
        and not (
          member_role.rolname = 'postgres'
          and grantor_role.rolname = 'supabase_admin'
          and memberships.admin_option
          and not memberships.inherit_option
          and not memberships.set_option
        )
  ) then
    raise exception 'Unsafe archive pruner membership remains';
  end if;
end;
$$;

commit;
