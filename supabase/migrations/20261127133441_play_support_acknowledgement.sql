-- Provider calls run between committed begin/finish transactions.
-- The writer's EXECUTE grants are handled by the access migration.
grant play_support_owner to current_user with inherit false, set true;
grant create on schema private to play_support_owner;

do $install$
declare
  previous_role text := pg_catalog.current_setting('role');
begin
  perform pg_catalog.set_config('role', 'play_support_owner', true);

  alter table private.play_support_receipts
    add column ack_started_at timestamptz,
    add column ack_confirmed_at timestamptz;

  -- Caller holds the lifecycle, binding, receipt and inbox locks returned
  -- by play_support_lock_receipt. Never use this as an unlocked preflight.
  create function private.play_support_ack_eligible(p_receipt private.play_support_receipts)
  returns boolean
  language sql stable
  set search_path = ''
  as $eligible$
    select p_receipt.provider_state = 'PURCHASED'
      and p_receipt.fulfilment = 'GRANTED'
      and p_receipt.is_test = (p_receipt.environment = 'stage')
      and exists (
        select 1 from private.play_support_bindings b
        join private.play_support_entitlements e
          on e.user_id = b.user_id and e.source_receipt_id = p_receipt.id
        where b.id = p_receipt.binding_id
          and private.play_support_account_exists(b.user_id)
          and not exists (
            select 1 from public.account_deletion_requests d where d.old_user_id = b.user_id
          )
      );
  $eligible$;

  create function private.play_support_begin_ack(p_receipt_id uuid, p_generation bigint)
  returns uuid
  language plpgsql security definer
  set search_path = ''
  as $begin_ack$
  declare
    receipt private.play_support_receipts;
    attempt_id uuid;
  begin
    receipt := private.play_support_lock_receipt(p_receipt_id, p_generation);
    if receipt.id is null or receipt.ack_state is distinct from 'DUE' then return null; end if;
    if private.play_support_ack_eligible(receipt) is not true then
      update private.play_support_receipts
        set ack_state = 'NOT_ELIGIBLE',
            support_required_at = coalesce(support_required_at, pg_catalog.clock_timestamp())
      where id = receipt.id;
      return null;
    end if;

    attempt_id := pg_catalog.gen_random_uuid();
    update private.play_support_receipts
      set ack_state = 'IN_FLIGHT', ack_attempt_id = attempt_id,
          ack_started_at = pg_catalog.clock_timestamp()
    where id = receipt.id;
    return attempt_id;
  end;
  $begin_ack$;

  -- Once work is reclaimed, recover the exact previous attempt so a fresh
  -- authoritative provider read can settle it under the new generation.
  create function private.play_support_recover_ack(p_receipt_id uuid, p_generation bigint)
  returns uuid
  language plpgsql security definer
  set search_path = ''
  as $recover_ack$
  declare
    receipt private.play_support_receipts;
  begin
    receipt := private.play_support_lock_receipt(p_receipt_id, p_generation);
    if receipt.id is null or receipt.ack_state not in ('IN_FLIGHT', 'UNCERTAIN') then
      return null;
    end if;
    return receipt.ack_attempt_id;
  end;
  $recover_ack$;

  create function private.play_support_finish_ack(
    p_receipt_id uuid, p_generation bigint, p_attempt_id uuid, p_outcome text
  )
  returns text
  language plpgsql security definer
  set search_path = ''
  as $finish_ack$
  declare
    receipt private.play_support_receipts;
    new_state text;
  begin
    if p_outcome is null or p_outcome not in ('CONFIRMED', 'UNCERTAIN', 'NOT_ACKNOWLEDGED') then
      raise exception 'invalid play support acknowledgement outcome';
    end if;
    receipt := private.play_support_lock_receipt(p_receipt_id, p_generation);
    if receipt.id is null or p_attempt_id is null or receipt.ack_attempt_id is distinct from p_attempt_id then
      return 'STALE';
    end if;
    if receipt.ack_state = 'CONFIRMED' then return 'CONFIRMED'; end if;
    if receipt.ack_state not in ('IN_FLIGHT', 'UNCERTAIN') then return 'STALE'; end if;

    if p_outcome = 'CONFIRMED' then
      -- Late confirmation is provider evidence, even after ownership removal.
      new_state := 'CONFIRMED';
    elsif p_outcome = 'UNCERTAIN' then
      new_state := 'UNCERTAIN';
    -- NOT_ACKNOWLEDGED is an authoritative provider read, never a timeout.
    elsif private.play_support_ack_eligible(receipt) then
      new_state := 'DUE';
    else
      new_state := 'NOT_ELIGIBLE';
    end if;

    update private.play_support_receipts set ack_state = new_state,
      ack_confirmed_at = case when new_state = 'CONFIRMED' then pg_catalog.clock_timestamp() else ack_confirmed_at end,
      support_required_at = case when new_state = 'NOT_ELIGIBLE'
        then coalesce(support_required_at, pg_catalog.clock_timestamp()) else support_required_at end
    where id = receipt.id;
    return new_state;
  end;
  $finish_ack$;

  revoke all on function private.play_support_ack_eligible(private.play_support_receipts),
    private.play_support_begin_ack(uuid, bigint),
    private.play_support_recover_ack(uuid, bigint),
    private.play_support_finish_ack(uuid, bigint, uuid, text)
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
    where p.oid in ('private.play_support_ack_eligible(private.play_support_receipts)'::regprocedure,
      'private.play_support_begin_ack(uuid,bigint)'::regprocedure,
      'private.play_support_recover_ack(uuid,bigint)'::regprocedure,
      'private.play_support_finish_ack(uuid,bigint,uuid,text)'::regprocedure)
      and a.grantee <> 'play_support_owner'::regrole
  ) then
    raise exception 'unexpected play support acknowledgement privilege';
  end if;
end;
$boundary$;
