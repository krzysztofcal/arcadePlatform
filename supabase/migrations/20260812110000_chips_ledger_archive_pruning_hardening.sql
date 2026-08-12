begin;

drop index if exists public.chips_transaction_idempotency_archive_batch_idx;

create or replace function public.chips_guard_archive_batch_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_proof_count integer;
  new_proof_count integer;
  old_receipt_count integer;
  new_receipt_count integer;
  proof_changed boolean;
  receipt_changed boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'Archive batch rows are durable; DELETE is not permitted';
  end if;

  if new.object_path is distinct from old.object_path
    or new.batch_id is distinct from old.batch_id
    or new.project_ref is distinct from old.project_ref
    or new.format_version is distinct from old.format_version
    or new.cutoff is distinct from old.cutoff
    or new.cursor_start_created_at is distinct from old.cursor_start_created_at
    or new.cursor_start_id is distinct from old.cursor_start_id
    or new.cursor_end_created_at is distinct from old.cursor_end_created_at
    or new.cursor_end_id is distinct from old.cursor_end_id
    or new.first_created_at is distinct from old.first_created_at
    or new.last_created_at is distinct from old.last_created_at
    or new.transaction_count is distinct from old.transaction_count
    or new.entry_count is distinct from old.entry_count
    or new.tx_types is distinct from old.tx_types
    or new.raw_bytes is distinct from old.raw_bytes
    or new.compressed_bytes is distinct from old.compressed_bytes
    or new.raw_sha256 is distinct from old.raw_sha256
    or new.compressed_sha256 is distinct from old.compressed_sha256
    or new.credits is distinct from old.credits
    or new.debits is distinct from old.debits
    or new.net_amount is distinct from old.net_amount
    or new.created_at is distinct from old.created_at then
    raise exception 'Archive batch proof fields are immutable';
  end if;

  proof_changed := new.archived_transaction_ids_sha256 is distinct from old.archived_transaction_ids_sha256
    or new.archived_entry_ids_sha256 is distinct from old.archived_entry_ids_sha256
    or new.archive_proof_verified_at is distinct from old.archive_proof_verified_at;
  receipt_changed := new.pruned_at is distinct from old.pruned_at
    or new.pruned_transaction_count is distinct from old.pruned_transaction_count
    or new.pruned_entry_count is distinct from old.pruned_entry_count
    or new.pruned_transaction_ids_sha256 is distinct from old.pruned_transaction_ids_sha256
    or new.pruned_entry_ids_sha256 is distinct from old.pruned_entry_ids_sha256;

  if proof_changed and receipt_changed then
    raise exception 'Archive proof and prune receipt require separate transitions';
  end if;
  if proof_changed and current_user <> 'chips_ledger_archive_pruner' then
    raise exception 'Archive ID proof may only be written by the archive pruner';
  end if;
  if receipt_changed and current_user <> 'chips_ledger_archive_pruner' then
    raise exception 'Archive prune receipt may only be written by the archive pruner';
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'pending' or new.status <> 'committed'
      or old.committed_at is not null or new.committed_at is null then
      raise exception 'Archive batch status may only transition pending to committed';
    end if;
  elsif new.committed_at is distinct from old.committed_at then
    raise exception 'Archive batch committed_at is immutable';
  end if;

  old_proof_count := pg_catalog.num_nonnulls(
    old.archived_transaction_ids_sha256,
    old.archived_entry_ids_sha256,
    old.archive_proof_verified_at
  );
  new_proof_count := pg_catalog.num_nonnulls(
    new.archived_transaction_ids_sha256,
    new.archived_entry_ids_sha256,
    new.archive_proof_verified_at
  );
  if old_proof_count = 0 then
    if new_proof_count not in (0, 3) then
      raise exception 'Archive ID proof must transition from empty to complete';
    end if;
    if new_proof_count = 3 and new.status <> 'committed' then
      raise exception 'Archive ID proof requires a committed batch';
    end if;
  elsif proof_changed then
    raise exception 'Archive ID proof cannot be replaced or cleared';
  end if;

  old_receipt_count := pg_catalog.num_nonnulls(
    old.pruned_at,
    old.pruned_transaction_count,
    old.pruned_entry_count,
    old.pruned_transaction_ids_sha256,
    old.pruned_entry_ids_sha256
  );
  new_receipt_count := pg_catalog.num_nonnulls(
    new.pruned_at,
    new.pruned_transaction_count,
    new.pruned_entry_count,
    new.pruned_transaction_ids_sha256,
    new.pruned_entry_ids_sha256
  );
  if old_receipt_count = 0 then
    if new_receipt_count not in (0, 5) then
      raise exception 'Archive prune receipt must transition from empty to complete';
    end if;
    if new_receipt_count = 5 and new_proof_count <> 3 then
      raise exception 'Archive prune receipt requires an immutable ID proof';
    end if;
  elsif receipt_changed then
    raise exception 'Archive prune receipt cannot be replaced or cleared';
  end if;

  return new;
end;
$$;

