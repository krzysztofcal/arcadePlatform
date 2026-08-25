begin;

-- Forward-only contracts for the two Stage policies.  Batch 13 remains an
-- immutable legacy batch with its existing GO, proof, receipt and Storage
-- paths; the run-level contract below starts at deterministic batch 2.
create table public.chips_legacy_stage_allowlist_runs (
  run_id bigint generated always as identity primary key,
  project_ref text not null check (project_ref = 'krydukthwdvccggbyjfw'),
  source_policy_id text not null check (source_policy_id = 'legacy_stage_allowlist_v1'),
  stage_system_identifier text not null check (stage_system_identifier = '7656985631720456337'),
  cutoff timestamptz not null,
  master_allowlist_sha256 text not null check (master_allowlist_sha256 = '611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05'),
  master_manifest_sha256 text not null check (master_manifest_sha256 = 'eb5593bdf5bd7f3c985373e6037a861d999413eae5076b923165c7f8147a79e7'),
  remaining_table_ids_sha256 text not null check (remaining_table_ids_sha256 = 'a7bd1aea6bfe0435609cce6ccbe78f9ba55cab062e3cf55fd933fade5f029fc8'),
  remaining_table_count bigint not null check (remaining_table_count = 964),
  first_batch_number bigint not null check (first_batch_number = 2),
  last_batch_number bigint not null check (last_batch_number = 98),
  batch_count bigint not null check (batch_count = 97),
  plan_sha256 text not null check (plan_sha256 = 'f6521e7bb892c1ea3ddb566bed86bf7cac48cb305823c4c682957ef6db2d100b'),
  status text not null default 'authorized' check (status = 'authorized'),
  destructive_go_at timestamptz not null,
  destructive_go_confirmation text not null,
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now())
);

create unique index chips_legacy_stage_allowlist_runs_plan_idx
  on public.chips_legacy_stage_allowlist_runs (project_ref, source_policy_id, plan_sha256);

alter table public.chips_legacy_stage_allowlist_runs enable row level security;
revoke all on table public.chips_legacy_stage_allowlist_runs from public, anon, authenticated, service_role;
grant select on public.chips_legacy_stage_allowlist_runs to chips_ledger_archive_pruner;
create policy chips_legacy_stage_allowlist_runs_pruner_select
  on public.chips_legacy_stage_allowlist_runs
  for select to chips_ledger_archive_pruner
  using (true);

