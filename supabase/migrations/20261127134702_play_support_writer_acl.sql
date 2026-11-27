-- Credential provisioning is separate. The backend receives access to the
-- listed entry points, never USAGE on private or direct receipt/entitlement ACLs.
create role play_support_writer nologin noinherit nobypassrls nocreaterole nocreatedb;
create schema arcade_play_api;
revoke all on schema arcade_play_api from public, anon, authenticated, service_role;
grant usage on schema arcade_play_api to play_support_writer;

grant play_support_owner to current_user with inherit false, set true;
grant usage, create on schema arcade_play_api to play_support_owner;

do $install$
declare
  previous_role text := pg_catalog.current_setting('role');
  api_functions regprocedure[] := array[
    'private.play_support_enqueue_inbox(text,bytea,integer,bytea,bytea,bytea,text,timestamptz)'::regprocedure,
    'private.play_support_claim_inbox(text,bytea)'::regprocedure,
    'private.play_support_apply_purchase(text,bytea,bigint,text,text,text,boolean,text,timestamptz,boolean)'::regprocedure,
    'private.play_support_begin_ack(uuid,bigint)'::regprocedure,
    'private.play_support_recover_ack(uuid,bigint)'::regprocedure,
    'private.play_support_finish_ack(uuid,bigint,uuid,text)'::regprocedure,
    'private.play_support_complete_inbox(uuid,bigint)'::regprocedure,
    'private.play_support_reschedule_inbox(text,bytea,bigint,timestamptz,boolean)'::regprocedure
  ];
  fn regprocedure;
begin
  perform pg_catalog.set_config('role', 'play_support_owner', true);
  foreach fn in array api_functions loop
    -- OIDs resolve only the fixed signatures above. regprocedure renders
    -- a quoted identifier/type list and follows the schema change in-place.
    execute pg_catalog.format('alter function %s set schema arcade_play_api', fn);
    execute pg_catalog.format('revoke all on function %s from public, anon, authenticated, service_role', fn);
    execute pg_catalog.format('grant execute on function %s to play_support_writer', fn);
  end loop;
  perform pg_catalog.set_config('role', previous_role, true);
end;
$install$;

revoke create on schema arcade_play_api from play_support_owner;
revoke play_support_owner from current_user granted by current_user;

do $boundary$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles r where r.rolname = 'play_support_writer'
      and not (r.rolcanlogin or r.rolsuper or r.rolbypassrls or r.rolinherit
        or r.rolcreaterole or r.rolcreatedb or r.rolreplication)
  ) or (select pg_catalog.count(*) from pg_catalog.pg_proc p
        where p.pronamespace = 'arcade_play_api'::regnamespace) <> 8
    or pg_catalog.has_schema_privilege('play_support_owner', 'arcade_play_api', 'CREATE')
    or pg_catalog.has_schema_privilege('play_support_writer', 'private', 'USAGE,CREATE')
    or pg_catalog.has_schema_privilege('play_support_writer', 'auth', 'USAGE,CREATE')
    or pg_catalog.has_schema_privilege('play_support_writer', 'arcade_play_api', 'CREATE')
    or exists (
      select 1 from pg_catalog.pg_auth_members m
      where m.member = 'play_support_writer'::regrole
        or (m.roleid in ('play_support_owner'::regrole, 'play_support_writer'::regrole)
          and (m.member <> current_user::regrole or m.set_option or m.inherit_option or not m.admin_option))
    ) or exists (
      select 1 from pg_catalog.pg_namespace n
      cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n',n.nspowner))) a
      where n.oid = 'arcade_play_api'::regnamespace
        and (a.grantee not in (n.nspowner, 'play_support_owner'::regrole, 'play_support_writer'::regrole)
          or (a.grantee <> n.nspowner and (a.privilege_type <> 'USAGE' or a.is_grantable)))
    ) or exists (
      select 1 from pg_catalog.pg_class c
      where c.relnamespace = 'private'::regnamespace and c.relname ~ '^play_support_' and c.relkind in ('r','p')
        and (pg_catalog.has_table_privilege('play_support_writer',c.oid,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or pg_catalog.has_any_column_privilege('play_support_writer',c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
    ) or exists (
      select 1 from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f',p.proowner))) a
      where p.pronamespace = 'arcade_play_api'::regnamespace
        and (p.proowner <> 'play_support_owner'::regrole or not p.prosecdef
          or not coalesce(p.proconfig @> array['search_path=""'], false)
          or not pg_catalog.has_function_privilege('play_support_writer',p.oid,'EXECUTE')
          or a.grantee not in (p.proowner, 'play_support_writer'::regrole)
          or (a.grantee = 'play_support_writer'::regrole and a.is_grantable))
    ) then
    raise exception 'unexpected play support writer privilege';
  end if;
end;
$boundary$;
