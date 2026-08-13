begin;

-- The identity pair is checked inside the privileged database path.  The
-- Production cap is intentionally independent of the CLI cap.
create or replace function public.chips_assert_archive_prune_target(
  p_project_ref text,
  p_transaction_count bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  system_identifier text;
  max_batch_size bigint;
begin
  select control.system_identifier::text
    into system_identifier
    from pg_catalog.pg_control_system() as control;

  if system_identifier = '7656985631720456337'
     and p_project_ref = 'krydukthwdvccggbyjfw' then
    max_batch_size := 5000;
  elsif system_identifier = '7575202818581710058'
        and p_project_ref = 'otbqfijerkieoxwpxjnm' then
    max_batch_size := 2;
  else
    raise exception 'Ledger archive pruning requires a canonical project ref/system identifier pair';
  end if;

  if p_transaction_count is null
     or p_transaction_count < 1
     or p_transaction_count > max_batch_size then
    raise exception 'Ledger archive pruning target allows at most % transactions', max_batch_size;
  end if;

  return system_identifier;
end;
$$;

alter function public.chips_assert_archive_prune_target(text, bigint) owner to postgres;
revoke all on function public.chips_assert_archive_prune_target(text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.chips_assert_archive_prune_target(text, bigint)
  to chips_ledger_archive_pruner;

-- Keep the old gate and its ACL for the internal implementation, but reject
-- every unknown server identity.  The project-ref pair is checked by the
-- target gate before proof/prune entry points are allowed to continue.
create or replace function public.chips_assert_archive_prune_stage()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  system_identifier text;
begin
  select control.system_identifier::text
    into system_identifier
    from pg_catalog.pg_control_system() as control;
  if system_identifier not in ('7656985631720456337', '7575202818581710058') then
    raise exception 'Ledger archive pruning is restricted to a canonical database identity';
  end if;
  return system_identifier;
end;
$$;

-- Function replacement is owner-sensitive on hosted Postgres.  Temporarily
-- delegate the migration session to the existing pruner owner, then remove
-- the schema capability and temporary role grant before the transaction can
-- commit.  A pre-existing managed non-inheriting membership is preserved.
grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

-- Patch the existing SECURITY DEFINER proof implementation in place so its
-- owner, strictness, search_path, ACL, and immutable state machine remain
-- unchanged while its identity check becomes target-aware.
do $$
declare
  definition text;
  patched text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric)'::pg_catalog.regprocedure
  ) into definition;
  patched := replace(
    definition,
    'perform public.chips_assert_archive_prune_stage();',
    'perform public.chips_assert_archive_prune_target(p_project_ref, pg_catalog.cardinality(p_transaction_ids));'
  );
  patched := replace(patched, 'batch.project_ref <> ''krydukthwdvccggbyjfw''', 'batch.project_ref <> p_project_ref');
  patched := replace(patched, 'Archive manifest is not committed canonical Stage evidence', 'Archive manifest is not committed target evidence');
  if patched = definition
     or pg_catalog.strpos(patched, 'batch.project_ref <> p_project_ref') = 0
     or pg_catalog.strpos(patched, 'chips_assert_archive_prune_target(p_project_ref') = 0 then
    raise exception 'Archive proof function shape changed; refusing an implicit migration';
  end if;
  execute patched;
end;
$$;

-- Apply the same target check after the committed manifest is locked.  The
-- existing implementation is kept byte-for-byte by pg_get_functiondef except
-- for the canonical project gate and the independent Production count cap.
do $$
declare
  definition text;
  patched text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)'::pg_catalog.regprocedure
  ) into definition;
  patched := replace(
    definition,
    'batch.project_ref <> ''krydukthwdvccggbyjfw''',
    'batch.project_ref not in (''krydukthwdvccggbyjfw'', ''otbqfijerkieoxwpxjnm'')'
  );
  patched := replace(patched, 'Archive manifest is not committed canonical Stage evidence', 'Archive manifest is not committed canonical target evidence');
  patched := replace(
    patched,
    '  if batch.archive_proof_verified_at is null then',
    '  perform public.chips_assert_archive_prune_target(batch.project_ref, transaction_count)'
      || pg_catalog.chr(59) || pg_catalog.chr(10)
      || '  if batch.archive_proof_verified_at is null then'
  );
  if patched = definition
     or pg_catalog.strpos(patched, 'batch.project_ref not in (''krydukthwdvccggbyjfw'', ''otbqfijerkieoxwpxjnm'')') = 0
     or pg_catalog.strpos(patched, 'chips_assert_archive_prune_target(batch.project_ref') = 0 then
    raise exception 'Archive prune function shape changed; refusing an implicit migration';
  end if;
  execute patched;
end;
$$;

