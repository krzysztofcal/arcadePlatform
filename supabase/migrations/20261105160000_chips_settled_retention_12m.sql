-- #1157: 12-month cap for settled user-linked history. Dark by default:
-- nothing is deleted until the owner enables chips_settled_retention_control
-- or authorizes an exact archive canary. Applying this migration deletes nothing.
begin;

alter table public.chips_ledger_archive_batches
  add column if not exists objects_expired_at timestamptz;

create table public.chips_settled_retention_control (
  control_id boolean primary key default true check (control_id),
  enabled boolean not null default false,
  activated_at timestamptz,
  check (enabled = (activated_at is not null))
);
insert into public.chips_settled_retention_control (control_id, enabled) values (true, false);
alter table public.chips_settled_retention_control enable row level security;
revoke all on public.chips_settled_retention_control from public, anon, authenticated, service_role;
grant select on public.chips_settled_retention_control to chips_ledger_archive_pruner;
create policy chips_settled_retention_control_pruner_select on public.chips_settled_retention_control
  for select to chips_ledger_archive_pruner using (true);

-- The default cap is 12 months. Only canonical Stage may pass an earlier test
-- cutoff (T002); every other database, Production included, refuses it.
create function public.chips_settled_retention_cutoff(p_cutoff timestamptz)
returns timestamptz language plpgsql stable security invoker set search_path = '' as $$
declare
  cap timestamptz := pg_catalog.clock_timestamp() - interval '12 months';
