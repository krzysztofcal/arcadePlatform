-- Accepts only verified ProductPurchaseV2 evidence from the future trusted
-- writer. Storage, grant and terminal cancellation commit together.
grant play_support_owner to current_user with inherit false, set true;
grant create on schema private to play_support_owner;

do $install$
declare
  previous_role text := pg_catalog.current_setting('role');
begin
  perform pg_catalog.set_config('role', 'play_support_owner', true);

  create function private.play_support_apply_purchase(
    p_package_name text, p_token_hash bytea, p_generation bigint, p_binding_id text,
    p_sku text, p_state text, p_is_test boolean, p_order_id text,
    p_completed_at timestamptz, p_acknowledged boolean
  )
  returns table (outcome text, receipt_id uuid)
  language plpgsql security definer
  set search_path = ''
  as $apply_purchase$
  declare
    purchase private.play_support_receipts;
    prior_id uuid;
    expected_environment text;
    expected_owner uuid;
    locked_owner uuid;
  begin
    if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
      raise exception 'play_support_read_committed_required';
    end if;
    p_order_id := nullif(pg_catalog.btrim(p_order_id), '');
    expected_environment := case p_package_name
      when 'pl.kcswh.arcadepoker' then 'production'
      when 'pl.kcswh.arcadepoker.stage' then 'stage'
    end;
    if expected_environment is null or p_is_test is distinct from (expected_environment = 'stage')
      or p_token_hash is null or pg_catalog.octet_length(p_token_hash) <> 32
      or p_sku is null or p_sku not in ('supporter_bronze', 'supporter_silver', 'supporter_gold')
      or p_state is null or p_state not in ('PENDING', 'PURCHASED', 'CANCELLED')
      or p_acknowledged is null or (p_state = 'PENDING' and p_acknowledged)
      or pg_catalog.length(p_order_id) > 128 then
      return query select 'MISMATCH'::text, null::uuid;
      return;
    end if;

    select r.id into prior_id from private.play_support_receipts r where r.token_hash = p_token_hash;
    if prior_id is not null then
      purchase := private.play_support_lock_receipt(prior_id, p_generation);
      if purchase.id is null then
        return query select 'STALE'::text, null::uuid;
        return;
      end if;
      if purchase.package_name <> p_package_name or purchase.binding_id is distinct from p_binding_id
        or purchase.sku <> p_sku or purchase.is_test <> p_is_test
        or (purchase.order_id is not null and p_order_id is not null and purchase.order_id <> p_order_id) then
        return query select 'MISMATCH'::text, null::uuid;
        return;
      end if;
      if purchase.provider_state in ('CANCELLED', 'VOID', 'REVOKED') then
        return query select 'TERMINAL'::text, purchase.id;
        return;
      end if;
      if purchase.provider_state = 'PURCHASED' and p_state = 'PENDING' then
        return query select 'STALE_OBSERVATION'::text, purchase.id;
        return;
      end if;

      update private.play_support_receipts r set
        provider_state = p_state, order_id = coalesce(r.order_id, p_order_id),
        completed_at = coalesce(r.completed_at, p_completed_at),
        ack_state = case when p_state = 'PURCHASED' and p_acknowledged then 'CONFIRMED' else r.ack_state end,
        ack_confirmed_at = case when p_state = 'PURCHASED' and p_acknowledged
          then coalesce(r.ack_confirmed_at, pg_catalog.clock_timestamp()) else r.ack_confirmed_at end
      where r.id = purchase.id
      returning r.* into purchase;
    else
      -- New receipts have no trusted exact intent proof yet. Bind only to
      -- the verified stable account ID and do not close another attempt.
      select b.user_id into expected_owner from private.play_support_bindings b
      where b.id = p_binding_id and b.environment = expected_environment;
      if not found then
        return query select 'UNBOUND'::text, null::uuid;
        return;
      end if;
      if expected_owner is not null then
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended('account-lifecycle:' || expected_owner::text, 0)
        );
      end if;
      select b.user_id into locked_owner from private.play_support_bindings b
      where b.id = p_binding_id and b.environment = expected_environment for no key update;
      if not found or locked_owner is distinct from expected_owner then
        return query select 'STALE'::text, null::uuid;
        return;
      end if;
      perform 1 from private.play_support_inbox i where i.token_hash = p_token_hash
        and i.package_name = p_package_name and i.generation = p_generation
        and i.lease_until > pg_catalog.clock_timestamp() for update;
      if not found then
        return query select 'STALE'::text, null::uuid;
        return;
      end if;

      -- A competing transaction might have inserted since the pre-read.
      -- Do not acquire another binding/receipt after taking the inbox lock.
      if exists (select 1 from private.play_support_receipts r where r.token_hash = p_token_hash) then
        return query select 'STALE'::text, null::uuid;
        return;
      end if;
      insert into private.play_support_receipts as r
        (package_name, token_hash, binding_id, sku, provider_state, is_test,
         order_id, completed_at, ack_state, ack_confirmed_at)
      values (p_package_name, p_token_hash, p_binding_id, p_sku, p_state, p_is_test,
        p_order_id, p_completed_at,
        case when p_state = 'PURCHASED' and p_acknowledged then 'CONFIRMED' else 'NOT_ELIGIBLE' end,
        case when p_state = 'PURCHASED' and p_acknowledged then pg_catalog.clock_timestamp() end)
      returning r.* into purchase;
    end if;

    if p_state = 'PURCHASED' then
      if purchase.order_id is null and purchase.fulfilment = 'NOT_GRANTED' then
        return query select 'NEEDS_ORDER_PROOF'::text, purchase.id;
        return;
      end if;
      -- Non-grant results preserve provider evidence. Inactive/duplicate
      -- purchases need support ownership, not automatic acknowledgment.
      return query select private.play_support_grant_receipt(purchase.id, p_generation), purchase.id;
    elsif p_state = 'CANCELLED' then
      return query select private.play_support_revoke_receipt(purchase.id, p_generation), purchase.id;
    else
      return query select 'PENDING'::text, purchase.id;
    end if;
  end;
  $apply_purchase$;

  revoke all on function private.play_support_apply_purchase(text, bytea, bigint,
    text, text, text, boolean, text, timestamptz, boolean)
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
  ) or (select pg_catalog.count(*) from pg_catalog.pg_proc p
    where p.oid in ('private.play_support_lock_receipt(uuid,bigint)'::regprocedure,
      'private.play_support_grant_receipt(uuid,bigint)'::regprocedure,
      'private.play_support_revoke_receipt(uuid,bigint)'::regprocedure)
      and p.proowner = 'play_support_owner'::regrole
      and pg_catalog.has_function_privilege('play_support_owner', p.oid, 'EXECUTE')) <> 3
  or exists (
    select 1 from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid = 'private.play_support_apply_purchase(text,bytea,bigint,text,text,text,boolean,text,timestamptz,boolean)'::regprocedure
      and a.grantee <> 'play_support_owner'::regrole
  ) then
    raise exception 'unexpected play support purchase privilege';
  end if;
end;
$boundary$;
