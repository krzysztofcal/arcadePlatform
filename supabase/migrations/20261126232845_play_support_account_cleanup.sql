-- The access migration must give the restricted definer owner the exact
-- account-deletion column privileges and RLS policies used by this lease check.
-- Keep this routine closed to runtime callers until that proof is complete.
create function private.play_support_delete_account(
  p_user_id uuid,
  p_request_id uuid,
  p_lease_generation bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using message = 'play_support_read_committed_required';
  end if;

  if p_user_id is null then
    raise exception using message = 'deletion_lease_lost';
  end if;

  -- Shared with account deletion and billing grant/revoke. The WS cleanup
  -- call site must follow campaign -> lifecycle -> deletion request row.
  -- Do not call from the lease-claim transaction or a lease-first adapter.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('account-lifecycle:' || p_user_id::text, 0)
  );

  perform 1
  from public.account_deletion_requests d
  where d.old_user_id = p_user_id
    and d.request_id = p_request_id
    and d.lease_generation = p_lease_generation
    and d.phase = 'cleanup'
    and d.status = 'PROCESSING'
    and d.lease_until > pg_catalog.clock_timestamp()
  for update;
  if not found then
    raise exception using message = 'deletion_lease_lost';
  end if;

  perform 1 from private.play_support_bindings b
    where b.user_id = p_user_id order by b.id for update;

  -- Closing a local slot makes no statement about the provider payment.
  update private.play_support_intents i set state = 'CLOSED',
    closed_at = pg_catalog.clock_timestamp(), close_reason = 'SUPPORT'
  where i.binding_id in (select b.id from private.play_support_bindings b where b.user_id = p_user_id)
    and i.state <> 'CLOSED';

  update private.play_support_receipts r set
    fulfilment = case
      when r.fulfilment = 'GRANTED' then 'REMOVED'
      when r.fulfilment = 'NOT_GRANTED' and r.provider_state = 'PURCHASED' then 'UNGRANTABLE'
      else r.fulfilment
    end,
    ack_state = case when r.ack_state = 'DUE' then 'NOT_ELIGIBLE' else r.ack_state end,
    support_required_at = case
      when r.ack_state in ('DUE', 'IN_FLIGHT', 'UNCERTAIN')
        or (r.provider_state = 'PURCHASED' and r.fulfilment = 'NOT_GRANTED')
      then coalesce(r.support_required_at, pg_catalog.clock_timestamp())
      else r.support_required_at
    end
  where r.binding_id in (select b.id from private.play_support_bindings b where b.user_id = p_user_id)
    and (r.fulfilment = 'GRANTED' or r.ack_state in ('DUE', 'IN_FLIGHT', 'UNCERTAIN')
      or (r.provider_state = 'PURCHASED' and r.fulfilment = 'NOT_GRANTED'));

  delete from private.play_support_entitlements e where e.user_id = p_user_id;
  delete from private.play_support_preferences p where p.user_id = p_user_id;
  -- Detached bindings remain usable for recovery/support evidence, never to
  -- assign an old purchase to a new account.
  update private.play_support_bindings b set user_id = null where b.user_id = p_user_id;
end;
$$;

revoke all on function private.play_support_delete_account(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
