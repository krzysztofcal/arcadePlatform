begin;

-- Forward-only guard for the one read-only Stage freeze.  The allowlist is a
-- proof basis, not archive schema v1; changing one UUID changes this hash and
-- must be rejected by both the runner and the database.
create or replace function public.chips_assert_legacy_stage_allowlist_master_hash(
  p_master_table_ids_sha256 text
)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_master_table_ids_sha256 is distinct from
     '611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05' then
    raise exception using
      errcode = 'P8936',
      message = 'Legacy Stage master allowlist hash is not the frozen canonical hash';
  end if;
  return true;
end;
$$;

alter function public.chips_assert_legacy_stage_allowlist_master_hash(text)
  owner to postgres;

revoke all on function public.chips_assert_legacy_stage_allowlist_master_hash(text)
  from public, anon, authenticated, service_role;
grant execute on function public.chips_assert_legacy_stage_allowlist_master_hash(text)
  to postgres, chips_ledger_archive_pruner;

alter table public.chips_ledger_archive_batches
  add constraint chips_ledger_archive_batches_legacy_master_allowlist_sha256_check
  check (
    source_policy_id is distinct from 'legacy_stage_allowlist_v1'
    or public.chips_assert_legacy_stage_allowlist_master_hash(legacy_allowlist_sha256)
  );

alter table public.chips_legacy_stage_allowlist_proofs
  add constraint chips_legacy_stage_allowlist_proofs_master_allowlist_sha256_check
  check (
    public.chips_assert_legacy_stage_allowlist_master_hash(master_table_ids_sha256)
  );

commit;
