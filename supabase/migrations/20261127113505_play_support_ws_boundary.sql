-- Billing-facing permissions for the future WS connection. Keep the role
-- NOLOGIN until its separate gameplay ACL and compatibility proof are ready.
create role arcade_ws_runtime nologin noinherit nobypassrls nocreaterole nocreatedb;
-- Do not give WS USAGE on private, which contains unrelated legacy routines.
create schema arcade_ws_api;
revoke all on schema arcade_ws_api from public, anon, authenticated, service_role;
grant usage on schema arcade_ws_api to arcade_ws_runtime;

grant select (user_id, public_profile_blocked) on public.user_profiles to play_support_owner;
create policy play_support_visible_profile on public.user_profiles
  for select to play_support_owner using (public_profile_blocked is false);

-- Batches outside the existing repository contract fail closed to no badges.
-- The Auth existence and no-deletion check below matches accountActiveSql.
create function arcade_ws_api.play_support_public_projection(p_user_ids uuid[])
returns table (user_id uuid, badge_sku text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, badge.sku
  from (
    select distinct candidate
    from pg_catalog.unnest(case
      when pg_catalog.array_ndims(p_user_ids) = 1 and pg_catalog.cardinality(p_user_ids) <= 10
      then p_user_ids else '{}'::uuid[] end
    ) as ids(candidate)
    where candidate is not null
  ) as wanted
  join public.user_profiles p on p.user_id = wanted.candidate
  left join private.play_support_preferences pref on pref.user_id = p.user_id
  cross join lateral (
    select e.sku
    from private.play_support_entitlements e
    where e.user_id = p.user_id
    order by (e.sku is not distinct from pref.selected_sku) desc,
      case e.sku when 'supporter_gold' then 3 when 'supporter_silver' then 2 else 1 end desc, e.sku
    limit 1
  ) badge
  where p.public_profile_blocked is false and coalesce(pref.visible, true)
    and private.play_support_account_exists(p.user_id)
    and not exists (
      select 1 from public.account_deletion_requests d where d.old_user_id = p.user_id
    );
$$;

revoke all on function arcade_ws_api.play_support_public_projection(uuid[])
  from public, anon, authenticated, service_role;

grant play_support_owner to current_user with inherit false, set true;
grant usage, create on schema arcade_ws_api to play_support_owner;
alter function arcade_ws_api.play_support_public_projection(uuid[]) owner to play_support_owner;
do $grant_ws$
declare
  previous_role text := pg_catalog.current_setting('role');
begin
  perform pg_catalog.set_config('role', 'play_support_owner', true);
  grant execute on function arcade_ws_api.play_support_public_projection(uuid[]) to arcade_ws_runtime;
  perform pg_catalog.set_config('role', previous_role, true);
end;
$grant_ws$;
revoke create on schema arcade_ws_api from play_support_owner;
revoke play_support_owner from current_user granted by current_user;

-- Managed PostgreSQL may leave an admin-only edge for the trusted migration
-- principal. The WS role itself must have no memberships or elevated options.
do $ws_boundary$
begin
  if exists (
    select 1 from pg_catalog.pg_auth_members m
    where m.member = 'arcade_ws_runtime'::regrole
      or (m.roleid in ('arcade_ws_runtime'::regrole, 'play_support_owner'::regrole)
          and (m.member <> current_user::regrole or m.set_option or m.inherit_option or not m.admin_option))
  ) or pg_catalog.has_schema_privilege('play_support_owner', 'private', 'CREATE')
    or pg_catalog.has_schema_privilege('play_support_owner', 'arcade_ws_api', 'CREATE')
    or pg_catalog.has_schema_privilege('arcade_ws_runtime', 'private', 'USAGE,CREATE')
    or pg_catalog.has_schema_privilege('arcade_ws_runtime', 'arcade_ws_api', 'CREATE') then
    raise exception 'unexpected WS or payment owner role membership';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class where oid = 'public.user_profiles'::regclass and relrowsecurity
  ) then
    raise exception 'play support profile projection requires row level security';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class c
    where c.relnamespace = 'private'::regnamespace and c.relname ~ '^play_support_'
      and c.relkind in ('r','p','v','m','f','S')
      and (c.relowner <> 'play_support_owner'::regrole
        or (c.relkind in ('r','p','v','m','f') and (
          pg_catalog.has_table_privilege('arcade_ws_runtime', c.oid,
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or pg_catalog.has_any_column_privilege('arcade_ws_runtime', c.oid,
            'SELECT,INSERT,UPDATE,REFERENCES')
        ))
        or (c.relkind = 'S' and pg_catalog.has_sequence_privilege('arcade_ws_runtime', c.oid, 'USAGE,SELECT,UPDATE')))
  ) then
    raise exception 'unexpected WS billing relation access or owner';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace and p.proname ~ '^play_support_'
      and (pg_catalog.has_function_privilege('arcade_ws_runtime', p.oid, 'EXECUTE')
        or (p.oid <> 'private.play_support_account_exists(uuid)'::regprocedure
            and p.proowner <> 'play_support_owner'::regrole))
  ) or exists (
    select 1 from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(p.proacl) a
    where p.oid = 'arcade_ws_api.play_support_public_projection(uuid[])'::regprocedure
      and (a.grantee not in (p.proowner, 'arcade_ws_runtime'::regrole)
        or (a.grantee = 'arcade_ws_runtime'::regrole and a.is_grantable))
  ) then
    raise exception 'unexpected WS billing routine execute privilege or owner';
  end if;
end;
$ws_boundary$;
