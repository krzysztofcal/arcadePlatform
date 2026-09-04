begin;

-- #923 is intentionally a schema-v1 policy: the established JSONL record
-- already carries transaction, USER/ESCROW/SYSTEM and idempotency evidence.
alter table public.chips_ledger_archive_batches
  drop constraint if exists chips_ledger_archive_batches_source_policy_check;
alter table public.chips_ledger_archive_batches
  add constraint chips_ledger_archive_batches_source_policy_check
  check (source_policy_id is null or source_policy_id in (
    'stage-ledger-auto-retention-30d-v1',
    'stage-ledger-bot-only-retention-7d-v1',
    'legacy_stage_allowlist_v1',
    'stage-ledger-closed-human-table-retention-30d-v1'
  ));

alter table public.poker_tables
  add column if not exists human_retention_complete_at timestamptz;

create table public.chips_stage_closed_human_table_retention_policy (
  policy_id text primary key check (policy_id = 'stage-ledger-closed-human-table-retention-30d-v1'),
  enabled boolean not null default false,
  canary_batch_id bigint references public.chips_ledger_archive_batches(batch_id) on delete restrict,
  canary_confirmation text,
  activated_at timestamptz,
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  updated_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  check ((canary_batch_id is null and canary_confirmation is null)
    or canary_confirmation = 'GO ' || canary_batch_id::text),
  check ((enabled is false and activated_at is null)
    or (enabled is true and activated_at is not null and canary_batch_id is not null))
);
insert into public.chips_stage_closed_human_table_retention_policy (policy_id)
values ('stage-ledger-closed-human-table-retention-30d-v1');
alter table public.chips_stage_closed_human_table_retention_policy enable row level security;
revoke all on public.chips_stage_closed_human_table_retention_policy from public, anon, authenticated, service_role;
grant select on public.chips_stage_closed_human_table_retention_policy to chips_ledger_archive_pruner;

-- Completion is derived from the full durable registry set, not merely hot
-- rows. Historical generic-30d mappings are compatible only when their
-- committed proof and complete prune receipt remain verifiable.
create or replace function public.chips_assert_closed_human_table_lifecycle_gate(
  p_table_id uuid, p_cutoff timestamptz, p_current_batch_id bigint default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  bad_count bigint;
begin
  if p_table_id is null or p_cutoff is null then
    raise exception using errcode = 'P9230', message = 'Human retention gate arguments are required';
  end if;
  if not exists (
    select 1 from public.poker_tables t
     join public.chips_accounts a on a.account_type::text = 'ESCROW'
       and a.system_key = 'POKER_TABLE:' || t.id::text and a.status::text = 'active' and a.balance = 0
     join public.poker_state s on s.table_id = t.id and jsonb_typeof(s.state) = 'object'
       and s.state ->> 'phase' = 'HAND_DONE' and s.state ->> 'handId' = ''
    where t.id = p_table_id and upper(t.status::text) = 'CLOSED' and t.has_human_participant is true
      and not exists (select 1 from public.poker_requests r where r.table_id = t.id and r.result_json is null)
  ) then raise exception using errcode = 'P9231', message = 'Human table terminal lifecycle is incomplete'; end if;

  select count(*) into bad_count
    from public.chips_transaction_idempotency r
    left join public.chips_ledger_archive_batches b on b.batch_id = r.archive_batch_id
   where r.table_id = p_table_id and r.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and (r.transaction_created_at >= p_cutoff
       or (r.archive_batch_id is null and p_current_batch_id is null)
       or (r.archive_batch_id is not null and not (
         b.status = 'committed' and b.archive_proof_verified_at is not null and b.pruned_at is not null
         and b.pruned_transaction_count = b.transaction_count and b.pruned_entry_count = b.entry_count
         and b.pruned_transaction_ids_sha256 = b.archived_transaction_ids_sha256
         and b.pruned_entry_ids_sha256 = b.archived_entry_ids_sha256
         and b.source_policy_id in ('stage-ledger-auto-retention-30d-v1', 'stage-ledger-closed-human-table-retention-30d-v1')
       )));
  if bad_count <> 0 then raise exception using errcode = 'P9232', message = 'Human TABLE identity set is incomplete, young, or incompatible'; end if;
end;
$$;
alter function public.chips_assert_closed_human_table_lifecycle_gate(uuid, timestamptz, bigint) owner to postgres;
revoke all on function public.chips_assert_closed_human_table_lifecycle_gate(uuid, timestamptz, bigint) from public, anon, authenticated, service_role;
grant execute on function public.chips_assert_closed_human_table_lifecycle_gate(uuid, timestamptz, bigint) to chips_ledger_archive_pruner;

create or replace function public.chips_guard_human_retention_marker()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.human_retention_complete_at is distinct from old.human_retention_complete_at then
    if old.human_retention_complete_at is not null or new.human_retention_complete_at is null
      or current_user <> 'chips_ledger_archive_pruner'
      or coalesce(pg_catalog.current_setting('chips.closed_human_lifecycle', true), '') <> '1' then
      raise exception using errcode = 'P9233', message = 'Human retention marker is immutable and lifecycle-controlled';
    end if;
  end if;
  return new;
end;
$$;
alter function public.chips_guard_human_retention_marker() owner to postgres;
drop trigger if exists poker_tables_guard_human_retention_marker on public.poker_tables;
create trigger poker_tables_guard_human_retention_marker
before update of human_retention_complete_at on public.poker_tables
for each row execute function public.chips_guard_human_retention_marker();

create or replace function public.chips_complete_closed_human_table_retention(
  p_table_id uuid, p_cutoff timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.chips_assert_archive_prune_stage();
  perform public.chips_assert_closed_human_table_lifecycle_gate(p_table_id, p_cutoff, null);
  perform pg_catalog.set_config('chips.closed_human_lifecycle', '1', true);
  update public.poker_tables
     set human_retention_complete_at = coalesce(human_retention_complete_at, pg_catalog.timezone('utc', pg_catalog.now()))
   where id = p_table_id and human_retention_complete_at is null;
  return pg_catalog.jsonb_build_object('state', 'human_retention_complete', 'table_id', p_table_id);
end;
$$;
alter function public.chips_complete_closed_human_table_retention(uuid, timestamptz) owner to postgres;
revoke all on function public.chips_complete_closed_human_table_retention(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.chips_complete_closed_human_table_retention(uuid, timestamptz) to chips_ledger_archive_pruner;

commit;
