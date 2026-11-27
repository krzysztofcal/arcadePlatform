-- Privileged migration principal can answer the same narrow Auth existence
-- question as public.account_is_active(). The billing owner gets no Auth access.
create function private.play_support_account_exists(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users u where u.id = p_user_id);
$$;
revoke all on function private.play_support_account_exists(uuid)
  from public, anon, authenticated, service_role;

create role play_support_owner nologin noinherit nobypassrls nocreaterole nocreatedb;
grant execute on function private.play_support_account_exists(uuid) to play_support_owner;

-- Allow the lease check to take a row lock, while RLS denies lease writes.
grant select (old_user_id, request_id, lease_generation, phase, status, lease_until),
  update (lease_until) on public.account_deletion_requests to play_support_owner;
create policy play_support_lease_read on public.account_deletion_requests
  for select to play_support_owner using (true);
create policy play_support_lease_lock on public.account_deletion_requests
  for update to play_support_owner using (true) with check (false);
create policy play_support_no_lease_write on public.account_deletion_requests
  as restrictive for update to play_support_owner using (true) with check (false);

-- Keep the exact existing grant routine, changing only the Auth existence probe.
do $patch$
declare
  definition text;
  original constant text :=
    'not exists (select 1 from auth.users u where u.id = owner_id)';
begin
  select pg_catalog.pg_get_functiondef('private.play_support_grant_receipt(uuid,bigint)'::regprocedure)
    into definition;
  if definition is null or pg_catalog.length(definition) -
      pg_catalog.length(pg_catalog.replace(definition, original, '')) <> pg_catalog.length(original) then
    raise exception 'unexpected play support grant definition';
  end if;
  execute pg_catalog.replace(definition, original, 'not private.play_support_account_exists(owner_id)');
end;
$patch$;

-- Temporary membership and schema CREATE are needed for ownership transfer.
grant play_support_owner to current_user with inherit false, set true;
grant usage, create on schema private to play_support_owner;

alter table private.play_support_bindings owner to play_support_owner;
alter table private.play_support_intents owner to play_support_owner;
alter table private.play_support_receipts owner to play_support_owner;
alter table private.play_support_entitlements owner to play_support_owner;
alter table private.play_support_preferences owner to play_support_owner;
alter table private.play_support_inbox owner to play_support_owner;
alter table private.play_support_reconcile_cursor owner to play_support_owner;
alter function private.play_support_lock_receipt(uuid, bigint) owner to play_support_owner;
alter function private.play_support_grant_receipt(uuid, bigint) owner to play_support_owner;
alter function private.play_support_revoke_receipt(uuid, bigint) owner to play_support_owner;
alter function private.play_support_delete_account(uuid, uuid, bigint) owner to play_support_owner;

revoke create on schema private from play_support_owner;
revoke play_support_owner from current_user granted by current_user;

-- A managed CREATEROLE principal can retain PostgreSQL's automatic ADMIN
-- edge. This migration permits that edge only for its already privileged
-- migrator and only without SET or INHERIT.
do $membership$
begin
  if exists (
    select 1 from pg_catalog.pg_auth_members m
    where m.roleid = 'play_support_owner'::regrole
      and (m.member <> current_user::regrole or m.set_option or m.inherit_option or not m.admin_option)
  ) or pg_catalog.has_schema_privilege('play_support_owner', 'private', 'CREATE') then
    raise exception 'unexpected play support owner membership or schema privilege';
  end if;
end;
$membership$;

do $boundary$
begin
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.account_deletion_requests'::regclass and relrowsecurity
  ) then
    raise exception 'play support lease policy requires row level security';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(p.proacl) a
    where p.oid = 'private.play_support_account_exists(uuid)'::regprocedure
      and (a.grantee not in (p.proowner, 'play_support_owner'::regrole)
           or (a.grantee = 'play_support_owner'::regrole and a.is_grantable))
  ) then
    raise exception 'unexpected play support Auth probe privilege';
  end if;
end;
$boundary$;

-- Neither the writer nor WS gets a login or execution grant in this migration.