create or replace function public.chips_legacy_stage_allowlist_run_plan_sha256(
  p_version bigint,
  p_policy_id text,
  p_project_ref text,
  p_system_identifier text,
  p_cutoff timestamptz,
  p_master_allowlist_sha256 text,
  p_master_manifest_sha256 text,
  p_remaining_table_ids_sha256 text,
  p_remaining_table_count bigint,
  p_first_batch_number bigint,
  p_last_batch_number bigint,
  p_batch_count bigint
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.concat_ws(E'\n',
          p_version::text,
          p_policy_id,
          p_project_ref,
          p_system_identifier,
          pg_catalog.to_char(p_cutoff at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          p_master_allowlist_sha256,
          p_master_manifest_sha256,
          p_remaining_table_ids_sha256,
          p_remaining_table_count::text,
          p_first_batch_number::text,
          p_last_batch_number::text,
          p_batch_count::text
        ) || E'\n',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

alter function public.chips_legacy_stage_allowlist_run_plan_sha256(
  bigint, text, text, text, timestamptz, text, text, text, bigint, bigint, bigint, bigint
) owner to postgres;
revoke all on function public.chips_legacy_stage_allowlist_run_plan_sha256(
  bigint, text, text, text, timestamptz, text, text, text, bigint, bigint, bigint, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.chips_legacy_stage_allowlist_run_plan_sha256(
  bigint, text, text, text, timestamptz, text, text, text, bigint, bigint, bigint, bigint
) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_authorize_legacy_stage_allowlist_run(
  p_confirmation text,
  p_master_allowlist_sha256 text,
  p_master_manifest_sha256 text,
  p_remaining_table_ids_sha256 text,
  p_cutoff timestamptz,
  p_first_batch_number bigint,
  p_last_batch_number bigint,
  p_plan_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_plan_sha256 text;
  inserted_run public.chips_legacy_stage_allowlist_runs%rowtype;
begin
  if p_master_allowlist_sha256 is distinct from '611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05'
     or p_master_manifest_sha256 is distinct from 'eb5593bdf5bd7f3c985373e6037a861d999413eae5076b923165c7f8147a79e7'
     or p_remaining_table_ids_sha256 is distinct from 'a7bd1aea6bfe0435609cce6ccbe78f9ba55cab062e3cf55fd933fade5f029fc8'
     or p_cutoff is distinct from '2026-08-17T16:51:28.074Z'::timestamptz
     or p_first_batch_number is distinct from 2
     or p_last_batch_number is distinct from 98 then
    raise exception using errcode = 'P8940', message = 'Legacy Stage remaining allowlist contract is not frozen';
  end if;
  expected_plan_sha256 := public.chips_legacy_stage_allowlist_run_plan_sha256(
    1, 'legacy_stage_allowlist_v1', 'krydukthwdvccggbyjfw', '7656985631720456337',
    p_cutoff, p_master_allowlist_sha256, p_master_manifest_sha256,
    p_remaining_table_ids_sha256, 964, 2, 98, 97
  );
  if p_plan_sha256 is distinct from expected_plan_sha256
     or p_plan_sha256 is distinct from 'f6521e7bb892c1ea3ddb566bed86bf7cac48cb305823c4c682957ef6db2d100b'
     or p_confirmation is distinct from ('GO legacy-stage-allowlist-v1 remaining 2-98 ' || p_plan_sha256) then
    raise exception using errcode = 'P8941', message = 'Exact legacy Stage remaining allowlist GO is required';
  end if;
  if exists (
    select 1 from public.chips_legacy_stage_allowlist_runs runs
     where runs.project_ref = 'krydukthwdvccggbyjfw'
       and runs.source_policy_id = 'legacy_stage_allowlist_v1'
       and runs.plan_sha256 = p_plan_sha256
  ) then
    raise exception using errcode = 'P8942', message = 'Legacy Stage remaining allowlist GO already exists';
  end if;
  insert into public.chips_legacy_stage_allowlist_runs (
    project_ref, source_policy_id, stage_system_identifier, cutoff,
    master_allowlist_sha256, master_manifest_sha256, remaining_table_ids_sha256,
    remaining_table_count, first_batch_number, last_batch_number, batch_count,
    plan_sha256, status, destructive_go_at, destructive_go_confirmation
  ) values (
    'krydukthwdvccggbyjfw', 'legacy_stage_allowlist_v1', '7656985631720456337', p_cutoff,
    p_master_allowlist_sha256, p_master_manifest_sha256, p_remaining_table_ids_sha256,
    964, 2, 98, 97, p_plan_sha256, 'authorized', pg_catalog.timezone('utc', pg_catalog.now()), p_confirmation
  ) returning * into inserted_run;
  return pg_catalog.jsonb_build_object(
    'state', 'authorized',
    'run_id', inserted_run.run_id,
    'plan_sha256', inserted_run.plan_sha256,
    'first_batch_number', inserted_run.first_batch_number,
    'last_batch_number', inserted_run.last_batch_number,
    'remaining_table_count', inserted_run.remaining_table_count
  );
end;
$$;

alter function public.chips_authorize_legacy_stage_allowlist_run(
  text, text, text, text, timestamptz, bigint, bigint, text
) owner to postgres;
revoke all on function public.chips_authorize_legacy_stage_allowlist_run(
  text, text, text, text, timestamptz, bigint, bigint, text
) from public, anon, authenticated, service_role;
grant execute on function public.chips_authorize_legacy_stage_allowlist_run(
  text, text, text, text, timestamptz, bigint, bigint, text
) to postgres;

alter table public.chips_ledger_archive_batches
  add column if not exists legacy_run_id bigint,
  add column if not exists legacy_plan_sha256 text;

alter table public.chips_ledger_archive_batches
  add constraint chips_ledger_archive_batches_legacy_run_binding_check
  check (
    (source_policy_id is distinct from 'legacy_stage_allowlist_v1'
      and legacy_run_id is null
      and legacy_plan_sha256 is null)
    or (source_policy_id = 'legacy_stage_allowlist_v1'
      and ((legacy_run_id is null and legacy_plan_sha256 is null)
        or (legacy_run_id is not null and legacy_plan_sha256 ~ '^[0-9a-f]{64}$')))
  );

create or replace function public.chips_guard_legacy_stage_allowlist_run_binding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.legacy_run_id is distinct from old.legacy_run_id
     or new.legacy_plan_sha256 is distinct from old.legacy_plan_sha256 then
    raise exception using errcode = 'P8943', message = 'Legacy Stage orchestration binding is immutable';
  end if;
  return new;
end;
$$;

alter function public.chips_guard_legacy_stage_allowlist_run_binding() owner to postgres;
revoke all on function public.chips_guard_legacy_stage_allowlist_run_binding() from public, anon, authenticated, service_role;
drop trigger if exists chips_ledger_archive_batches_legacy_run_binding_guard on public.chips_ledger_archive_batches;
create trigger chips_ledger_archive_batches_legacy_run_binding_guard
before update on public.chips_ledger_archive_batches
for each row execute function public.chips_guard_legacy_stage_allowlist_run_binding();

create index chips_ledger_archive_batches_legacy_run_idx
  on public.chips_ledger_archive_batches (legacy_run_id, legacy_plan_sha256, legacy_batch_number);

-- The orchestrated wrapper is the only path that may turn the one run-level
-- GO into per-batch receipt authorization.  Batch 13 never has a run binding
-- and therefore cannot be touched by this wrapper.
create or replace function public.chips_prune_legacy_stage_allowlist_orchestrated_batch(
  p_run_id bigint,
  p_plan_sha256 text,
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_batch_table_ids uuid[],
  p_allowlist_sha256 text,
  p_batch_table_ids_sha256 text,
  p_registry_keys text[],
  p_execute boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.chips_legacy_stage_allowlist_runs%rowtype;
  batch public.chips_ledger_archive_batches%rowtype;
  result jsonb;
begin
  select runs.* into run_row
    from public.chips_legacy_stage_allowlist_runs runs
   where runs.run_id = p_run_id
     and runs.status = 'authorized'
     and runs.plan_sha256 = p_plan_sha256
     and runs.project_ref = 'krydukthwdvccggbyjfw'
   for share;
  if not found then
    raise exception using errcode = 'P8944', message = 'Authorized legacy Stage orchestration run is missing or differs';
  end if;
  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.object_path = p_object_path
   for update;
  if not found
     or batch.source_policy_id <> 'legacy_stage_allowlist_v1'
     or batch.legacy_run_id is distinct from run_row.run_id
     or batch.legacy_plan_sha256 is distinct from run_row.plan_sha256
     or batch.legacy_batch_number < run_row.first_batch_number
     or batch.legacy_batch_number > run_row.last_batch_number
     or batch.legacy_allowlist_sha256 is distinct from run_row.master_allowlist_sha256 then
    raise exception using errcode = 'P8945', message = 'Legacy batch is outside the exact authorized orchestration run';
  end if;
  if not p_execute then
    return public.chips_prune_legacy_stage_allowlist_batch(
      p_object_path, p_transaction_ids, p_entry_ids, p_batch_table_ids,
      p_allowlist_sha256, p_batch_table_ids_sha256, p_registry_keys, false, null
    );
  end if;
  perform pg_catalog.set_config('chips.bot_only_go', '1', true);
  if batch.destructive_go_at is null and batch.destructive_go_batch_id is not null then
    raise exception using errcode = 'P8946', message = 'Legacy batch has a partial destructive GO';
  elsif batch.destructive_go_at is null then
    update public.chips_ledger_archive_batches batches
       set destructive_go_at = pg_catalog.timezone('utc', pg_catalog.now()),
           destructive_go_batch_id = batch.batch_id
     where batches.batch_id = batch.batch_id
       and batches.destructive_go_at is null;
  elsif batch.destructive_go_batch_id is distinct from batch.batch_id then
    raise exception using errcode = 'P8946', message = 'Legacy batch has a partial or foreign destructive GO';
  end if;
  result := public.chips_prune_legacy_stage_allowlist_batch(
    p_object_path, p_transaction_ids, p_entry_ids, p_batch_table_ids,
    p_allowlist_sha256, p_batch_table_ids_sha256, p_registry_keys, true, batch.batch_id
  );
  return result || pg_catalog.jsonb_build_object(
    'orchestration_run_id', run_row.run_id,
    'orchestration_plan_sha256', run_row.plan_sha256
  );
end;
$$;

alter function public.chips_prune_legacy_stage_allowlist_orchestrated_batch(
  bigint, text, text, uuid[], bigint[], uuid[], text, text, text[], boolean
) owner to postgres;
revoke all on function public.chips_prune_legacy_stage_allowlist_orchestrated_batch(
  bigint, text, text, uuid[], bigint[], uuid[], text, text, text[], boolean
) from public, anon, authenticated, service_role;
grant execute on function public.chips_prune_legacy_stage_allowlist_orchestrated_batch(
  bigint, text, text, uuid[], bigint[], uuid[], text, text, text[], boolean
) to postgres, chips_ledger_archive_pruner;

create table public.chips_stage_bot_only_retention_policy (
  policy_id text primary key check (policy_id = 'stage-ledger-bot-only-retention-7d-v1'),
  enabled boolean not null default false,
  activation_go_at timestamptz,
  activation_confirmation text,
  canary_batch_id bigint,
  activated_at timestamptz,
  updated_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  check ((enabled = false and activation_go_at is null and activation_confirmation is null and activated_at is null)
    or (enabled = true and activation_go_at is not null and activation_confirmation is not null and activated_at is not null))
);

insert into public.chips_stage_bot_only_retention_policy (policy_id)
values ('stage-ledger-bot-only-retention-7d-v1');

alter table public.chips_stage_bot_only_retention_policy enable row level security;
revoke all on table public.chips_stage_bot_only_retention_policy from public, anon, authenticated, service_role;
grant select on public.chips_stage_bot_only_retention_policy to chips_ledger_archive_pruner;
create policy chips_stage_bot_only_retention_policy_pruner_select
  on public.chips_stage_bot_only_retention_policy
  for select to chips_ledger_archive_pruner
  using (true);

create or replace function public.chips_guard_stage_bot_only_retention_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'postgres'
     or pg_catalog.current_setting('chips.bot_only_policy_activation', true) <> '1'
     or new.policy_id is distinct from old.policy_id
     or old.enabled is true then
    raise exception using errcode = 'P8950', message = 'Automatic bot-only Stage policy activation is owner-controlled and one-time';
  end if;
  return new;
end;
$$;

alter function public.chips_guard_stage_bot_only_retention_policy() owner to postgres;
revoke all on function public.chips_guard_stage_bot_only_retention_policy() from public, anon, authenticated, service_role;
create trigger chips_stage_bot_only_retention_policy_guard
before update on public.chips_stage_bot_only_retention_policy
for each row execute function public.chips_guard_stage_bot_only_retention_policy();

create or replace function public.chips_bot_only_retention_automatic_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select enabled from public.chips_stage_bot_only_retention_policy
                    where policy_id = 'stage-ledger-bot-only-retention-7d-v1'), false);
$$;

alter function public.chips_bot_only_retention_automatic_active() owner to postgres;
revoke all on function public.chips_bot_only_retention_automatic_active() from public, anon, authenticated, service_role;
grant execute on function public.chips_bot_only_retention_automatic_active() to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_activate_bot_only_retention_policy(
  p_canary_batch_id bigint,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  canary public.chips_ledger_archive_batches%rowtype;
begin
  if p_confirmation is distinct from ('ACTIVATE stage-ledger-bot-only-retention-7d-v1 CANARY ' || p_canary_batch_id::text) then
    raise exception using errcode = 'P8951', message = 'Exact Stage bot-only automatic activation confirmation is required';
  end if;
  select batches.* into canary
    from public.chips_ledger_archive_batches batches
   where batches.batch_id = p_canary_batch_id
   for share;
  if not found
     or canary.project_ref <> 'krydukthwdvccggbyjfw'
     or canary.format_version <> 2
     or canary.source_policy_id <> 'stage-ledger-bot-only-retention-7d-v1'
     or canary.status <> 'committed'
     or canary.archive_proof_verified_at is null
     or canary.pruned_at is null
     or canary.registry_cleaned_at is null
     or canary.destructive_go_at is null
     or canary.destructive_go_batch_id is distinct from canary.batch_id then
    raise exception using errcode = 'P8952', message = 'Automatic Stage policy requires a complete exact bot-only canary';
  end if;
  perform pg_catalog.set_config('chips.bot_only_policy_activation', '1', true);
  update public.chips_stage_bot_only_retention_policy policy
     set enabled = true,
         activation_go_at = pg_catalog.timezone('utc', pg_catalog.now()),
         activation_confirmation = p_confirmation,
         canary_batch_id = p_canary_batch_id,
         activated_at = pg_catalog.timezone('utc', pg_catalog.now()),
         updated_at = pg_catalog.timezone('utc', pg_catalog.now())
   where policy.policy_id = 'stage-ledger-bot-only-retention-7d-v1'
     and policy.enabled is false;
  if not found then
    raise exception using errcode = 'P8953', message = 'Automatic Stage policy is already active';
  end if;
  return pg_catalog.jsonb_build_object('state', 'active', 'policy_id', 'stage-ledger-bot-only-retention-7d-v1', 'canary_batch_id', p_canary_batch_id);
end;
$$;

alter function public.chips_activate_bot_only_retention_policy(bigint, text) owner to postgres;
revoke all on function public.chips_activate_bot_only_retention_policy(bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.chips_activate_bot_only_retention_policy(bigint, text) to postgres;

-- Automatic cleanup has no human GO input.  It is still Stage-only, policy
-- gated, fenced, proof-bound and receipt-bound; the wrapper creates the
-- immutable per-batch GO fields solely from the one-time activation.
create or replace function public.chips_auto_prune_and_cleanup_bot_only_archive_batch(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_registry_keys text[],
  p_table_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  result jsonb;
begin
  if not public.chips_bot_only_retention_automatic_active() then
    raise exception using errcode = 'P8954', message = 'Automatic bot-only Stage retention is not active';
  end if;
  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.object_path = p_object_path
   for update;
  if not found
     or batch.project_ref <> 'krydukthwdvccggbyjfw'
     or batch.format_version <> 2
     or batch.source_policy_id <> 'stage-ledger-bot-only-retention-7d-v1'
     or batch.bot_only_table_id is distinct from p_table_id then
    raise exception using errcode = 'P8955', message = 'Automatic cleanup target is not a canonical Stage bot-only batch';
  end if;
  if batch.destructive_go_at is null and batch.destructive_go_batch_id is not null then
    raise exception using errcode = 'P8956', message = 'Automatic bot-only batch has a partial GO';
  elsif batch.destructive_go_at is null then
    perform pg_catalog.set_config('chips.bot_only_go', '1', true);
    update public.chips_ledger_archive_batches batches
       set destructive_go_at = pg_catalog.timezone('utc', pg_catalog.now()),
           destructive_go_batch_id = batch.batch_id
     where batches.batch_id = batch.batch_id
       and batches.destructive_go_at is null;
  elsif batch.destructive_go_batch_id is distinct from batch.batch_id then
    raise exception using errcode = 'P8956', message = 'Automatic bot-only batch has a partial or foreign GO';
end if;
 perform pg_catalog.set_config('chips.legacy_stage_cleanup', '1', true);
result := public.chips_prune_and_cleanup_bot_only_archive_batch(
  p_object_path, p_transaction_ids, p_entry_ids, p_registry_keys, p_table_id, true, batch.batch_id
);
  return result || pg_catalog.jsonb_build_object('automatic_policy', 'stage-ledger-bot-only-retention-7d-v1');
end;
$$;

alter function public.chips_auto_prune_and_cleanup_bot_only_archive_batch(text, uuid[], bigint[], text[], uuid)
  owner to postgres;
revoke all on function public.chips_auto_prune_and_cleanup_bot_only_archive_batch(text, uuid[], bigint[], text[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.chips_auto_prune_and_cleanup_bot_only_archive_batch(text, uuid[], bigint[], text[], uuid)
  to postgres, chips_ledger_archive_pruner;

commit;
