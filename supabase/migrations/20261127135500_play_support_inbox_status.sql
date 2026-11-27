-- A duplicate RTDN delivery may succeed only when the specific message
-- revision has no outstanding work.
grant play_support_owner to current_user with inherit false, set true;
grant create on schema arcade_play_api to play_support_owner;

do $install$
declare
  previous_role text := pg_catalog.current_setting('role');
begin
  perform pg_catalog.set_config('role', 'play_support_owner', true);

  create function arcade_play_api.play_support_inbox_is_complete(
    p_package_name text, p_token_hash bytea, p_message_id text
  ) returns boolean
  language sql stable security definer
  set search_path = ''
  return exists (
    select 1
    from private.play_support_inbox i
    join private.play_support_receipts r
      on r.package_name = i.package_name and r.token_hash = i.token_hash
    where i.package_name = p_package_name and i.token_hash = p_token_hash
      and i.last_message_id = p_message_id
      and i.next_check_at is null and i.lease_until is null
      and i.event_revision = i.claimed_event_revision
      and (
        (r.provider_state = 'PURCHASED' and r.fulfilment = 'GRANTED' and r.ack_state = 'CONFIRMED')
        or (r.provider_state in ('CANCELLED', 'VOID', 'REVOKED') and r.fulfilment <> 'GRANTED'
          and r.ack_state not in ('IN_FLIGHT', 'UNCERTAIN'))
      )
  );

  revoke all on function arcade_play_api.play_support_inbox_is_complete(text,bytea,text)
    from public, anon, authenticated, service_role;
  grant execute on function arcade_play_api.play_support_inbox_is_complete(text,bytea,text)
    to play_support_writer;

  if exists (
    select 1 from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(p.proacl) a
    where p.oid = 'arcade_play_api.play_support_inbox_is_complete(text,bytea,text)'::regprocedure
      and (a.grantee not in ('play_support_owner'::regrole, 'play_support_writer'::regrole)
        or (a.grantee = 'play_support_writer'::regrole and a.is_grantable))
  ) then
    raise exception 'unexpected play support inbox status privilege';
  end if;
  perform pg_catalog.set_config('role', previous_role, true);
end;
$install$;

revoke create on schema arcade_play_api from play_support_owner;
revoke play_support_owner from current_user granted by current_user;