begin
  if p_cutoff is null then return cap; end if;
  if p_cutoff > pg_catalog.clock_timestamp()
    or (p_cutoff > cap and (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from '7656985631720456337') then
    raise exception using errcode = 'P8957', message = 'Settled retention cutoff override is allowed only on canonical Stage';
  end if;
  return p_cutoff;
end;
$$;
revoke all on function public.chips_settled_retention_cutoff(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.chips_settled_retention_cutoff(timestamptz) to chips_ledger_archive_pruner;

-- objects_expired_at is set once, by the expiry function only, for a pruned
-- committed batch that no escrow retirement still needs. An expired batch
-- never receives a new account-retirement receipt (and its recovery object).
create function public.chips_guard_archive_objects_expiry()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  call_stack text;
begin
  get diagnostics call_stack = pg_context;
  if new.objects_expired_at is distinct from old.objects_expired_at then
    if old.objects_expired_at is not null or new.objects_expired_at is null
      or current_user <> 'chips_ledger_archive_pruner'
      or coalesce(pg_catalog.current_setting('chips.settled_retention_12m', true), '') <> '1'
      or pg_catalog.strpos(call_stack, 'chips_expire_archive_batch') <= 0
      or new.status <> 'committed' or new.pruned_at is null or new.last_created_at is null
      or (new.bot_only_table_id is not null and new.account_retirement_at is null) then
      raise exception using errcode = 'P8958', message = 'Archive objects expiry requires the settled retention function and an eligible batch';
    end if;
  end if;
  if old.objects_expired_at is not null and (
    new.account_retirement_at is distinct from old.account_retirement_at
    or new.account_retirement_recovery_object_path is distinct from old.account_retirement_recovery_object_path) then
    raise exception using errcode = 'P8958', message = 'An expired archive batch cannot receive an account-retirement receipt';
  end if;
  return new;
end;
$$;
revoke all on function public.chips_guard_archive_objects_expiry() from public, anon, authenticated, service_role;
create trigger chips_ledger_archive_batches_objects_expiry_guard
  before update on public.chips_ledger_archive_batches
  for each row execute function public.chips_guard_archive_objects_expiry();

grant update (objects_expired_at) on public.chips_ledger_archive_batches to chips_ledger_archive_pruner;
grant select (id) on public.poker_tables to chips_ledger_archive_pruner;

-- Marks one batch whose Storage objects were already deleted by the caller and
-- deletes its archived idempotency rows (D1). Dry-run (p_execute false) only
-- checks eligibility. A canary needs the exact confirmation; otherwise the
-- control must be enabled.
create function public.chips_expire_archive_batch(
  p_project_ref text, p_batch_id bigint, p_cutoff timestamptz, p_execute boolean, p_confirmation text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  cutoff timestamptz := public.chips_settled_retention_cutoff(p_cutoff);
  enabled boolean;
  deleted bigint;
begin
  select * into batch from public.chips_ledger_archive_batches where batch_id = p_batch_id for update;
  if not found or batch.project_ref is distinct from p_project_ref then
    return jsonb_build_object('state', 'not_found', 'batch_id', p_batch_id);
  end if;
  if batch.objects_expired_at is not null then
    return jsonb_build_object('state', 'already_expired', 'batch_id', p_batch_id);
  end if;
  -- A closed-human batch still needs its archive until WS removed the table,
  -- which happens only after the lifecycle completion marker.
  if batch.status <> 'committed' or batch.pruned_at is null or batch.last_created_at is null
    or batch.last_created_at >= cutoff
    or (batch.bot_only_table_id is not null and batch.account_retirement_at is null)
    or (batch.source_policy_id in ('stage-ledger-closed-human-table-retention-30d-v1', 'production-ledger-closed-human-table-retention-30d-v1')
      and exists (select 1 from public.chips_transaction_idempotency r join public.poker_tables t on t.id = r.table_id
        where r.archive_batch_id = batch.batch_id)) then
    return jsonb_build_object('state', 'not_eligible', 'batch_id', p_batch_id);
  end if;
  if not p_execute then
    return jsonb_build_object('state', 'eligible', 'batch_id', p_batch_id);
  end if;
  select c.enabled into enabled from public.chips_settled_retention_control c where c.control_id;
  if p_confirmation is distinct from ('EXPIRE ARCHIVE ' || p_batch_id::text) and enabled is not true then
    raise exception using errcode = 'P8959', message = 'Archive expiry requires the enabled control or the exact canary confirmation';
  end if;
  perform pg_catalog.set_config('chips.settled_retention_12m', '1', true);
  update public.chips_ledger_archive_batches set objects_expired_at = pg_catalog.clock_timestamp()
    where batch_id = p_batch_id;
  perform pg_catalog.set_config('chips.settled_retention_12m', '', true);
  -- Reuses the pruner-only registry DELETE gate of chips_guard_idempotency_mutations.
  perform pg_catalog.set_config('chips.bot_registry_cleanup', '1', true);
  delete from public.chips_transaction_idempotency where archive_batch_id = p_batch_id;
  get diagnostics deleted = row_count;
  perform pg_catalog.set_config('chips.bot_registry_cleanup', '', true);
  return jsonb_build_object('state', 'expired', 'batch_id', p_batch_id, 'registry_deleted', deleted);
end;
$$;
alter function public.chips_expire_archive_batch(text, bigint, timestamptz, boolean, text) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_expire_archive_batch(text, bigint, timestamptz, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.chips_expire_archive_batch(text, bigint, timestamptz, boolean, text) to postgres;

-- Small user-linked tables (US2, D6). One shared row budget per run; counts only.
create function public.chips_settled_retention_12m_run(p_limit integer, p_cutoff timestamptz, p_execute boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cutoff timestamptz := public.chips_settled_retention_cutoff(p_cutoff);
  budget integer;
  gifts bigint := 0;
  requests bigint := 0;
  poker_requests bigint := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception using errcode = 'P8959', message = 'Settled retention limit must be 1..5000';
  end if;
  if not p_execute then
    if pg_catalog.to_regclass('public.poker_gift_purchases') is not null then
      execute 'select count(*) from public.poker_gift_purchases g where g.created_at < $1
        and not exists (select 1 from public.poker_tables t where t.id = g.table_id and t.status <> ''CLOSED'')'
        into gifts using cutoff;
    end if;
    if pg_catalog.to_regclass('public.account_deletion_requests') is not null then
      execute 'select count(*) from public.account_deletion_requests where status = ''COMPLETED'' and completed_at < $1
        and (progress <> ''{}''::jsonb or status_token_hash is not null or status_token_expires_at is not null)'
        into requests using cutoff;
    end if;
    select count(*) into poker_requests from public.poker_requests r where r.created_at < cutoff
      and not (r.kind = 'ACT' and r.result_json is null);
    return jsonb_build_object('state', 'diagnosed', 'cutoff', cutoff, 'gifts', gifts,
      'deletion_requests', requests, 'poker_requests', poker_requests);
  end if;
  if (select c.enabled from public.chips_settled_retention_control c where c.control_id) is not true then
    raise exception using errcode = 'P8959', message = 'Settled retention control is disabled';
  end if;
  budget := p_limit;
  if pg_catalog.to_regclass('public.poker_gift_purchases') is not null then
    execute 'with doomed as (select g.id from public.poker_gift_purchases g where g.created_at < $1
        and not exists (select 1 from public.poker_tables t where t.id = g.table_id and t.status <> ''CLOSED'')
        order by g.created_at limit $2 for update skip locked)
      delete from public.poker_gift_purchases g using doomed where g.id = doomed.id'
      using cutoff, budget;
    get diagnostics gifts = row_count;
    budget := budget - gifts;
  end if;
  if budget > 0 and pg_catalog.to_regclass('public.account_deletion_requests') is not null then
    execute 'with doomed as (select request_id from public.account_deletion_requests where status = ''COMPLETED''
        and completed_at < $1 and (progress <> ''{}''::jsonb or status_token_hash is not null or status_token_expires_at is not null)
        order by completed_at limit $2 for update skip locked)
      update public.account_deletion_requests r set progress = ''{}''::jsonb, status_token_hash = null, status_token_expires_at = null
        from doomed where r.request_id = doomed.request_id'
      using cutoff, budget;
    get diagnostics requests = row_count;
    budget := budget - requests;
  end if;
  if budget > 0 then
    with doomed as (
      select r.ctid from public.poker_requests r where r.created_at < cutoff
        and not (r.kind = 'ACT' and r.result_json is null)
      order by r.created_at limit budget for update skip locked
    ) delete from public.poker_requests r using doomed where r.ctid = doomed.ctid;
    get diagnostics poker_requests = row_count;
  end if;
  return jsonb_build_object('state', 'executed', 'cutoff', cutoff, 'gifts', gifts,
    'deletion_requests', requests, 'poker_requests', poker_requests);
end;
$$;
alter function public.chips_settled_retention_12m_run(integer, timestamptz, boolean) owner to postgres;
revoke all on function public.chips_settled_retention_12m_run(integer, timestamptz, boolean) from public, anon, authenticated, service_role;

commit;
