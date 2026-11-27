-- Only the trusted writer may receive future EXECUTE grants. Its caller
-- authenticates native submission or RTDN before constructing this envelope.
grant play_support_owner to current_user with inherit false, set true;
grant create on schema private to play_support_owner;

do $install$
declare
  previous_role text := pg_catalog.current_setting('role');
  claim_definition text;
  claim_assignment constant text := 'set generation = i.generation + 1, lease_until =';
begin
  perform pg_catalog.set_config('role', 'play_support_owner', true);

  alter table private.play_support_inbox
    add column event_revision bigint not null default 0,
    add column claimed_event_revision bigint not null default 0;

  -- Snapshot queue revision in the claim's existing atomic update.
  select pg_catalog.pg_get_functiondef('private.play_support_claim_inbox(text,bytea)'::regprocedure)
    into claim_definition;
  if claim_definition is null or pg_catalog.length(claim_definition) -
      pg_catalog.length(pg_catalog.replace(claim_definition, claim_assignment, ''))
      <> pg_catalog.length(claim_assignment) then
    raise exception 'unexpected play support claim definition';
  end if;
  execute pg_catalog.replace(claim_definition, claim_assignment,
    'set generation = i.generation + 1, claimed_event_revision = i.event_revision, lease_until =');

  create function private.play_support_enqueue_inbox(
    p_package_name text, p_token_hash bytea, p_key_version integer, p_nonce bytea,
    p_ciphertext bytea, p_tag bytea, p_message_id text, p_event_at timestamptz
  )
  returns boolean
  language plpgsql security definer
  set search_path = ''
  as $enqueue$
  begin
    if p_package_name is null or p_package_name not in ('pl.kcswh.arcadepoker', 'pl.kcswh.arcadepoker.stage')
      or pg_catalog.octet_length(p_token_hash) is distinct from 32
      or p_key_version is null or p_key_version <= 0
      or pg_catalog.octet_length(p_nonce) is distinct from 12
      or p_ciphertext is null or pg_catalog.octet_length(p_ciphertext) not between 1 and 8192
      or pg_catalog.octet_length(p_tag) is distinct from 16
      or (p_event_at is null) <> (p_message_id is null)
      or (p_event_at is not null and (not pg_catalog.isfinite(p_event_at)
        or p_event_at > pg_catalog.clock_timestamp() + interval '5 minutes'
        or pg_catalog.length(p_message_id) not between 1 and 128 or pg_catalog.btrim(p_message_id) = '')) then
      return false;
    end if;

    insert into private.play_support_inbox as i
      (token_hash, package_name, token_key_version, token_nonce, token_ciphertext,
       token_tag, last_message_id, last_event_at, event_revision, next_check_at)
    values (p_token_hash, p_package_name, p_key_version, p_nonce, p_ciphertext,
      p_tag, p_message_id, p_event_at,
      case when p_event_at is not null then 1 else 0 end, pg_catalog.clock_timestamp())
    on conflict (token_hash) do update set
      token_key_version = case when i.token_ciphertext is null then excluded.token_key_version else i.token_key_version end,
      token_nonce = case when i.token_ciphertext is null then excluded.token_nonce else i.token_nonce end,
      token_ciphertext = coalesce(i.token_ciphertext, excluded.token_ciphertext),
      token_tag = case when i.token_ciphertext is null then excluded.token_tag else i.token_tag end,
      last_message_id = coalesce(excluded.last_message_id, i.last_message_id),
      last_event_at = greatest(i.last_event_at, excluded.last_event_at),
      event_revision = case when excluded.last_message_id is not null
          and excluded.last_message_id is distinct from i.last_message_id
        then i.event_revision + 1 else i.event_revision end,
      next_check_at = case
        -- The provider timestamp is diagnostic only. Distinct authenticated
        -- messages trigger re-reads even if dated the same or out of order.
        -- Do not bypass an existing retry deadline or touch a live claim.
        when i.next_check_at is null and i.lease_until is null
          and excluded.last_message_id is not null
          and excluded.last_message_id is distinct from i.last_message_id
        then excluded.next_check_at else i.next_check_at end
    where i.package_name = excluded.package_name;
    return found;
  end;
  $enqueue$;

  create function private.play_support_complete_inbox(p_receipt_id uuid, p_generation bigint)
  returns boolean
  language plpgsql security definer
  set search_path = ''
  as $complete$
  declare
    receipt private.play_support_receipts;
    completed boolean;
  begin
    receipt := private.play_support_lock_receipt(p_receipt_id, p_generation);
    if receipt.id is null or not (
      (receipt.provider_state = 'PURCHASED' and receipt.fulfilment = 'GRANTED' and receipt.ack_state = 'CONFIRMED')
      or (receipt.provider_state in ('CANCELLED', 'VOID', 'REVOKED') and receipt.fulfilment <> 'GRANTED'
        and receipt.ack_state not in ('IN_FLIGHT', 'UNCERTAIN'))
    ) then return false; end if;

    -- Keep encrypted evidence until the separately approved retention policy.
    update private.play_support_inbox i
    set next_check_at = case when i.event_revision <> i.claimed_event_revision then pg_catalog.clock_timestamp() end,
      lease_until = null, failure_count = 0, last_checked_at = pg_catalog.clock_timestamp()
    where i.token_hash = receipt.token_hash and i.package_name = receipt.package_name
      and i.generation = p_generation and i.lease_until > pg_catalog.clock_timestamp()
    returning i.event_revision = i.claimed_event_revision into completed;
    return coalesce(completed, false);
  end;
  $complete$;

  revoke all on function private.play_support_enqueue_inbox(text, bytea, integer, bytea, bytea, bytea, text, timestamptz),
    private.play_support_complete_inbox(uuid, bigint)
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
    where p.oid in ('private.play_support_enqueue_inbox(text,bytea,integer,bytea,bytea,bytea,text,timestamptz)'::regprocedure,
      'private.play_support_complete_inbox(uuid,bigint)'::regprocedure)
      and a.grantee <> 'play_support_owner'::regrole
  ) then
    raise exception 'unexpected play support inbox ingress privilege';
  end if;
end;
$boundary$;
