-- Keep provider calls outside these transactions. No runtime EXECUTE is granted
-- here. The access migration transfers ownership to the restricted definer role
-- and proves effective ACL/RLS before wiring the processor.
create function private.play_support_lock_receipt(p_receipt_id uuid, p_generation bigint)
returns private.play_support_receipts
language plpgsql
set search_path = ''
as $$
declare
  receipt private.play_support_receipts;
  expected_binding text;
  expected_intent uuid;
  expected_owner uuid;
  locked_owner uuid;
begin
  -- The post-lock account check needs a snapshot taken after lock acquisition.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using message = 'play_support_read_committed_required';
  end if;

  select r.binding_id, r.intent_id, b.user_id into expected_binding, expected_intent, expected_owner
  from private.play_support_receipts r
  left join private.play_support_bindings b on b.id = r.binding_id
  where r.id = p_receipt_id;
  if not found then return null; end if;

  if expected_owner is not null then
    -- Same advisory key as shared/account-deletion.mjs::lockAccountLifecycle.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('account-lifecycle:' || expected_owner::text, 0)
    );
  end if;

  if expected_binding is not null then
    select b.user_id into locked_owner
    from private.play_support_bindings b where b.id = expected_binding for no key update;
    if not found or locked_owner is distinct from expected_owner then return null; end if;
  end if;

  if expected_intent is not null then
    perform 1 from private.play_support_intents i where i.id = expected_intent for update;
    if not found then return null; end if;
  end if;

  select r.* into receipt from private.play_support_receipts r
  where r.id = p_receipt_id and r.binding_id is not distinct from expected_binding
    and r.intent_id is not distinct from expected_intent
  for update;
  if not found then return null; end if;

  -- Claim transactions must release the inbox before attempting any other
  -- billing locks. Missing work and lost ownership both require a fresh claim.
  perform 1 from private.play_support_inbox i
  where i.token_hash = receipt.token_hash and i.package_name = receipt.package_name
    and i.generation = p_generation and i.lease_until > pg_catalog.clock_timestamp()
  for update;
  if not found then return null; end if;

  return receipt;
end;
$$;

create function private.play_support_grant_receipt(p_receipt_id uuid, p_generation bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt private.play_support_receipts;
  owner_id uuid;
begin
  receipt := private.play_support_lock_receipt(p_receipt_id, p_generation);
  if receipt.id is null then return 'STALE'; end if;
  if receipt.provider_state <> 'PURCHASED' or
     receipt.is_test <> (receipt.environment = 'stage') then
    return 'INELIGIBLE';
  end if;

  if receipt.binding_id is null then return 'UNBOUND'; end if;

  select b.user_id into owner_id
  from private.play_support_bindings b where b.id = receipt.binding_id;
  if owner_id is null or not exists (select 1 from auth.users u where u.id = owner_id)
     or exists (select 1 from public.account_deletion_requests d where d.old_user_id = owner_id) then
    if receipt.fulfilment = 'NOT_GRANTED' then
      update private.play_support_receipts set fulfilment = 'UNGRANTABLE',
        support_required_at = coalesce(support_required_at, pg_catalog.clock_timestamp())
      where id = receipt.id;
    end if;
    return 'ACCOUNT_INACTIVE';
  end if;

  if receipt.fulfilment = 'GRANTED' then
    if exists (select 1 from private.play_support_entitlements e
               where e.source_receipt_id = receipt.id and e.user_id = owner_id) then
      return 'ALREADY_GRANTED';
    end if;
    return 'INELIGIBLE';
  end if;
  if receipt.fulfilment <> 'NOT_GRANTED' or receipt.ack_state not in ('NOT_ELIGIBLE', 'CONFIRMED')
     or receipt.order_id is null or pg_catalog.btrim(receipt.order_id) = '' then
    return 'INELIGIBLE';
  end if;

  insert into private.play_support_entitlements (user_id, sku, source_receipt_id)
  values (owner_id, receipt.sku, receipt.id)
  on conflict (user_id, sku) do nothing;
  if not found then
    update private.play_support_receipts set fulfilment = 'UNGRANTABLE',
      support_required_at = coalesce(support_required_at, pg_catalog.clock_timestamp())
    where id = receipt.id;
    return 'DUPLICATE_SKU';
  end if;

  update private.play_support_receipts set fulfilment = 'GRANTED',
    ack_state = case when ack_state = 'CONFIRMED' then ack_state else 'DUE' end
  where id = receipt.id;
  if receipt.intent_id is not null then
    update private.play_support_intents set state = 'CLOSED',
      closed_at = pg_catalog.clock_timestamp(), close_reason = 'FULFILLED'
    where id = receipt.intent_id and state <> 'CLOSED';
  end if;
  return 'GRANTED';
end;
$$;

create function private.play_support_revoke_receipt(p_receipt_id uuid, p_generation bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt private.play_support_receipts;
  removed_owner uuid;
begin
  receipt := private.play_support_lock_receipt(p_receipt_id, p_generation);
  if receipt.id is null then return 'STALE'; end if;
  if receipt.provider_state not in ('CANCELLED', 'VOID', 'REVOKED') then return 'INELIGIBLE'; end if;

  delete from private.play_support_entitlements e
    where e.source_receipt_id = receipt.id returning e.user_id into removed_owner;
  if removed_owner is not null then
    -- A null selection already resolves to the highest remaining visible badge.
    update private.play_support_preferences set selected_sku = null
    where user_id = removed_owner and selected_sku = receipt.sku;
  end if;

  update private.play_support_receipts set
    fulfilment = case when fulfilment = 'GRANTED' then 'REMOVED' else fulfilment end,
    ack_state = case when ack_state = 'DUE' then 'NOT_ELIGIBLE' else ack_state end
  where id = receipt.id;

  return case when removed_owner is null then 'ALREADY_ABSENT' else 'REVOKED' end;
end;
$$;

revoke all on function private.play_support_lock_receipt(uuid, bigint),
  private.play_support_grant_receipt(uuid, bigint),
  private.play_support_revoke_receipt(uuid, bigint)
  from public, anon, authenticated, service_role;