create or replace function public.chips_guard_idempotency_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Idempotency registry rows are durable; DELETE is not permitted';
  end if;

  if new.idempotency_key is distinct from old.idempotency_key
    or new.transaction_id is distinct from old.transaction_id
    or new.payload_hash is distinct from old.payload_hash
    or new.tx_type is distinct from old.tx_type
    or new.user_id is distinct from old.user_id
    or new.transaction_created_at is distinct from old.transaction_created_at
    or new.created_at is distinct from old.created_at then
    raise exception 'Idempotency registry identity is immutable';
  end if;

  if old.replay_transaction is not null
    or old.replay_entries is not null
    or old.replay_completed_at is not null then
    if new.replay_transaction is distinct from old.replay_transaction
      or new.replay_entries is distinct from old.replay_entries
      or new.replay_completed_at is distinct from old.replay_completed_at then
      raise exception 'Completed idempotency replay cannot be replaced or cleared';
    end if;
  elsif not (
    new.replay_transaction is null
    and new.replay_entries is null
    and new.replay_completed_at is null
  ) and not (
    new.replay_transaction is not null
    and new.replay_entries is not null
    and new.replay_completed_at is not null
  ) then
    raise exception 'Idempotency replay must transition from empty to complete';
  end if;

  if new.archive_batch_id is distinct from old.archive_batch_id then
    if current_user <> 'chips_ledger_archive_pruner' then
      raise exception 'Idempotency archive mapping may only be written by the archive pruner';
    end if;
    if old.archive_batch_id is not null then
      raise exception 'Idempotency archive mapping cannot be replaced or cleared';
    end if;
  end if;

  return new;
end;
$$;

grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

alter function public.chips_prune_committed_archive_batch(text, uuid[], bigint[], boolean)
  rename to chips_prune_committed_archive_batch_internal;
alter function public.chips_prune_committed_archive_batch_internal(text, uuid[], bigint[], boolean)
  strict;

revoke all on function public.chips_prune_committed_archive_batch_internal(text, uuid[], bigint[], boolean)
  from public, anon, authenticated, service_role, postgres;

create function public.chips_prune_committed_archive_batch(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_execute boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_execute is null then
    raise exception 'Ledger archive pruning execute flag must not be NULL';
  end if;
  return public.chips_prune_committed_archive_batch_internal(
    p_object_path,
    p_transaction_ids,
    p_entry_ids,
    p_execute is true
  );
end;
$$;

revoke all on function public.chips_prune_committed_archive_batch(text, uuid[], bigint[], boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.chips_prune_committed_archive_batch(text, uuid[], bigint[], boolean)
  to postgres;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

do $$
begin
  if pg_catalog.to_regclass('public.chips_transaction_idempotency_archive_batch_idx') is not null then
    raise exception 'Archive mapping index must be absent for the initial measurement contract';
  end if;

  if not (
    select procedures.proisstrict
      from pg_catalog.pg_proc procedures
      where procedures.oid = 'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)'::pg_catalog.regprocedure
  ) then
    raise exception 'Internal archive pruning implementation must reject NULL arguments';
  end if;

  if exists (
       select 1
         from pg_catalog.pg_proc procedures
         cross join lateral pg_catalog.aclexplode(
           coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
         ) as privileges
         where procedures.oid = 'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)'::pg_catalog.regprocedure
           and privileges.grantee = 'postgres'::pg_catalog.regrole::oid
           and privileges.privilege_type = 'EXECUTE'
     )
    or pg_catalog.has_function_privilege(
       'service_role',
       'public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean)',
       'execute'
     )
    or pg_catalog.has_function_privilege(
       'service_role',
       'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)',
       'execute'
     )
    or pg_catalog.has_function_privilege(
       'anon',
       'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)',
       'execute'
     )
    or pg_catalog.has_function_privilege(
       'authenticated',
       'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)',
       'execute'
     )
    or not exists (
       select 1
         from pg_catalog.pg_proc procedures
         cross join lateral pg_catalog.aclexplode(
           coalesce(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
         ) as privileges
         where procedures.oid = 'public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean)'::pg_catalog.regprocedure
           and privileges.grantee = 'postgres'::pg_catalog.regrole::oid
           and privileges.privilege_type = 'EXECUTE'
     ) then
    raise exception 'Archive pruning wrapper has unsafe execute privileges';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_auth_members memberships
      join pg_catalog.pg_roles granted_role on granted_role.oid = memberships.roleid
      join pg_catalog.pg_roles member_role on member_role.oid = memberships.member
      join pg_catalog.pg_roles grantor_role on grantor_role.oid = memberships.grantor
      where granted_role.rolname = 'chips_ledger_archive_pruner'
        and not (
          member_role.rolname = 'postgres'
          and grantor_role.rolname = 'supabase_admin'
          and memberships.admin_option
          and not memberships.inherit_option
          and not memberships.set_option
        )
  ) then
    raise exception 'Unsafe archive pruner membership remains';
  end if;
end;
$$;

commit;