-- The wrapper is the only callable destructive entry point.  It locks and
-- validates the manifest target before delegating to the unchanged internal
-- state machine, so a mixed pair or a three-transaction Production request is
-- rejected before any ledger mutation.
create or replace function public.chips_prune_committed_archive_batch(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_execute boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_project_ref text;
begin
  if p_execute is null then
    raise exception 'Ledger archive pruning execute flag must not be NULL';
  end if;

  select batches.project_ref
    into target_project_ref
    from public.chips_ledger_archive_batches as batches
    where batches.object_path = p_object_path
    for update;
  if not found then
    raise exception 'Committed archive manifest was not found';
  end if;

  perform public.chips_assert_archive_prune_target(
    target_project_ref,
    pg_catalog.cardinality(p_transaction_ids)
  );

  return public.chips_prune_committed_archive_batch_internal(
    p_object_path,
    p_transaction_ids,
    p_entry_ids,
    p_execute is true
  );
end;
$$;

-- Reapply the function ACL while the pruner is the owner.  The internal
-- implementation must not be explicitly executable by postgres; only the
-- proof and public prune entry points receive that grant.
revoke all on function public.chips_register_archive_id_proof(
  text, uuid[], bigint[], text, integer, timestamptz, timestamptz, uuid,
  timestamptz, uuid, timestamptz, timestamptz, jsonb, bigint, bigint,
  text, text, numeric, numeric, numeric
) from public, anon, authenticated, service_role;
grant execute on function public.chips_register_archive_id_proof(
  text, uuid[], bigint[], text, integer, timestamptz, timestamptz, uuid,
  timestamptz, uuid, timestamptz, timestamptz, jsonb, bigint, bigint,
  text, text, numeric, numeric, numeric
) to postgres;

revoke all on function public.chips_prune_committed_archive_batch_internal(
  text, uuid[], bigint[], boolean
) from public, anon, authenticated, service_role, postgres;

revoke all on function public.chips_prune_committed_archive_batch(
  text, uuid[], bigint[], boolean
) from public, anon, authenticated, service_role;
grant execute on function public.chips_prune_committed_archive_batch(
  text, uuid[], bigint[], boolean
) to postgres;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

revoke all on function public.chips_assert_archive_prune_stage()
  from public, anon, authenticated, service_role;
grant execute on function public.chips_assert_archive_prune_stage()
  to chips_ledger_archive_pruner;

do $$
declare
  function_owner text;
begin
  select pg_catalog.pg_get_userbyid(proowner)
    into function_owner
    from pg_catalog.pg_proc
   where oid = 'public.chips_assert_archive_prune_target(text,bigint)'::pg_catalog.regprocedure;
  if function_owner <> 'postgres' then
    raise exception 'Archive target gate owner must remain postgres';
  end if;

  select pg_catalog.pg_get_userbyid(proowner)
    into function_owner
    from pg_catalog.pg_proc
   where oid = 'public.chips_assert_archive_prune_stage()'::pg_catalog.regprocedure;
  if function_owner <> 'postgres' then
    raise exception 'Archive stage gate owner must remain postgres';
  end if;

  select pg_catalog.pg_get_userbyid(proowner)
    into function_owner
    from pg_catalog.pg_proc
   where oid = 'public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric)'::pg_catalog.regprocedure;
  if function_owner <> 'chips_ledger_archive_pruner' then
    raise exception 'Archive proof function owner must remain chips_ledger_archive_pruner';
  end if;

  select pg_catalog.pg_get_userbyid(proowner)
    into function_owner
    from pg_catalog.pg_proc
   where oid = 'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)'::pg_catalog.regprocedure;
  if function_owner <> 'chips_ledger_archive_pruner' then
    raise exception 'Internal archive prune function owner must remain chips_ledger_archive_pruner';
  end if;

  select pg_catalog.pg_get_userbyid(proowner)
    into function_owner
    from pg_catalog.pg_proc
   where oid = 'public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean)'::pg_catalog.regprocedure;
  if function_owner <> 'chips_ledger_archive_pruner' then
    raise exception 'Archive prune wrapper owner must remain chips_ledger_archive_pruner';
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
    raise exception 'Temporary archive pruner role membership must not remain after migration';
  end if;

  if pg_catalog.has_schema_privilege('chips_ledger_archive_pruner', 'public', 'create') then
    raise exception 'Archive pruner schema CREATE must not remain after migration';
  end if;

  if pg_catalog.has_function_privilege(
       'anon',
       'public.chips_assert_archive_prune_stage()',
       'execute'
     )
    or pg_catalog.has_function_privilege(
       'authenticated',
       'public.chips_assert_archive_prune_stage()',
       'execute'
     )
    or pg_catalog.has_function_privilege(
       'service_role',
       'public.chips_assert_archive_prune_stage()',
       'execute'
     )
    or pg_catalog.has_function_privilege(
       'anon',
       'public.chips_assert_archive_prune_target(text,bigint)',
       'execute'
     )
    or pg_catalog.has_function_privilege(
       'authenticated',
       'public.chips_assert_archive_prune_target(text,bigint)',
       'execute'
     )
    or pg_catalog.has_function_privilege(
       'service_role',
       'public.chips_assert_archive_prune_target(text,bigint)',
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
     )
    or pg_catalog.has_function_privilege(
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
       'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)',
       'execute'
     )
    or pg_catalog.has_function_privilege(
       'authenticated',
       'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)',
       'execute'
     )
    or pg_catalog.has_function_privilege(
       'service_role',
       'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)',
       'execute'
     ) then
    raise exception 'Archive proof or prune functions remain executable by an API role';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_proc procedures
      cross join lateral pg_catalog.aclexplode(
        coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
      ) as privileges
     where procedures.oid = 'public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric)'::pg_catalog.regprocedure
       and privileges.grantee = 'postgres'::pg_catalog.regrole::oid
       and privileges.privilege_type = 'EXECUTE'
  )
    or not exists (
    select 1
      from pg_catalog.pg_proc procedures
      cross join lateral pg_catalog.aclexplode(
        coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
      ) as privileges
     where procedures.oid = 'public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean)'::pg_catalog.regprocedure
       and privileges.grantee = 'postgres'::pg_catalog.regrole::oid
       and privileges.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Postgres must retain EXECUTE on public proof/prune entry points';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc procedures
      cross join lateral pg_catalog.aclexplode(
        coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
      ) as privileges
     where procedures.oid = 'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)'::pg_catalog.regprocedure
       and privileges.grantee = 'postgres'::pg_catalog.regrole::oid
       and privileges.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Postgres must not retain EXECUTE on internal archive prune';
  end if;
end;
$$;

commit;
