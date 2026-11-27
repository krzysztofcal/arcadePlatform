-- Each claim transaction ends before provider calls or account locks.
-- Rescheduling requires the same live lease; runtime grants come separately.
grant play_support_owner to current_user with inherit false, set true;
grant create on schema private to play_support_owner;

do $install$
declare
  previous_role text := pg_catalog.current_setting('role');
begin
  perform pg_catalog.set_config('role', 'play_support_owner', true);

  create function private.play_support_claim_inbox(p_package_name text, p_token_hash bytea)
  returns table (
    token_hash bytea, generation bigint, lease_until timestamptz, failure_count integer,
    token_key_version integer, token_nonce bytea, token_ciphertext bytea, token_tag bytea
  )
  language plpgsql security definer
  set search_path = ''
  as $claim$
  declare
    claimed_at timestamptz := pg_catalog.clock_timestamp();
  begin
    if p_package_name is null or p_package_name not in ('pl.kcswh.arcadepoker', 'pl.kcswh.arcadepoker.stage')
      or (p_token_hash is not null and pg_catalog.octet_length(p_token_hash) <> 32) then
      return;
    end if;

    return query
      with candidate as (
        select i.token_hash from private.play_support_inbox i
        where i.package_name = p_package_name
          and (p_token_hash is null or i.token_hash = p_token_hash)
          and i.next_check_at <= claimed_at
          and (i.lease_until is null or i.lease_until <= claimed_at)
          and i.token_ciphertext is not null
        order by i.next_check_at, i.token_hash
        limit 1
        for update skip locked
      )
      update private.play_support_inbox i
      set generation = i.generation + 1, lease_until = claimed_at + interval '30 seconds'
      from candidate
      where i.token_hash = candidate.token_hash
      returning i.token_hash, i.generation, i.lease_until, i.failure_count,
        i.token_key_version, i.token_nonce, i.token_ciphertext, i.token_tag;
  end;
  $claim$;

  create function private.play_support_reschedule_inbox(
    p_package_name text, p_token_hash bytea, p_generation bigint,
    p_next_check_at timestamptz, p_failed boolean
  )
  returns boolean
  language plpgsql security definer
  set search_path = ''
  as $reschedule$
  begin
    if p_next_check_at is null or not pg_catalog.isfinite(p_next_check_at) or p_failed is null then
      return false;
    end if;

    update private.play_support_inbox i
    set next_check_at = greatest(p_next_check_at, pg_catalog.clock_timestamp()),
        last_checked_at = pg_catalog.clock_timestamp(),
        lease_until = null,
        failure_count = case
          when not p_failed then 0
          when i.failure_count < 2147483647 then i.failure_count + 1
          else i.failure_count
        end
    where i.token_hash = p_token_hash and i.package_name = p_package_name
      and i.generation = p_generation and i.lease_until > pg_catalog.clock_timestamp();
    return found;
  end;
  $reschedule$;

  revoke all on function private.play_support_claim_inbox(text, bytea),
    private.play_support_reschedule_inbox(text, bytea, bigint, timestamptz, boolean)
    from public, anon, authenticated, service_role;
  perform pg_catalog.set_config('role', previous_role, true);
end;
$install$;

revoke create on schema private from play_support_owner;
revoke play_support_owner from current_user granted by current_user;

do $boundary$
begin
  if pg_catalog.has_schema_privilege('play_support_owner', 'private', 'CREATE') or exists (
    select 1 from pg_catalog.pg_auth_members m
    where m.roleid = 'play_support_owner'::regrole
      and (m.member <> current_user::regrole or m.set_option or m.inherit_option or not m.admin_option)
  ) or exists (
    select 1 from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid in ('private.play_support_claim_inbox(text,bytea)'::regprocedure,
      'private.play_support_reschedule_inbox(text,bytea,bigint,timestamptz,boolean)'::regprocedure)
      and a.grantee <> 'play_support_owner'::regrole
  ) then
    raise exception 'unexpected play support inbox privilege';
  end if;
end;
$boundary$;
