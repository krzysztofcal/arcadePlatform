-- Preserve the existing lifecycle predicate without giving WS access to the
-- managed Auth schema or to the private billing and deletion relations.
-- Run via the transactional migration runner under the same trusted migrator
-- as the preceding ownership migration. Any unexpected membership aborts.
grant play_support_owner to current_user with inherit false, set true;
grant create on schema arcade_ws_api to play_support_owner;

do $make_probe$
declare
  previous_role text := pg_catalog.current_setting('role');
begin
  perform pg_catalog.set_config('role', 'play_support_owner', true);

  create function arcade_ws_api.account_lifecycle_status(p_user_id uuid)
  returns table (present boolean, deleting boolean)
  language sql stable security definer
  set search_path = ''
  as $probe$
    select private.play_support_account_exists(p_user_id),
      exists (select 1 from public.account_deletion_requests d where d.old_user_id = p_user_id);
  $probe$;

  revoke all on function arcade_ws_api.account_lifecycle_status(uuid)
    from public, anon, authenticated, service_role;
  grant execute on function arcade_ws_api.account_lifecycle_status(uuid) to arcade_ws_runtime;

  perform pg_catalog.set_config('role', previous_role, true);
end;
$make_probe$;

revoke create on schema arcade_ws_api from play_support_owner;
revoke play_support_owner from current_user granted by current_user;

do $boundary$
begin
  if pg_catalog.has_schema_privilege('play_support_owner', 'arcade_ws_api', 'CREATE')
    or pg_catalog.has_schema_privilege('arcade_ws_runtime', 'private', 'USAGE,CREATE')
    or pg_catalog.has_schema_privilege('arcade_ws_runtime', 'auth', 'USAGE,CREATE')
    or pg_catalog.has_any_column_privilege('arcade_ws_runtime', 'auth.users', 'SELECT')
    or pg_catalog.has_any_column_privilege('arcade_ws_runtime', 'public.account_deletion_requests', 'SELECT')
    or exists (
      select 1 from pg_catalog.pg_auth_members m
      where m.roleid = 'play_support_owner'::regrole
        and (m.member <> current_user::regrole or m.set_option or m.inherit_option or not m.admin_option)
    ) then
    raise exception 'unexpected WS lifecycle role access';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = 'arcade_ws_api.account_lifecycle_status(uuid)'::regprocedure
      and p.proowner = 'play_support_owner'::regrole and p.prosecdef
      and pg_catalog.has_function_privilege('arcade_ws_runtime', p.oid, 'EXECUTE')
  ) or exists (
    select 1 from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(p.proacl) a
    where p.oid = 'arcade_ws_api.account_lifecycle_status(uuid)'::regprocedure
      and (a.grantee not in (p.proowner, 'arcade_ws_runtime'::regrole)
        or (a.grantee = 'arcade_ws_runtime'::regrole and a.is_grantable))
  ) then
    raise exception 'unexpected WS lifecycle routine execute privilege';
  end if;
end;
$boundary$;
