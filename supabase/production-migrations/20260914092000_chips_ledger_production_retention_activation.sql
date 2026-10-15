begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
-- E3 is NEVER applied by PR/CI/merge. Operator supplies reviewed Storage
-- attestation only after private GET/byte/SHA checks; SQL validates DB only.
do $identity$
begin
 if (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from '7575202818581710058'
 or current_user <> 'postgres'
 or current_setting('chips.production_project_ref', true) is distinct from 'otbqfijerkieoxwpxjnm' then
  raise exception 'E3 requires owner and canonical Production identity';
 end if;
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm',0)) then
  raise exception 'E3 Production advisory lock is busy';
 end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20260914090000')
 or not exists(select 1 from supabase_migrations.schema_migrations where version='20260914091000') then
  raise exception 'E3 requires applied E1/E2';
 end if;
end;
$identity$;

-- Fail closed on preflight-to-DDL contract drift. Fingerprints cover existing
-- methods being replaced and their critical lifecycle dependencies. Identity
-- normalization is only for the existing disposable PostgreSQL test fixture.
do $catalog$
declare expected jsonb; item record; actual text;
begin
 expected := case when exists(select 1 from supabase_migrations.schema_migrations where version='20260914092000')
 then $after${
  "public.chips_assert_production_retention_control(text,bigint,boolean)": "34aa855acc433f96976673b652b5a530cc82917f2060368589a6bd60aec8d947",
  "public.chips_set_production_retention_enabled(boolean,integer,text)": "1e4ef124ac7427b3b1d09fa310d95663f4f641eb825cf19b8c661e02b006e65c",
  "public.chips_table_fence_is_active()": "79f16fb31704e97d70a544d4e79afc703e5ac4b9bccba5c4f3c8d61c395b9d42",
  "public.chips_guard_archive_batch_mutations()": "7af57da3eb6ee47a7a5a12449cc69d50524087597455a7babba5c35960dacbae",
  "public.chips_assert_archive_prune_target(text,bigint)": "ffac8f9ad0cd0286adfd36abcd6021e3a50c73ccb5b71b75f16cd5536396fab1",
  "public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric)": "b84e71af77bbac3dda3e0f57a385e881c1cbaaf40f09aac5a583028800bb5e0e",
  "public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)": "17c5a888ba30aae70afe7503071b607e7ab64a18c6a37b2c6e8cfb6f9ddf7871",
  "public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean)": "65ba7b645b18014c76839171947831afc5712df2e413e7332d4cf50176c5ae53",
  "public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamp with time zone,uuid[],text[])": "62a272d415a10ffb3e1743701f334207e019e4c0669d8c7f56f41b6e8197a019",
  "public.chips_register_bot_only_archive_proof(text,uuid[],bigint[],uuid,text[],text)": "daf6558c956b456972803c3f0569e73300f8411c76c6f24902e9fd7108ba7a8a",
  "public.chips_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid,boolean,bigint)": "82f3758e38b9ea25ec0ecf144b193d34ca12a3548adb667e085bec2d00ce1703",
  "public.chips_assert_closed_human_table_lifecycle_gate(uuid,timestamp with time zone,bigint)": "acdfb054abff03c1f820770ef29574e77360f4bfe5c2e3c4622bdaef41bd6a65",
  "public.chips_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid,boolean,bigint)": "e8f729f6732f389e2ec993eeab80c0a2e888d78fedab31f97b72975a1519e9e7",
  "public.chips_guard_human_retention_marker()": "40a77a77a211596de75dfdff2a3650d375c80c849416eac714506154aff6d712",
  "public.chips_complete_closed_human_table_retention(uuid,timestamptz)": "398f459c1f5a684bcbf7b8b4d774b5e3d9acb04b84cd63fcbfd54485b8b719c0",
  "public.chips_retire_production_escrow_accounts(bigint,uuid[],text,text,text,boolean,text)": "251b96819aa427dccbf7eddb56995cf6f9696aa8c5b825849bc2f4168d497551",
  "public.chips_auto_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid)": "1f92c2b6052146f7245a161cd418e66b8110769667696c124cef3bb821c88268",
  "public.chips_auto_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid)": "562aa1a98c55c2be615d2158729832a349d9e61b8a630289a6890e72057faa62",
  "public.chips_assert_production_retention_control(text,bigint,boolean,boolean)": "c9b8b9ff8fb6e44e2ba517f5a3f4b83dfdd434c155f9517d8bb357d1c86b51d4",
  "public.chips_assert_archive_prune_target(text,bigint,text,boolean)": "82a0f5650a8961e9b12f6156485e4bb0542366dfe7a83ee5459167ae519669fa",
  "public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric,boolean)": "1e0b348fb2033843f4a907bb27e96bb624cc41fd7ff517a527ae7e626db69525",
  "public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean,boolean)": "705d34a3b9e61251a2c6723d10152c04b8a6159ac80dee7c2c6f2f1bc3657adf",
  "public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean,boolean)": "969022c3a294a6be1da297f29969083a786e49850360c74c147d25e98a18213e",
  "public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamp with time zone,uuid[],text[],boolean)": "3792a6c210e6ae7d1d9d0bba33a9943c82169d5b04d72d1c83eb845020ea7561",
  "public.chips_register_bot_only_archive_proof(text,uuid[],bigint[],uuid,text[],text,boolean)": "ca814b6c162041337d46d9b6434d9c86199b071ce1c6ef9af5ffb1b29009192f",
  "public.chips_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid,boolean,bigint,boolean)": "96efa94f084f7e40ca3ee00a2f227020090d24e86c0e9fb0f1cd138db5dbf03b",
  "public.chips_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid,boolean,bigint,boolean)": "0b71525ee7d61e20f2d020295e569fcec62ddc47ffd35728af96d400ca5f6e6c",
  "public.chips_auto_prune_production_existing_30d_archive_batch(text,uuid[],bigint[])": "dce126a7ccfca7ebd22f816e339d7b6d3e2f61bfbc2d46ea349d38378ad0cf1a",
  "public.chips_activate_production_retention(text,text,timestamptz)": "0b6decd982420842e8ae6f94bfdbc12576396832cb68044e88e3f58d384baf71"
}$after$::jsonb
 else $before${
  "public.chips_assert_production_retention_control(text,bigint,boolean)": "51bd8a947ef47ff98f1c97530ea9c6773b35e47fb164594dfb285ff548caeb37",
  "public.chips_set_production_retention_enabled(boolean,integer,text)": "b29dc72c7e224a0fb0d040079cf4fc336039cc65bd20edba71de644033e66c0c",
  "public.chips_table_fence_is_active()": "79f16fb31704e97d70a544d4e79afc703e5ac4b9bccba5c4f3c8d61c395b9d42",
  "public.chips_guard_archive_batch_mutations()": "09da4d727aaaf195100bcb1c97df80d76d726aa9a00cff36a3e51927cd4ff34e",
  "public.chips_assert_archive_prune_target(text,bigint)": "ffac8f9ad0cd0286adfd36abcd6021e3a50c73ccb5b71b75f16cd5536396fab1",
  "public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric)": "2eee1a2d728db25470008e93772c07c807d99853ba7cf581752b5eec1890462f",
  "public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)": "e5faa98a59a094fbc465efd383666b639e8e085a70cb0edfb34c8072c28a6458",
  "public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean)": "2225f56dfcdf4935a2a787ab5c2acb5d7de14c7b98534f4c3773a91ffc6b064a",
  "public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamp with time zone,uuid[],text[])": "e6c20f8264a6f5fd13588655b3eb78845629375c953aaa05eefd7bd1a6d8d004",
  "public.chips_register_bot_only_archive_proof(text,uuid[],bigint[],uuid,text[],text)": "e183f1c0df737a4b256ee5a8f9969f419e1a33b332cd1b24f96049c0ad286300",
  "public.chips_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid,boolean,bigint)": "1cf157cb8a30162b9cd5151725d624ee6ddde4c0a57eb8543d93ea2f3405cff2",
  "public.chips_assert_closed_human_table_lifecycle_gate(uuid,timestamp with time zone,bigint)": "acdfb054abff03c1f820770ef29574e77360f4bfe5c2e3c4622bdaef41bd6a65",
  "public.chips_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid,boolean,bigint)": "037921f26080ca4822fdfed2311c9fb55c1a0cee7b27dd38f82b5866977eb63c",
  "public.chips_guard_human_retention_marker()": "40a77a77a211596de75dfdff2a3650d375c80c849416eac714506154aff6d712",
  "public.chips_complete_closed_human_table_retention(uuid,timestamptz)": "398f459c1f5a684bcbf7b8b4d774b5e3d9acb04b84cd63fcbfd54485b8b719c0",
  "public.chips_retire_production_escrow_accounts(bigint,uuid[],text,text,text,boolean,text)": "251b96819aa427dccbf7eddb56995cf6f9696aa8c5b825849bc2f4168d497551",
  "public.chips_auto_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid)": "ad9becaa511c1bef8a059908f814e7ffbf79755bbf753dde5c92270816313b31",
  "public.chips_auto_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid)": "6397d9e49b7c80a79655056b080ff16c3c12e1d54a34444b922bc4799c606f21"
}$before$::jsonb end;
 for item in select * from jsonb_each_text(expected) loop
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.replace(p.prosrc,'7575202818581710058','<production-system-identifier>'),'UTF8'),'sha256'),'hex')
   into actual from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(item.key);
  if actual is distinct from item.value then raise exception 'E3 contract fingerprint mismatch: %',item.key; end if;
 end loop;
end;
$catalog$;

-- Supabase postgres is not a superuser. Ownership transfer needs both SET
-- membership and CREATE for the destination owner. Never overwrite a managed
-- grantor edge; only the new postgres-granted edge is removed below.
do $ddl_delegation$
begin
 if not pg_catalog.has_schema_privilege(current_user,'public','CREATE WITH GRANT OPTION')
 or not pg_catalog.has_schema_privilege('chips_ledger_archive_pruner','public','USAGE')
 or pg_catalog.has_schema_privilege('chips_ledger_archive_pruner','public','CREATE')
 or exists(select 1 from pg_catalog.pg_auth_members where roleid='chips_ledger_archive_pruner'::regrole and member='postgres'::regrole and grantor='postgres'::regrole) then
  raise exception 'E3 unexpected DDL delegation baseline';
 end if;
end;
$ddl_delegation$;
grant chips_ledger_archive_pruner to postgres with admin false, inherit true, set true granted by postgres;
grant create on schema public to chips_ledger_archive_pruner;

create or replace function public.chips_assert_production_retention_control(
 p_policy_id text, p_transaction_count bigint, p_execute boolean, p_automatic boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.chips_production_retention_control%rowtype; active boolean := false; bound integer := 2;
begin
 if session_user not in ('postgres','chips_ledger_archive_pruner')
 or (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from '7575202818581710058'
 or p_automatic is null or p_execute is null
 or p_policy_id is null or p_policy_id not in ('production-ledger-auto-retention-30d-v1','production-ledger-bot-only-retention-7d-v1','production-ledger-closed-human-table-retention-30d-v1','production-ledger-escrow-account-retention-v1') then
  raise exception 'Invalid Production retention context';
 end if;
 select * into c from public.chips_production_retention_control where control_id is true;
 if not found then raise exception 'Production retention control missing'; end if;
 if p_automatic then
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20260914092000')
  or c.enabled is not true or c.max_transactions <> 5000 or c.activated_at is null
  or c.activation_confirmation !~ '^ACTIVATE PRODUCTION RETENTION otbqfijerkieoxwpxjnm [0-9a-f]{64}$'
  or c.existing_30d_canary_batch_id is distinct from 2::bigint
  or not public.chips_table_fence_is_active() then raise exception 'Production automatic activation is not valid'; end if;
  if not exists(select 1 from pg_catalog.pg_locks where locktype='advisory' and pid=pg_catalog.pg_backend_pid() and granted and mode='ExclusiveLock'
   and classid::bigint=((pg_catalog.hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm',0)>>32)&4294967295)
   and objid::bigint=(pg_catalog.hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm',0)&4294967295)) then raise exception 'Production automatic lock is required'; end if;
  case p_policy_id
   when 'production-ledger-auto-retention-30d-v1' then active:=true;
   when 'production-ledger-bot-only-retention-7d-v1' then active:=public.chips_production_bot_only_retention_automatic_active();
   when 'production-ledger-closed-human-table-retention-30d-v1' then active:=public.chips_production_closed_human_retention_automatic_active();
   when 'production-ledger-escrow-account-retention-v1' then
    select enabled and activated_at is not null and activation_go_at is not null
     and canary_batch_id=3 and canary_account_ids_sha256='c342d5eb1395883fa642c17839a5a251438e59355ee9cba4c7f1fc6dffc0112f'
     and activation_confirmation='ACTIVATE production-ledger-escrow-account-retention-v1 CANARY 3 ACCOUNTS '||canary_account_ids_sha256
     into active from public.chips_production_escrow_account_retention_policy;
  end case;
  if active is not true then raise exception 'Exact Production automatic policy is inactive'; end if;
  bound:=case when p_policy_id='production-ledger-escrow-account-retention-v1' then 2 else 5000 end;
 end if;
 if p_transaction_count is null or p_transaction_count not between 1 and bound then raise exception 'Production effective cap exceeded'; end if;
 if p_execute and not p_automatic and c.enabled is not true and coalesce(pg_catalog.current_setting('chips.production_canary',true),'') <> '1' then
  raise exception 'Manual Production execution requires exact canary admission';
 end if;
 return pg_catalog.jsonb_build_object('max_transactions',bound,'policy_id',p_policy_id,'automatic',p_automatic);
end;
$$;

alter function public.chips_assert_production_retention_control(text,bigint,boolean,boolean) owner to postgres;
revoke all on function public.chips_assert_production_retention_control(text,bigint,boolean,boolean) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_assert_production_retention_control(text,bigint,boolean,boolean) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_assert_production_retention_control(p_policy_id text,p_transaction_count bigint,p_execute boolean)
returns jsonb language sql security definer set search_path='' as $$
 select public.chips_assert_production_retention_control(p_policy_id,p_transaction_count,p_execute,false);
$$;

alter function public.chips_assert_production_retention_control(text,bigint,boolean) owner to postgres;
revoke all on function public.chips_assert_production_retention_control(text,bigint,boolean) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_assert_production_retention_control(text,bigint,boolean) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_assert_archive_prune_target(p_project_ref text,p_transaction_count bigint,p_policy_id text,p_automatic boolean)
returns text language plpgsql security definer set search_path='' as $$
begin
 if p_project_ref is distinct from 'otbqfijerkieoxwpxjnm' then raise exception 'Production project mismatch'; end if;
 perform public.chips_assert_production_retention_control(case when p_automatic then p_policy_id else coalesce(p_policy_id,'production-ledger-auto-retention-30d-v1') end,p_transaction_count,false,p_automatic);
 return '7575202818581710058';
end;
$$;

alter function public.chips_assert_archive_prune_target(text,bigint,text,boolean) owner to postgres;
revoke all on function public.chips_assert_archive_prune_target(text,bigint,text,boolean) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_assert_archive_prune_target(text,bigint,text,boolean) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_register_archive_id_proof(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_project_ref text, p_format_version integer, p_cutoff timestamptz, p_cursor_start_created_at timestamptz, p_cursor_start_id uuid, p_cursor_end_created_at timestamptz, p_cursor_end_id uuid, p_first_created_at timestamptz, p_last_created_at timestamptz, p_tx_types jsonb, p_raw_bytes bigint, p_compressed_bytes bigint, p_raw_sha256 text, p_compressed_sha256 text, p_credits numeric, p_debits numeric, p_net_amount numeric, p_automatic boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
declare batch public.chips_ledger_archive_batches%rowtype; transaction_hash text; entry_hash text; updated_count bigint;
begin
  select * into batch from public.chips_ledger_archive_batches where object_path=p_object_path for update;
  perform public.chips_assert_archive_prune_target(p_project_ref, pg_catalog.cardinality(p_transaction_ids), batch.source_policy_id, p_automatic);
  if p_transaction_ids is null or pg_catalog.cardinality(p_transaction_ids) not between 1 and 5000 or p_entry_ids is null or pg_catalog.cardinality(p_entry_ids) < 1 then raise exception 'Production archive proof arrays are invalid'; end if;
  transaction_hash := public.chips_archive_uuid_ids_sha256(p_transaction_ids); entry_hash := public.chips_archive_bigint_ids_sha256(p_entry_ids);
  select * into batch from public.chips_ledger_archive_batches where object_path = p_object_path for update;
  if not found or batch.status <> 'committed' or batch.project_ref <> 'otbqfijerkieoxwpxjnm' then raise exception 'Archive manifest is not committed canonical Production evidence'; end if;
  if batch.object_path <> 'v1/sha256/' || p_compressed_sha256 || '.jsonl.gz' or batch.transaction_count <> pg_catalog.cardinality(p_transaction_ids) or batch.entry_count <> pg_catalog.cardinality(p_entry_ids) or batch.raw_sha256 <> p_raw_sha256 or batch.compressed_sha256 <> p_compressed_sha256 then raise exception 'Archive proof does not match committed manifest'; end if;
  if batch.archive_proof_verified_at is not null then
    if batch.archived_transaction_ids_sha256 is distinct from transaction_hash or batch.archived_entry_ids_sha256 is distinct from entry_hash then raise exception 'Committed archive already has a different immutable proof'; end if;
    return pg_catalog.jsonb_build_object('state', 'proof_exists', 'transactions', batch.transaction_count, 'entries', batch.entry_count);
  end if;
  update public.chips_ledger_archive_batches set archived_transaction_ids_sha256 = transaction_hash, archived_entry_ids_sha256 = entry_hash, archive_proof_verified_at = pg_catalog.timezone('utc', pg_catalog.now()) where batch_id = batch.batch_id and archive_proof_verified_at is null;
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then raise exception 'Archive proof transition was not unique'; end if;
  return pg_catalog.jsonb_build_object('state', 'proof_registered', 'transactions', batch.transaction_count, 'entries', batch.entry_count, 'transaction_ids_sha256', transaction_hash, 'entry_ids_sha256', entry_hash);
end;
$$;

alter function public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric,boolean) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric,boolean) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric,boolean) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_register_archive_id_proof(
  p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_project_ref text, p_format_version integer,
  p_cutoff timestamptz, p_cursor_start_created_at timestamptz, p_cursor_start_id uuid, p_cursor_end_created_at timestamptz,
  p_cursor_end_id uuid, p_first_created_at timestamptz, p_last_created_at timestamptz, p_tx_types jsonb,
  p_raw_bytes bigint, p_compressed_bytes bigint, p_raw_sha256 text, p_compressed_sha256 text,
  p_credits numeric, p_debits numeric, p_net_amount numeric
) returns jsonb language sql security definer set search_path='' as $$
 select public.chips_register_archive_id_proof(p_object_path, p_transaction_ids, p_entry_ids, p_project_ref, p_format_version, p_cutoff, p_cursor_start_created_at, p_cursor_start_id, p_cursor_end_created_at, p_cursor_end_id, p_first_created_at, p_last_created_at, p_tx_types, p_raw_bytes, p_compressed_bytes, p_raw_sha256, p_compressed_sha256, p_credits, p_debits, p_net_amount, false);
$$;

alter function public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_register_archive_id_proof(text,uuid[],bigint[],text,integer,timestamptz,timestamptz,uuid,timestamptz,uuid,timestamptz,timestamptz,jsonb,bigint,bigint,text,text,numeric,numeric,numeric) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_prune_committed_archive_batch_internal(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_execute boolean, p_automatic boolean) returns jsonb
 LANGUAGE plpgsql
 STRICT SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  transaction_ids_sha256 text;
  entry_ids_sha256 text;
  transaction_count bigint := pg_catalog.cardinality(p_transaction_ids);
  entry_count bigint := pg_catalog.cardinality(p_entry_ids);
  receipt_field_count integer;
  is_closed_human boolean;
  registry_count bigint;
  matching_mapping_count bigint;
  wrong_mapping_count bigint;
  extra_mapping_count bigint;
  hot_transaction_count bigint;
  hot_entry_count bigint;
  actual_transaction_ids uuid[];
  actual_entry_ids bigint[];
  table_ids uuid[];
  account_ids uuid[];
  invalid_marker_count bigint;
  invalid_shape_count bigint;
  identity_mismatch_count bigint;
  active_table_count bigint;
  invalid_escrow_count bigint;
  user_transaction_count bigint;
  user_entry_count bigint;
  distinct_table_count bigint;
  actual_tx_types jsonb;
  actual_credits numeric;
  actual_debits numeric;
  actual_net numeric;
  actual_first_created_at timestamptz;
  actual_last_created_at timestamptz;
  actual_cursor_end_created_at timestamptz;
  actual_cursor_end_id uuid;
  accounts_before jsonb;
  accounts_after jsonb;
  mapped_count bigint;
  deleted_entry_count bigint;
  deleted_transaction_count bigint;
  receipt_count bigint;
begin
  perform public.chips_assert_archive_prune_stage();
  if pg_catalog.current_setting('transaction_isolation') <> 'serializable' then
    raise exception 'Ledger archive pruning requires SERIALIZABLE isolation';
  end if;
  if transaction_count between 1 and 5000 is not true or entry_count < 1 then
    raise exception 'Archive prune batch size is invalid';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.unnest(p_transaction_ids) as id)
      <> (select pg_catalog.count(distinct id) from pg_catalog.unnest(p_transaction_ids) as id)
    or (select pg_catalog.count(*) from pg_catalog.unnest(p_entry_ids) as id)
      <> (select pg_catalog.count(distinct id) from pg_catalog.unnest(p_entry_ids) as id) then
    raise exception 'Archive prune batch contains duplicate IDs';
  end if;

  transaction_ids_sha256 := public.chips_archive_uuid_ids_sha256(p_transaction_ids);
  entry_ids_sha256 := public.chips_archive_bigint_ids_sha256(p_entry_ids);

  select batches.*
    into batch
    from public.chips_ledger_archive_batches as batches
    where batches.object_path = p_object_path
    for update;
  if not found then raise exception 'Committed archive manifest was not found'; end if;
  if batch.status <> 'committed' or batch.project_ref is distinct from 'otbqfijerkieoxwpxjnm' then
    raise exception 'Archive manifest is not committed canonical target evidence';
  end if;
  if (p_execute or (p_automatic and batch.pruned_at is not null)) and (batch.destructive_go_at is null or batch.destructive_go_batch_id is distinct from batch.batch_id) then raise exception 'Complete exact destructive GO required'; end if;
  is_closed_human := batch.source_policy_id = 'production-ledger-closed-human-table-retention-30d-v1';
  perform public.chips_assert_archive_prune_target(batch.project_ref, transaction_count, batch.source_policy_id, p_automatic);
  perform public.chips_assert_production_retention_control(
    case when p_automatic then batch.source_policy_id else coalesce(batch.source_policy_id, 'production-ledger-auto-retention-30d-v1') end,
    transaction_count,
    p_execute
  , p_automatic);
  if batch.archive_proof_verified_at is null then
    if p_execute then raise exception 'Archive ID proof must be registered before execute'; end if;
    return pg_catalog.jsonb_build_object('state', 'proof_missing');
  end if;
  if batch.archived_transaction_ids_sha256 is distinct from transaction_ids_sha256
    or batch.archived_entry_ids_sha256 is distinct from entry_ids_sha256
    or batch.transaction_count is distinct from transaction_count
    or batch.entry_count is distinct from entry_count then
    raise exception 'Archive prune IDs do not match immutable archive proof';
  end if;

  receipt_field_count := pg_catalog.num_nonnulls(
    batch.pruned_at,
    batch.pruned_transaction_count,
    batch.pruned_entry_count,
    batch.pruned_transaction_ids_sha256,
    batch.pruned_entry_ids_sha256
  );
  if receipt_field_count not in (0, 5) then
    raise exception 'Archive prune receipt is partial';
  end if;

  select pg_catalog.count(*) into registry_count
    from public.chips_transaction_idempotency as registry
    where registry.transaction_id = any(p_transaction_ids);
  select pg_catalog.count(*) into matching_mapping_count
    from public.chips_transaction_idempotency as registry
    where registry.transaction_id = any(p_transaction_ids)
      and registry.archive_batch_id = batch.batch_id;
  select pg_catalog.count(*) into wrong_mapping_count
    from public.chips_transaction_idempotency as registry
    where registry.transaction_id = any(p_transaction_ids)
      and registry.archive_batch_id is not null
      and registry.archive_batch_id <> batch.batch_id;
  select pg_catalog.count(*) into extra_mapping_count
    from public.chips_transaction_idempotency as registry
    where registry.archive_batch_id = batch.batch_id
      and not (registry.transaction_id = any(p_transaction_ids));
  select pg_catalog.count(*) into hot_transaction_count
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids);
  select pg_catalog.count(*) into hot_entry_count
    from public.chips_entries as entries
    where entries.transaction_id = any(p_transaction_ids)
       or entries.id = any(p_entry_ids);

  if receipt_field_count = 5 then
    if batch.pruned_transaction_count is distinct from transaction_count
      or batch.pruned_entry_count is distinct from entry_count
      or batch.pruned_transaction_ids_sha256 is distinct from transaction_ids_sha256
      or batch.pruned_entry_ids_sha256 is distinct from entry_ids_sha256
      or hot_transaction_count <> 0
      or hot_entry_count <> 0
      or (
        (
          pg_catalog.num_nonnulls(batch.registry_cleaned_at,
            batch.registry_cleaned_key_count, batch.registry_cleaned_keys_sha256) = 0
          and registry_count = transaction_count
          and matching_mapping_count = transaction_count
        ) or (
          batch.project_ref = 'otbqfijerkieoxwpxjnm'
          and batch.format_version = 1
          and batch.source_policy_id = 'production-ledger-auto-retention-30d-v1'
          and batch.committed_at is not null
          and pg_catalog.num_nonnulls(batch.registry_cleaned_at,
            batch.registry_cleaned_key_count, batch.registry_cleaned_keys_sha256) = 3
          and batch.registry_cleaned_key_count = transaction_count
          and batch.registry_cleaned_keys_sha256 ~ '^[0-9a-f]{64}$'
          and registry_count = 0
          and matching_mapping_count = 0
        )
      ) is not true
      or wrong_mapping_count <> 0
      or extra_mapping_count <> 0 then
      raise exception 'Archive already-pruned state is inconsistent';
    end if;
    return pg_catalog.jsonb_build_object(
      'state', 'already_pruned',
      'transactions', transaction_count,
      'entries', entry_count
    );
  end if;

  if matching_mapping_count <> 0 or wrong_mapping_count <> 0 or extra_mapping_count <> 0 then
    raise exception 'Archive mappings exist without a complete prune receipt';
  end if;
  if hot_transaction_count <> transaction_count or hot_entry_count <> entry_count then
    raise exception 'Archive hot ledger batch is incomplete';
  end if;
  if registry_count <> transaction_count then
    raise exception 'Archive hot ledger batch has incomplete registry identity';
  end if;

  select pg_catalog.array_agg(transactions.id order by transactions.created_at, transactions.id)
    into actual_transaction_ids
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids);
  if actual_transaction_ids is distinct from p_transaction_ids then
    raise exception 'Archive transaction order does not match the hot ledger';
  end if;

  with wanted as (
    select ids.id, ids.ordinality
      from pg_catalog.unnest(p_transaction_ids) with ordinality as ids(id, ordinality)
  )
  select pg_catalog.array_agg(entries.id order by wanted.ordinality, entries.id)
    into actual_entry_ids
    from wanted
    join public.chips_entries as entries on entries.transaction_id = wanted.id;
  if actual_entry_ids is distinct from p_entry_ids then
    raise exception 'Archive entry order does not match the hot ledger';
  end if;

  with selected as (
    select transactions.*
      from public.chips_transactions as transactions
      where transactions.id = any(p_transaction_ids)
  ), markers as (
    select selected.id as transaction_id,
           pg_catalog.lower(nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '')) as table_id
      from selected
      where nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '') is not null
    union all
    select selected.id,
           case
             when pg_catalog.lower(selected.reference) like 'table:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             when pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             else null
           end
      from selected
      where pg_catalog.lower(selected.reference) like 'table:%'
         or pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
    union all
    select selected.id,
           pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.substr(accounts.system_key, 13)), ''))
      from selected
      join public.chips_entries as entries on entries.transaction_id = selected.id
      join public.chips_accounts as accounts on accounts.id = entries.account_id
      where accounts.account_type = 'ESCROW'
        and pg_catalog.upper(accounts.system_key) like 'POKER_TABLE:%'
  ), marker_summary as (
    select markers.transaction_id,
           pg_catalog.array_agg(distinct markers.table_id) filter (where markers.table_id is not null) as table_ids,
           pg_catalog.bool_or(
             markers.table_id is null
             or markers.table_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           ) as invalid_marker
      from markers
      group by markers.transaction_id
  )
  select pg_catalog.count(*)
    into invalid_marker_count
    from selected
    left join marker_summary on marker_summary.transaction_id = selected.id
    where coalesce(marker_summary.invalid_marker, false)
       or pg_catalog.cardinality(coalesce(marker_summary.table_ids, array[]::text[])) <> 1;
  if invalid_marker_count <> 0 then
    raise exception 'Archive batch contains missing, invalid, or ambiguous table markers';
  end if;

  with selected as (
    select transactions.*
      from public.chips_transactions as transactions
      where transactions.id = any(p_transaction_ids)
  ), markers as (
    select selected.id as transaction_id,
           pg_catalog.lower(nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '')) as table_id
      from selected
      where nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '') is not null
    union all
    select selected.id,
           case
             when pg_catalog.lower(selected.reference) like 'table:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             when pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             else null
           end
      from selected
      where pg_catalog.lower(selected.reference) like 'table:%'
         or pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
    union all
    select selected.id,
           pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.substr(accounts.system_key, 13)), ''))
      from selected
      join public.chips_entries as entries on entries.transaction_id = selected.id
      join public.chips_accounts as accounts on accounts.id = entries.account_id
      where accounts.account_type = 'ESCROW'
        and pg_catalog.upper(accounts.system_key) like 'POKER_TABLE:%'
  ), marker_summary as (
    select markers.transaction_id, pg_catalog.min(markers.table_id)::uuid as table_id
      from markers
      group by markers.transaction_id
  )
  select pg_catalog.array_agg(distinct marker_summary.table_id order by marker_summary.table_id)
    into table_ids
    from marker_summary;

  select pg_catalog.array_agg(distinct entries.account_id order by entries.account_id)
    into account_ids
    from public.chips_entries as entries
    where entries.transaction_id = any(p_transaction_ids);

  perform tables.id
    from public.poker_tables as tables
    where tables.id = any(table_ids)
    order by tables.id
    for update;
  perform accounts.id
    from public.chips_accounts as accounts
    where accounts.id = any(account_ids)
    order by accounts.id
    for update;
  perform registry.idempotency_key
    from public.chips_transaction_idempotency as registry
    where registry.transaction_id = any(p_transaction_ids)
    order by registry.transaction_id, registry.idempotency_key
    for update;
  perform transactions.id
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids)
    order by transactions.created_at, transactions.id
    for update;
  perform entries.id
    from pg_catalog.unnest(p_transaction_ids) with ordinality as wanted(id, ordinality)
    join public.chips_entries as entries on entries.transaction_id = wanted.id
    order by wanted.ordinality, entries.id
    for update of entries;

  select pg_catalog.count(*) into active_table_count
    from public.poker_tables as tables
    where tables.id = any(table_ids)
      and pg_catalog.upper(tables.status) <> 'CLOSED';
  select pg_catalog.count(*) into invalid_escrow_count
    from pg_catalog.unnest(table_ids) as table_id
    left join public.chips_accounts as accounts
      on accounts.account_type = 'ESCROW'
     and accounts.system_key = 'POKER_TABLE:' || table_id::text
    where accounts.id is null
       or accounts.status <> 'active'
       or accounts.balance <> 0;
  if active_table_count <> 0 or invalid_escrow_count <> 0 then
    raise exception 'Archive batch contains an active table or non-zero/missing escrow';
  end if;

  with selected as (
    select transactions.*
      from public.chips_transactions as transactions
      where transactions.id = any(p_transaction_ids)
  ), markers as (
    select selected.id as transaction_id,
           pg_catalog.lower(nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '')) as table_id
      from selected
      where nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '') is not null
    union all
    select selected.id,
           case
             when pg_catalog.lower(selected.reference) like 'table:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             when pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             else null
           end
      from selected
      where pg_catalog.lower(selected.reference) like 'table:%'
         or pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
    union all
    select selected.id,
           pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.substr(accounts.system_key, 13)), ''))
      from selected
      join public.chips_entries as entries on entries.transaction_id = selected.id
      join public.chips_accounts as accounts on accounts.id = entries.account_id
      where accounts.account_type = 'ESCROW'
        and pg_catalog.upper(accounts.system_key) like 'POKER_TABLE:%'
  ), marker_summary as (
    select markers.transaction_id, pg_catalog.min(markers.table_id) as table_id
      from markers
      group by markers.transaction_id
  ), invalid as (
    select selected.id
      from selected
      join marker_summary on marker_summary.transaction_id = selected.id
      join public.chips_entries as entries on entries.transaction_id = selected.id
      join public.chips_accounts as accounts on accounts.id = entries.account_id
      group by selected.id, selected.tx_type, selected.user_id, selected.created_at, marker_summary.table_id
      having selected.tx_type::text not in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
         or selected.created_at >= batch.cutoff
         or not (
           (
             selected.user_id is null
             and pg_catalog.count(*) = 2
             and pg_catalog.count(*) filter (where accounts.account_type = 'USER') = 0
             and pg_catalog.count(*) filter (where accounts.account_type = 'SYSTEM') = 1
             and pg_catalog.count(*) filter (where accounts.account_type = 'ESCROW') = 1
             and pg_catalog.count(*) filter (
                  where accounts.account_type = 'ESCROW'
                    and accounts.system_key = 'POKER_TABLE:' || marker_summary.table_id
                ) = 1
             and pg_catalog.bool_and(accounts.status = 'active')
             and pg_catalog.sum(entries.amount) = 0
             and (
               (selected.tx_type::text = 'TABLE_BUY_IN'
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'SYSTEM') < 0
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'ESCROW') > 0)
               or
               (selected.tx_type::text = 'TABLE_CASH_OUT'
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'ESCROW') < 0
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'SYSTEM') > 0)
             )
           )
           or
           (
             is_closed_human
             and selected.user_id is not null
             and pg_catalog.count(*) = 2
             and pg_catalog.count(*) filter (where accounts.account_type = 'USER') = 1
             and pg_catalog.count(*) filter (where accounts.account_type = 'SYSTEM') = 0
             and pg_catalog.count(*) filter (where accounts.account_type = 'ESCROW') = 1
             and pg_catalog.count(*) filter (
                  where accounts.account_type = 'ESCROW'
                    and accounts.system_key = 'POKER_TABLE:' || marker_summary.table_id
                ) = 1
             and pg_catalog.count(*) filter (
                  where accounts.account_type = 'USER'
                    and accounts.user_id = selected.user_id
                ) = 1
             and pg_catalog.bool_and(accounts.status = 'active')
             and pg_catalog.sum(entries.amount) = 0
             and (
               (selected.tx_type::text = 'TABLE_BUY_IN'
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'USER') < 0
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'ESCROW') > 0)
               or
               (selected.tx_type::text = 'TABLE_CASH_OUT'
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'ESCROW') < 0
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'USER') > 0)
             )
           )
         )
  )
  select pg_catalog.count(*) into invalid_shape_count from invalid;
  if invalid_shape_count <> 0 then
    raise exception 'Archive batch is outside the technical TABLE_BUY_IN/TABLE_CASH_OUT whitelist';
  end if;

  select pg_catalog.count(*) into identity_mismatch_count
    from public.chips_transactions as transactions
    left join public.chips_transaction_idempotency as registry
      on registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
     and registry.payload_hash = transactions.payload_hash
     and registry.tx_type = transactions.tx_type
     and registry.user_id is not distinct from transactions.user_id
     and registry.transaction_created_at = transactions.created_at
    where transactions.id = any(p_transaction_ids)
      and registry.idempotency_key is null;
  if identity_mismatch_count <> 0 then
    raise exception 'Archive batch registry identity is incomplete or inconsistent';
  end if;

  select pg_catalog.count(*) into user_transaction_count
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids) and transactions.user_id is not null;
  select pg_catalog.count(*) into user_entry_count
    from public.chips_entries as entries
    join public.chips_accounts as accounts on accounts.id = entries.account_id
    where entries.transaction_id = any(p_transaction_ids) and accounts.account_type = 'USER';
  distinct_table_count := pg_catalog.cardinality(table_ids);

  select pg_catalog.jsonb_object_agg(types.tx_type, types.count order by types.tx_type)
    into actual_tx_types
    from (
      select transactions.tx_type::text as tx_type, pg_catalog.count(*) as count
        from public.chips_transactions as transactions
        where transactions.id = any(p_transaction_ids)
        group by transactions.tx_type::text
    ) as types;
  select
    coalesce(pg_catalog.sum(case when entries.amount > 0 then entries.amount else 0 end), 0),
    coalesce(pg_catalog.sum(case when entries.amount < 0 then -entries.amount else 0 end), 0),
    coalesce(pg_catalog.sum(entries.amount), 0)
    into actual_credits, actual_debits, actual_net
    from public.chips_entries as entries
    where entries.transaction_id = any(p_transaction_ids);
  select pg_catalog.min(transactions.created_at), pg_catalog.max(transactions.created_at)
    into actual_first_created_at, actual_last_created_at
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids);
  select transactions.created_at, transactions.id
    into actual_cursor_end_created_at, actual_cursor_end_id
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids)
    order by transactions.created_at desc, transactions.id desc
    limit 1;

  if actual_tx_types is distinct from batch.tx_types
    or actual_credits is distinct from batch.credits
    or actual_debits is distinct from batch.debits
    or actual_net is distinct from batch.net_amount
    or actual_first_created_at is distinct from batch.first_created_at
    or actual_last_created_at is distinct from batch.last_created_at
    or actual_cursor_end_created_at is distinct from batch.cursor_end_created_at
    or actual_cursor_end_id is distinct from batch.cursor_end_id
    or (not is_closed_human and (user_transaction_count <> 0 or user_entry_count <> 0)) then
    raise exception 'Archive hot ledger aggregates do not match committed evidence';
  end if;

  select pg_catalog.jsonb_object_agg(
           accounts.id::text,
           pg_catalog.jsonb_build_array(accounts.balance::text, accounts.next_entry_seq::text)
           order by accounts.id::text
         )
    into accounts_before
    from public.chips_accounts as accounts
    where accounts.id = any(account_ids);

  if not p_execute then
    return pg_catalog.jsonb_build_object(
      'state', 'ready',
      'transactions', transaction_count,
      'entries', entry_count,
      'tx_types', actual_tx_types,
      'credits', actual_credits::text,
      'debits', actual_debits::text,
      'net', actual_net::text,
      'user_transactions', user_transaction_count,
      'user_entries', user_entry_count,
      'distinct_tables', distinct_table_count
    );
  end if;

  update public.chips_transaction_idempotency as registry
     set archive_batch_id = batch.batch_id
    from public.chips_transactions as transactions
   where transactions.id = any(p_transaction_ids)
     and registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
     and registry.payload_hash = transactions.payload_hash
     and registry.tx_type = transactions.tx_type
     and registry.user_id is not distinct from transactions.user_id
     and registry.transaction_created_at = transactions.created_at
     and registry.archive_batch_id is null;
  get diagnostics mapped_count = row_count;
  if mapped_count <> transaction_count then raise exception 'Archive registry mapping count mismatch'; end if;

  delete from public.chips_entries as entries
    where entries.id = any(p_entry_ids)
      and entries.transaction_id = any(p_transaction_ids);
  get diagnostics deleted_entry_count = row_count;
  if deleted_entry_count <> entry_count then raise exception 'Archive entry DELETE count mismatch'; end if;

  delete from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids);
  get diagnostics deleted_transaction_count = row_count;
  if deleted_transaction_count <> transaction_count then raise exception 'Archive transaction DELETE count mismatch'; end if;

  select pg_catalog.jsonb_object_agg(
           accounts.id::text,
           pg_catalog.jsonb_build_array(accounts.balance::text, accounts.next_entry_seq::text)
           order by accounts.id::text
         )
    into accounts_after
    from public.chips_accounts as accounts
    where accounts.id = any(account_ids);
  if accounts_after is distinct from accounts_before then
    raise exception 'Archive pruning changed account balances or entry sequences';
  end if;
  if exists (select 1 from public.chips_transactions where id = any(p_transaction_ids))
    or exists (
      select 1 from public.chips_entries
       where transaction_id = any(p_transaction_ids) or id = any(p_entry_ids)
    ) then
    raise exception 'Archive pruning left hot ledger rows behind';
  end if;

  update public.chips_ledger_archive_batches as batches
     set pruned_at = pg_catalog.timezone('utc', pg_catalog.now()),
         pruned_transaction_count = batches.transaction_count,
         pruned_entry_count = batches.entry_count,
         pruned_transaction_ids_sha256 = batches.archived_transaction_ids_sha256,
         pruned_entry_ids_sha256 = batches.archived_entry_ids_sha256
   where batches.batch_id = batch.batch_id
     and batches.pruned_at is null;
  get diagnostics receipt_count = row_count;
  if receipt_count <> 1 then raise exception 'Archive prune receipt transition was not unique'; end if;

  return pg_catalog.jsonb_build_object(
    'state', 'pruned',
    'transactions', deleted_transaction_count,
    'entries', deleted_entry_count,
    'tx_types', actual_tx_types,
    'credits', actual_credits::text,
    'debits', actual_debits::text,
    'net', actual_net::text,
    'user_transactions', user_transaction_count,
    'user_entries', user_entry_count,
    'distinct_tables', distinct_table_count
  );
end;
$function$;

alter function public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean,boolean) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean,boolean) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean,boolean) to chips_ledger_archive_pruner;

create or replace function public.chips_prune_committed_archive_batch_internal(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_execute boolean DEFAULT false) returns jsonb language sql security definer set search_path='' as $$
 select public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, p_execute, false);
$$;

alter function public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean) to chips_ledger_archive_pruner;

create or replace function public.chips_prune_committed_archive_batch(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_execute boolean, p_automatic boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_project_ref text; target_policy_id text;
begin
  select project_ref,source_policy_id into target_project_ref,target_policy_id from public.chips_ledger_archive_batches where object_path = p_object_path for update;
  if not found then raise exception 'Committed archive manifest was not found'; end if;
  perform public.chips_assert_archive_prune_target(target_project_ref, pg_catalog.cardinality(p_transaction_ids), target_policy_id, p_automatic);
  return public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, p_execute, p_automatic);
end;
$$;

alter function public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean,boolean) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean,boolean) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean,boolean) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_prune_committed_archive_batch(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_execute boolean default false) returns jsonb language sql security definer set search_path='' as $$
 select public.chips_prune_committed_archive_batch(p_object_path, p_transaction_ids, p_entry_ids, p_execute, false);
$$;

alter function public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_prune_committed_archive_batch(text,uuid[],bigint[],boolean) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_assert_bot_only_archive_proof_lifecycle_gate(p_table_id uuid, p_batch_id bigint, p_cutoff timestamp with time zone, p_transaction_ids uuid[], p_registry_keys text[], p_automatic boolean) returns jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  table_row record;
  escrow_count bigint;
  unknown_registry_count bigint;
  unknown_hot_count bigint;
  human_registry_count bigint;
  young_registry_count bigint;
  incomplete_old_count bigint;
  newest_created_at timestamptz;
begin
  if not public.chips_table_fence_is_active() then
    raise exception using errcode = 'P8913', message = 'Bot-only lifecycle gate requires the active TABLE fence';
  end if;
  if p_batch_id is null or not exists (
    select 1
      from public.chips_ledger_archive_batches batches
     where batches.batch_id = p_batch_id
       and batches.status = 'committed'
       and batches.project_ref = 'otbqfijerkieoxwpxjnm'
       and batches.format_version = 2
       and batches.source_policy_id = 'production-ledger-bot-only-retention-7d-v1'
       and batches.cutoff = p_cutoff
  ) then
    raise exception using errcode = 'P8913', message = 'Bot-only lifecycle gate requires the exact committed schema-v2 batch';
  end if;
  if p_transaction_ids is null or pg_catalog.cardinality(p_transaction_ids) < 1 then
    raise exception using errcode = 'P8913', message = 'Bot-only lifecycle gate requires exact transaction evidence';
  end if;
  perform public.chips_assert_archive_prune_target('otbqfijerkieoxwpxjnm', pg_catalog.cardinality(p_transaction_ids), 'production-ledger-bot-only-retention-7d-v1', p_automatic);
  perform public.chips_assert_production_retention_control(
    'production-ledger-bot-only-retention-7d-v1',
    pg_catalog.cardinality(p_transaction_ids),
    false
  , p_automatic);

  select tables.id, tables.status, tables.has_human_participant, tables.bot_only_proof_eligible, tables.bot_only_retention_complete_at
    into table_row
    from public.poker_tables tables
   where tables.id = p_table_id
   for update;
  if not found then raise exception using errcode = 'P8913', message = 'Bot-only table is missing'; end if;
  if pg_catalog.upper(table_row.status::text) <> 'CLOSED' then raise exception using errcode = 'P8913', message = 'Bot-only table is not CLOSED'; end if;
  if table_row.has_human_participant is true then raise exception using errcode = 'P8913', message = 'Human-participant table is outside bot-only retention'; end if;
  if table_row.bot_only_proof_eligible is not true then raise exception using errcode = 'P8913', message = 'Historical bot-only proof is uncertain'; end if;

  select count(*) into escrow_count
    from public.chips_accounts accounts
   where accounts.account_type::text = 'ESCROW'
     and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
     and accounts.status::text = 'active'
     and accounts.balance = 0;
  if escrow_count <> 1 then raise exception using errcode = 'P8913', message = 'Bot-only table escrow is not active and zero'; end if;

  -- Keep the target evidence predicates equivalent to the historical gate,
  -- but start from the exact proof IDs and target markers.  No global
  -- registry_rows/table_transactions materialization is used here.  The
  -- result remains fail-closed for key, metadata, reference, and ESCROW
  -- evidence that can bind an unknown identity to this exact table.



  with candidate_transaction_ids as (
    -- Exact archive IDs use the chips_transactions primary-key path.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.id = any(coalesce(p_transaction_ids, array[]::uuid[]))
       and transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)

    union

    -- The regex remains the authoritative key validator.  LIKE is only a
    -- selective prefilter for the existing lower(idempotency_key) trigram
    -- access path.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.idempotency_key, '')) like any (array[
         'join-buyin:' || p_table_id::text || ':%',
         'bot-seed-buyin:' || p_table_id::text || ':%',
         'managed-bot-seed-buyin:' || p_table_id::text || ':%'
       ])
       and transactions.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.idempotency_key, '')) like any (array[
         'poker:leave:' || p_table_id::text || ':%',
         'poker:inactive_cleanup:' || p_table_id::text || ':%'
       ])
       and transactions.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.idempotency_key, '')) like any (array[
         'poker:rebuy:v1:' || p_table_id::text || ':%',
         'poker:deferred-leave:v1:' || p_table_id::text || ':%',
         'poker:bot-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:human-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:bot-replacement-buyin:v1:' || p_table_id::text || ':%',
         'poker:managed-bot-top-up:v1:' || p_table_id::text || ':%'
       ])
       and transactions.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    -- Metadata LIKE is only a candidate prefilter.  The historical JSON
    -- object checks remain the authoritative validator below it.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.metadata::text, '')) like '%' || p_table_id::text || '%'
       and transactions.metadata is not null
       and pg_catalog.jsonb_typeof(transactions.metadata) = 'object'
       and transactions.metadata ? 'tableId'
       and nullif(pg_catalog.btrim(transactions.metadata->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and pg_catalog.lower(pg_catalog.btrim(transactions.metadata->>'tableId')) = p_table_id::text

    union

    -- Keep safe validation for string-encoded JSON; the metadata trigram
    -- prefilter cannot widen this exact evidence branch.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.metadata::text, '')) like '%' || p_table_id::text || '%'
       and transactions.metadata is not null
       and pg_catalog.jsonb_typeof(transactions.metadata) = 'string'
       and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text)
       and pg_catalog.jsonb_typeof((transactions.metadata #>> '{}')::jsonb) = 'object'
       and ((transactions.metadata #>> '{}')::jsonb) ? 'tableId'
       and nullif(pg_catalog.btrim(((transactions.metadata #>> '{}')::jsonb)->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and pg_catalog.lower(pg_catalog.btrim(((transactions.metadata #>> '{}')::jsonb)->>'tableId')) = p_table_id::text

    union

    -- The old case-insensitive reference grammar remains the authoritative
    -- check after the existing lower(reference) trigram prefilter.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.reference, '')) like any (array[
         'table:' || p_table_id::text || '%',
         'poker-rebuy:' || p_table_id::text || '%',
         'bot_seed_buy_in:' || p_table_id::text || '%',
         'bot_replacement_buy_in:' || p_table_id::text || '%',
         'managed_bot_top_up:' || p_table_id::text || '%'
       ])
       and transactions.reference ~* ('^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):' || p_table_id::text || '(:.*)?$')

    union

    -- Registry table binding remains an independent exact evidence branch.
    select registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and registry.table_id = p_table_id

    union

    -- Registry NULL-table key branches are intentionally unchanged here;
    -- escrow registry chunking is a separate follow-up.
    select registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and registry.table_id is null
       and pg_catalog.lower(registry.idempotency_key) like any (array[
         'join-buyin:' || p_table_id::text || ':%',
         'bot-seed-buyin:' || p_table_id::text || ':%',
         'managed-bot-seed-buyin:' || p_table_id::text || ':%',
         'poker:leave:' || p_table_id::text || ':%',
         'poker:inactive_cleanup:' || p_table_id::text || ':%',
         'poker:rebuy:v1:' || p_table_id::text || ':%',
         'poker:deferred-leave:v1:' || p_table_id::text || ':%',
         'poker:bot-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:human-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:bot-replacement-buyin:v1:' || p_table_id::text || ':%',
         'poker:managed-bot-top-up:v1:' || p_table_id::text || ':%'
       ])
       and registry.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    select registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and registry.table_id is null
       and pg_catalog.lower(registry.idempotency_key) like any (array[
         'poker:leave:' || p_table_id::text || ':%',
         'poker:inactive_cleanup:' || p_table_id::text || ':%'
       ])
       and registry.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    select registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and registry.table_id is null
       and pg_catalog.lower(registry.idempotency_key) like any (array[
         'poker:rebuy:v1:' || p_table_id::text || ':%',
         'poker:deferred-leave:v1:' || p_table_id::text || ':%',
         'poker:bot-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:human-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:bot-replacement-buyin:v1:' || p_table_id::text || ':%',
         'poker:managed-bot-top-up:v1:' || p_table_id::text || ':%'
       ])
       and registry.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    -- ESCROW entry evidence resolves the exact system account first and
    -- reaches transaction IDs through the existing entries access path.
    select entries.transaction_id
      from public.chips_entries entries
      join public.chips_accounts accounts on accounts.id = entries.account_id
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
  ), target_transactions as (
    -- Only this final join reads transaction payload columns, and it is by
    -- the primary key over the deduplicated candidate ID set.
    select transactions.id,
           transactions.idempotency_key,
           transactions.reference,
           normalized.normalized_metadata,
           case
             when transactions.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.idempotency_key, ':', 2)))
             when transactions.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.idempotency_key, ':', 3)))
             when transactions.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.idempotency_key, ':', 4)))
             else null
           end as key_table_id
      from candidate_transaction_ids candidates
      join public.chips_transactions transactions on transactions.id = candidates.id
      cross join lateral (
        select case
                 when transactions.metadata is not null
                   and pg_catalog.jsonb_typeof(transactions.metadata) = 'object'
                   then transactions.metadata
                 when transactions.metadata is not null
                   and pg_catalog.jsonb_typeof(transactions.metadata) = 'string'
                   and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text)
                   then (transactions.metadata #>> '{}')::jsonb
                 else null::jsonb
               end as normalized_metadata
      ) normalized
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
  ), target_transaction_evidence as (
    select target.id as transaction_id, target.key_table_id as table_id
      from target_transactions target
     where target.key_table_id is not null

    union all

    select target.id,
           pg_catalog.lower(pg_catalog.btrim(target.normalized_metadata->>'tableId'))
      from target_transactions target
     where target.normalized_metadata is not null
       and pg_catalog.jsonb_typeof(target.normalized_metadata) = 'object'
       and target.normalized_metadata ? 'tableId'
       and nullif(pg_catalog.btrim(target.normalized_metadata->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

    union all

    select target.id,
           pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(target.reference, ':', 2)))
      from target_transactions target
     where target.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(:.*)?$'

    union all

    select target.id,
           case
             when registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 2)))
             when registry.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 3)))
             when registry.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 4)))
             else null
           end
      from target_transactions target
      join public.chips_transaction_idempotency registry on registry.transaction_id = target.id
       and registry.table_id is null
     where registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin|poker:(leave|inactive_cleanup)|poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1):'

    union all

    select target.id, p_table_id::text
      from target_transactions target
      join public.chips_entries entries on entries.transaction_id = target.id
      join public.chips_accounts accounts on accounts.id = entries.account_id
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
  ), unknown_registry_rows as (
    select registry.idempotency_key, registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
       and registry.table_id is null
       and (
         registry.transaction_id = any(coalesce(p_transaction_ids, array[]::uuid[]))
         or registry.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || p_table_id::text || ':[^:]+(:[^:]+)*$')
         or registry.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || p_table_id::text || ':[^:]+(:[^:]+)*$')
         or registry.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || p_table_id::text || ':[^:]+(:[^:]+)*$')
         or exists (
           select 1
             from target_transaction_evidence evidence
            where evidence.transaction_id = registry.transaction_id
              and evidence.table_id = p_table_id::text
         )
         or exists (
           select 1
             from public.chips_entries entries
             join public.chips_accounts accounts on accounts.id = entries.account_id
            where entries.transaction_id = registry.transaction_id
              and accounts.account_type::text = 'ESCROW'
              and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
         )
       )
  ), unknown_registry_identity_evidence as (
    select unknown.idempotency_key as identity_key,
           case
             when unknown.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(unknown.idempotency_key, ':', 2)))
             when unknown.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(unknown.idempotency_key, ':', 3)))
             when unknown.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(unknown.idempotency_key, ':', 4)))
             else null
           end as table_id
      from unknown_registry_rows unknown

    union all

    select unknown.idempotency_key, evidence.table_id
      from unknown_registry_rows unknown
      join target_transaction_evidence evidence on evidence.transaction_id = unknown.transaction_id

    union all

    select distinct unknown.idempotency_key, p_table_id::text
      from unknown_registry_rows unknown
      join public.chips_entries entries on entries.transaction_id = unknown.transaction_id
      join public.chips_accounts accounts on accounts.id = entries.account_id
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
  ), hot_identity_rows as (
    select distinct target.id as transaction_id
      from target_transactions target
     where not exists (
             select 1
               from public.chips_transaction_idempotency registry
              where registry.transaction_id = target.id
                and registry.table_id is not null
           )
        or exists (
             select 1
               from public.chips_transaction_idempotency registry
              where registry.transaction_id = target.id
                and registry.table_id is null
           )
  ), hot_identity_evidence as (
    select hot.transaction_id, evidence.table_id
      from hot_identity_rows hot
      join target_transaction_evidence evidence on evidence.transaction_id = hot.transaction_id

    union all

    select distinct hot.transaction_id,
           case
             when registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 2)))
             when registry.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 3)))
             when registry.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 4)))
             else null
           end
      from hot_identity_rows hot
      join public.chips_transaction_idempotency registry on registry.transaction_id = hot.transaction_id
       and registry.table_id is null
     where registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin|poker:(leave|inactive_cleanup)|poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1):'

    union all

    select distinct hot.transaction_id, p_table_id::text
      from hot_identity_rows hot
      join public.chips_entries entries on entries.transaction_id = hot.transaction_id
      join public.chips_accounts accounts on accounts.id = entries.account_id
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
  )
  select
    (
      select count(distinct unknown.identity_key)::bigint
        from unknown_registry_identity_evidence unknown
       where unknown.table_id = p_table_id::text
    ),
    (
      select count(distinct hot.transaction_id)::bigint
        from hot_identity_evidence hot
       where hot.table_id = p_table_id::text
    )
    into unknown_registry_count, unknown_hot_count;

  if unknown_registry_count <> 0 or unknown_hot_count <> 0 then
    raise exception using errcode = 'P8914', message = 'Unknown TABLE identity blocks bot-only lifecycle completion';
  end if;

  select count(*) into human_registry_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.user_id is not null;
  if human_registry_count <> 0 then raise exception using errcode = 'P8914', message = 'USER TABLE identity blocks bot-only lifecycle completion'; end if;

  select count(*) into young_registry_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.user_id is null
     and registry.transaction_created_at >= p_cutoff;
  if young_registry_count <> 0 then raise exception using errcode = 'P8915', message = 'Young TABLE identity blocks bot-only lifecycle completion'; end if;

  select count(*) into incomplete_old_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.user_id is null
     and registry.transaction_created_at < p_cutoff
     and not (
       registry.idempotency_key = any(coalesce(p_registry_keys, array[]::text[]))
       or exists (
         select 1
           from public.chips_ledger_archive_batches batches
          where batches.batch_id = registry.archive_batch_id
            and batches.format_version = 2
            and batches.source_policy_id = 'production-ledger-bot-only-retention-7d-v1'
            and batches.pruned_at is not null
            and batches.registry_cleaned_at is not null
       )
     );
  if incomplete_old_count <> 0 then raise exception using errcode = 'P8916', message = 'Old TABLE identity is not fully archived, pruned, and cleaned'; end if;

  select max(value) into newest_created_at
    from (
      select max(registry.transaction_created_at) as value
        from public.chips_transaction_idempotency registry
       where registry.table_id = p_table_id
      union all
      select max(batches.bot_only_newest_created_at)
        from public.chips_ledger_archive_batches batches
       where batches.bot_only_table_id = p_table_id
         and batches.format_version = 2
         and batches.source_policy_id = 'production-ledger-bot-only-retention-7d-v1'
         and batches.registry_cleaned_at is not null
    ) known;
  if newest_created_at is null or newest_created_at >= p_cutoff then
    raise exception using errcode = 'P8915', message = 'Newest known TABLE identity is not older than the bot-only cutoff';
  end if;

  return pg_catalog.jsonb_build_object(
    'state', 'table_complete',
    'table_id', p_table_id,
    'newest_created_at', newest_created_at,
    'unknown_registry', unknown_registry_count,
    'unknown_hot', unknown_hot_count,
    'protected_registry', human_registry_count
  );
end;
$function$;

alter function public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamp with time zone,uuid[],text[],boolean) owner to postgres;
revoke all on function public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamp with time zone,uuid[],text[],boolean) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamp with time zone,uuid[],text[],boolean) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_assert_bot_only_archive_proof_lifecycle_gate(p_table_id uuid, p_batch_id bigint, p_cutoff timestamp with time zone, p_transaction_ids uuid[], p_registry_keys text[]) returns jsonb language sql security definer set search_path='' as $$
 select public.chips_assert_bot_only_archive_proof_lifecycle_gate(p_table_id, p_batch_id, p_cutoff, p_transaction_ids, p_registry_keys, false);
$$;

alter function public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamp with time zone,uuid[],text[]) owner to postgres;
revoke all on function public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamp with time zone,uuid[],text[]) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamp with time zone,uuid[],text[]) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_register_bot_only_archive_proof(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_table_id uuid, p_registry_keys text[], p_out_of_scope_keys_sha256 text, p_automatic boolean) returns jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  actual_transaction_ids uuid[];
  actual_entry_ids bigint[];
  actual_registry_keys text[];
  sorted_registry_keys text[];
  out_of_scope_keys text[];
  transaction_ids_sha256 text;
  entry_ids_sha256 text;
  registry_keys_sha256 text;
  out_of_scope_keys_sha256 text;
  expected_transaction_count bigint;
  expected_entry_count bigint;
  actual_table_count bigint;
  actual_identity_count bigint;
  actual_eligible_count bigint;
  invalid_registry_binding_count bigint;
  newest_created_at timestamptz;
  table_row record;
  invalid_shape_count bigint;
  updated_count bigint;
begin
  perform public.chips_assert_production_retention_control(
    'production-ledger-bot-only-retention-7d-v1',
    pg_catalog.cardinality(p_transaction_ids),
    false
  , p_automatic);
  perform public.chips_assert_archive_prune_target('otbqfijerkieoxwpxjnm', pg_catalog.cardinality(p_transaction_ids), 'production-ledger-bot-only-retention-7d-v1', p_automatic);
  if p_transaction_ids is null or p_entry_ids is null or p_registry_keys is null
     or pg_catalog.cardinality(p_transaction_ids) < 1
     or pg_catalog.cardinality(p_transaction_ids) > 5000
     or pg_catalog.cardinality(p_entry_ids) < 1
     or pg_catalog.cardinality(p_registry_keys) <> pg_catalog.cardinality(p_transaction_ids) then
    raise exception using errcode = 'P8917', message = 'Bot-only proof batch arrays are invalid';
  end if;
  if (select count(*) from pg_catalog.unnest(p_transaction_ids) as values(value)) <> (select count(distinct value) from pg_catalog.unnest(p_transaction_ids) as values(value))
     or (select count(*) from pg_catalog.unnest(p_entry_ids) as values(value)) <> (select count(distinct value) from pg_catalog.unnest(p_entry_ids) as values(value))
     or (select count(*) from pg_catalog.unnest(p_registry_keys) as values(value)) <> (select count(distinct value) from pg_catalog.unnest(p_registry_keys) as values(value)) then
    raise exception using errcode = 'P8917', message = 'Bot-only proof batch arrays contain duplicates';
  end if;

  transaction_ids_sha256 := public.chips_archive_uuid_ids_sha256(p_transaction_ids);
  entry_ids_sha256 := public.chips_archive_bigint_ids_sha256(p_entry_ids);

  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.object_path = p_object_path
   for update;
  if not found then raise exception using errcode = 'P8917', message = 'Committed bot-only archive manifest was not found'; end if;
  if batch.status <> 'committed'
     or batch.project_ref <> 'otbqfijerkieoxwpxjnm'
     or batch.format_version <> 2
     or batch.source_policy_id <> 'production-ledger-bot-only-retention-7d-v1' then
    raise exception using errcode = 'P8917', message = 'Bot-only proof requires a committed canonical Production schema-v2 batch';
  end if;
  if batch.object_path <> ('v1/sha256/' || batch.compressed_sha256 || '.jsonl.gz') then
    raise exception using errcode = 'P8917', message = 'Bot-only object path does not match compressed SHA-256';
  end if;
  if batch.transaction_count <> pg_catalog.cardinality(p_transaction_ids)
     or batch.entry_count <> pg_catalog.cardinality(p_entry_ids) then
    raise exception using errcode = 'P8917', message = 'Bot-only proof counts do not match the manifest';
  end if;

  select pg_catalog.array_agg(transactions.id order by transactions.created_at, transactions.id)
    into actual_transaction_ids
    from public.chips_transactions transactions
   where transactions.id = any(p_transaction_ids);
  if actual_transaction_ids is distinct from p_transaction_ids then raise exception using errcode = 'P8917', message = 'Bot-only transaction order does not match the hot ledger'; end if;

  with wanted as (
    select ids.id, ids.ordinality from pg_catalog.unnest(p_transaction_ids) with ordinality ids(id, ordinality)
  )
  select pg_catalog.array_agg(entries.id order by wanted.ordinality, entries.id)
    into actual_entry_ids
    from wanted join public.chips_entries entries on entries.transaction_id = wanted.id;
  if actual_entry_ids is distinct from p_entry_ids then raise exception using errcode = 'P8917', message = 'Bot-only entry order does not match the hot ledger'; end if;

  select tables.id, tables.status, tables.has_human_participant, tables.bot_only_proof_eligible
    into table_row
    from public.poker_tables tables
   where tables.id = p_table_id
   for update;
  if not found or pg_catalog.upper(coalesce(table_row.status::text, '')) <> 'CLOSED' or table_row.has_human_participant is true or table_row.bot_only_proof_eligible is not true then
    raise exception using errcode = 'P8918', message = 'Bot-only proof requires an authoritative closed bot-only table';
  end if;

  select count(*) into actual_table_count
    from (
      select distinct (public.chips_parse_table_idempotency_key(transactions.idempotency_key)->>'table_id')::uuid as table_id
        from public.chips_transactions transactions
       where transactions.id = any(p_transaction_ids)
    ) tables;
  if actual_table_count <> 1 or exists (
    select 1
      from public.chips_transactions transactions
     where transactions.id = any(p_transaction_ids)
       and (public.chips_parse_table_idempotency_key(transactions.idempotency_key)->>'table_id')::uuid <> p_table_id
  ) then
    raise exception using errcode = 'P8918', message = 'Bot-only proof has more than one table identity';
  end if;

  select count(*) into invalid_shape_count
    from (
      select transactions.id
        from public.chips_transactions transactions
        join public.chips_entries entries on entries.transaction_id = transactions.id
        join public.chips_accounts accounts on accounts.id = entries.account_id
       where transactions.id = any(p_transaction_ids)
       group by transactions.id, transactions.tx_type, transactions.user_id, transactions.created_at,
                transactions.metadata, transactions.reference
      having transactions.tx_type::text not in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
          or transactions.user_id is not null
          or transactions.created_at >= batch.cutoff
          or (
            transactions.metadata ? 'tableId'
            and (
              nullif(pg_catalog.btrim(transactions.metadata->>'tableId'), '') is null
              or nullif(pg_catalog.btrim(transactions.metadata->>'tableId'), '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              or pg_catalog.lower(pg_catalog.btrim(transactions.metadata->>'tableId')) <> p_table_id::text
            )
          )
          or (
            transactions.reference is not null
            and public.chips_parse_table_reference(transactions.reference) <> p_table_id
          )
          or count(*) <> 2
          or count(*) filter (where accounts.account_type::text = 'USER') <> 0
          or count(*) filter (where accounts.account_type::text = 'SYSTEM') <> 1
          or count(*) filter (where accounts.account_type::text = 'ESCROW') <> 1
          or count(*) filter (where accounts.account_type::text = 'ESCROW' and accounts.system_key = 'POKER_TABLE:' || p_table_id::text) <> 1
          or not bool_and(accounts.status::text = 'active')
          or sum(entries.amount) <> 0
          or (transactions.tx_type::text = 'TABLE_BUY_IN' and (sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM') >= 0 or sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW') <= 0))
          or (transactions.tx_type::text = 'TABLE_CASH_OUT' and (sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW') >= 0 or sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM') <= 0))
    ) invalid;
  if invalid_shape_count <> 0 then raise exception using errcode = 'P8918', message = 'Bot-only proof is outside the technical TABLE whitelist'; end if;

  select pg_catalog.array_agg(registry.idempotency_key order by registry.idempotency_key)
    into actual_registry_keys
    from public.chips_transaction_idempotency registry
   where registry.transaction_id = any(p_transaction_ids)
     and registry.table_id = p_table_id
     and registry.archive_batch_id is null;
  select pg_catalog.array_agg(value order by value)
    into sorted_registry_keys
    from pg_catalog.unnest(p_registry_keys) as values(value);
  if actual_registry_keys is distinct from sorted_registry_keys then raise exception using errcode = 'P8919', message = 'Bot-only registry key proof does not match the hot registry'; end if;
  select count(*)
    into invalid_registry_binding_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and (
       registry.key_format_version is distinct from 1
       or registry.key_format is distinct from (
         public.chips_parse_table_idempotency_key(registry.idempotency_key)->>'format'
       )
     );
  if invalid_registry_binding_count <> 0 then
    raise exception using errcode = 'P8919', message = 'Bot-only registry format does not match the server-verifiable key';
  end if;
  registry_keys_sha256 := public.chips_archive_text_ids_sha256(sorted_registry_keys);

  select pg_catalog.array_agg(registry.idempotency_key order by registry.idempotency_key)
    into out_of_scope_keys
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and not (registry.idempotency_key = any(sorted_registry_keys));
  out_of_scope_keys := coalesce(out_of_scope_keys, array[]::text[]);
  out_of_scope_keys_sha256 := public.chips_archive_text_ids_sha256(out_of_scope_keys);
  if p_out_of_scope_keys_sha256 is distinct from out_of_scope_keys_sha256 then
    raise exception using errcode = 'P8919', message = 'Bot-only out-of-scope registry proof does not match the hot registry';
  end if;
  select count(*) into actual_identity_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id;
  actual_eligible_count := pg_catalog.cardinality(p_transaction_ids);
  if actual_identity_count <> actual_eligible_count then
    raise exception using errcode = 'P8919', message = 'Bot-only registry identity count does not match the complete eligible set';
  end if;
  select max(registry.transaction_created_at) into newest_created_at
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id;
  if newest_created_at is null or newest_created_at >= batch.cutoff then raise exception using errcode = 'P8915', message = 'Bot-only proof newest identity has not crossed the seven-day cutoff'; end if;

  perform public.chips_assert_bot_only_archive_proof_lifecycle_gate(p_table_id, batch.batch_id, batch.cutoff, p_transaction_ids, sorted_registry_keys, p_automatic);

  if batch.archive_proof_verified_at is not null then
    if batch.archived_transaction_ids_sha256 is distinct from transaction_ids_sha256
       or batch.archived_entry_ids_sha256 is distinct from entry_ids_sha256
       or batch.bot_only_table_id is distinct from p_table_id
       or batch.bot_only_registry_keys_sha256 is distinct from registry_keys_sha256 then
      raise exception using errcode = 'P8920', message = 'Existing bot-only proof differs from the requested evidence';
    end if;
    return pg_catalog.jsonb_build_object('state', 'proof_exists', 'transactions', batch.transaction_count, 'entries', batch.entry_count);
  end if;

  perform pg_catalog.set_config('chips.production_bot_only_proof', '1', true);
  update public.chips_ledger_archive_batches batches
     set archived_transaction_ids_sha256 = transaction_ids_sha256,
         archived_entry_ids_sha256 = entry_ids_sha256,
         archive_proof_verified_at = pg_catalog.timezone('utc', pg_catalog.now()),
         bot_only_table_id = p_table_id,
         bot_only_table_count = 1,
         bot_only_newest_created_at = newest_created_at,
         bot_only_registry_keys_sha256 = registry_keys_sha256,
         bot_only_out_of_scope_keys_sha256 = out_of_scope_keys_sha256,
         bot_only_identity_count = actual_identity_count,
         bot_only_eligible_count = actual_eligible_count
   where batches.batch_id = batch.batch_id
     and batches.archive_proof_verified_at is null;
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then raise exception using errcode = 'P8920', message = 'Bot-only proof transition was not unique'; end if;
  return pg_catalog.jsonb_build_object('state', 'proof_registered', 'transactions', batch.transaction_count, 'entries', batch.entry_count, 'table_id', p_table_id, 'registry_keys_sha256', registry_keys_sha256);
end;
$function$;

alter function public.chips_register_bot_only_archive_proof(text,uuid[],bigint[],uuid,text[],text,boolean) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_register_bot_only_archive_proof(text,uuid[],bigint[],uuid,text[],text,boolean) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_register_bot_only_archive_proof(text,uuid[],bigint[],uuid,text[],text,boolean) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_register_bot_only_archive_proof(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_table_id uuid, p_registry_keys text[], p_out_of_scope_keys_sha256 text) returns jsonb language sql security definer set search_path='' as $$
 select public.chips_register_bot_only_archive_proof(p_object_path, p_transaction_ids, p_entry_ids, p_table_id, p_registry_keys, p_out_of_scope_keys_sha256, false);
$$;

alter function public.chips_register_bot_only_archive_proof(text,uuid[],bigint[],uuid,text[],text) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_register_bot_only_archive_proof(text,uuid[],bigint[],uuid,text[],text) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_register_bot_only_archive_proof(text,uuid[],bigint[],uuid,text[],text) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_prune_and_cleanup_bot_only_archive_batch(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_registry_keys text[], p_table_id uuid, p_execute boolean, p_approved_batch_id bigint, p_automatic boolean) returns jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  registry_keys_sha256 text;
  prune_result jsonb;
  deleted_registry_count bigint;
  lifecycle_marker timestamptz;
begin
  perform public.chips_assert_production_retention_control('production-ledger-bot-only-retention-7d-v1',pg_catalog.cardinality(p_transaction_ids),false,p_automatic);
  if p_execute is null then raise exception using errcode = 'P8921', message = 'Bot-only execute flag must not be NULL'; end if;
  if p_registry_keys is null
     or pg_catalog.cardinality(p_registry_keys) < 1
     or pg_catalog.cardinality(p_registry_keys) <> pg_catalog.cardinality(p_transaction_ids) then
    raise exception using errcode = 'P8921', message = 'Bot-only cleanup registry key set is invalid';
  end if;
  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.object_path = p_object_path
   for update;
  if not found or batch.project_ref <> 'otbqfijerkieoxwpxjnm' or batch.format_version <> 2 or batch.source_policy_id <> 'production-ledger-bot-only-retention-7d-v1' then
    raise exception using errcode = 'P8921', message = 'Bot-only cleanup requires a canonical Production schema-v2 batch';
  end if;
  perform public.chips_assert_archive_prune_target(batch.project_ref, pg_catalog.cardinality(p_transaction_ids), 'production-ledger-bot-only-retention-7d-v1', p_automatic);
  perform public.chips_assert_production_retention_control(
    batch.source_policy_id,
    pg_catalog.cardinality(p_transaction_ids),
    p_execute
  , p_automatic);
  if batch.bot_only_table_id is distinct from p_table_id
     or batch.transaction_count <> pg_catalog.cardinality(p_transaction_ids)
     or batch.entry_count <> pg_catalog.cardinality(p_entry_ids)
     or batch.archive_proof_verified_at is null
     or batch.archived_transaction_ids_sha256 <> public.chips_archive_uuid_ids_sha256(p_transaction_ids)
     or batch.archived_entry_ids_sha256 <> public.chips_archive_bigint_ids_sha256(p_entry_ids) then
    raise exception using errcode = 'P8921', message = 'Bot-only cleanup arguments do not match immutable proof';
  end if;
  registry_keys_sha256 := public.chips_archive_text_ids_sha256(p_registry_keys);
  if registry_keys_sha256 <> batch.bot_only_registry_keys_sha256 then raise exception using errcode = 'P8921', message = 'Bot-only cleanup keys do not match immutable proof'; end if;

  if batch.registry_cleaned_at is not null then
    if batch.registry_cleaned_key_count <> pg_catalog.cardinality(p_registry_keys)
       or batch.registry_cleaned_keys_sha256 <> registry_keys_sha256 then
      raise exception using errcode = 'P8922', message = 'Existing bot-only cleanup receipt differs from the retry';
    end if;
    -- Closed-table cleanup may legally have removed the table after the
    -- receipt was written.  If it is still present, an empty marker is an
    -- anomaly and must never be silently accepted on replay.
    select tables.bot_only_retention_complete_at
      into lifecycle_marker
      from public.poker_tables tables
     where tables.id = batch.bot_only_table_id;
    if found and lifecycle_marker is null then
      raise exception using errcode = 'P8925', message = 'Existing bot-only cleanup receipt has an empty TABLE lifecycle marker';
    end if;
    return pg_catalog.jsonb_build_object('state', 'already_cleaned', 'transactions', batch.transaction_count, 'registry_keys', batch.registry_cleaned_key_count);
  end if;

  perform public.chips_assert_bot_only_archive_proof_lifecycle_gate(batch.bot_only_table_id, batch.batch_id, batch.cutoff, p_transaction_ids, p_registry_keys, p_automatic);
  if not p_execute then
    prune_result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, false, p_automatic);
    return prune_result || pg_catalog.jsonb_build_object('cleanup', 'prepare_only', 'table_id', batch.bot_only_table_id);
  end if;
  if p_approved_batch_id is distinct from batch.batch_id or batch.destructive_go_batch_id is distinct from batch.batch_id or batch.destructive_go_at is null then
    raise exception using errcode = 'P8923', message = 'Exact bot-only batch GO is required before destructive cleanup';
  end if;

  perform pg_catalog.set_config('chips.production_bot_only_prune', '1', true);
  prune_result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, true, p_automatic);
  perform public.chips_assert_bot_only_archive_proof_lifecycle_gate(batch.bot_only_table_id, batch.batch_id, batch.cutoff, p_transaction_ids, p_registry_keys, p_automatic);
  select count(*) into deleted_registry_count
    from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id
     and registry.idempotency_key = any(p_registry_keys);
  if deleted_registry_count <> pg_catalog.cardinality(p_registry_keys) then raise exception using errcode = 'P8924', message = 'Bot-only registry cleanup set is incomplete'; end if;

  perform pg_catalog.set_config('chips.production_bot_registry_cleanup', '1', true);
  delete from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id
     and registry.idempotency_key = any(p_registry_keys);
  get diagnostics deleted_registry_count = row_count;
  if deleted_registry_count <> pg_catalog.cardinality(p_registry_keys) then raise exception using errcode = 'P8924', message = 'Bot-only registry DELETE count mismatch'; end if;

  perform pg_catalog.set_config('chips.production_bot_only_cleanup', '1', true);
  update public.chips_ledger_archive_batches batches
     set registry_cleaned_at = pg_catalog.timezone('utc', pg_catalog.now()),
         registry_cleaned_key_count = pg_catalog.cardinality(p_registry_keys),
         registry_cleaned_keys_sha256 = registry_keys_sha256
   where batches.batch_id = batch.batch_id
     and batches.registry_cleaned_at is null;
  if not found then raise exception using errcode = 'P8924', message = 'Bot-only cleanup receipt transition was not unique'; end if;

  perform pg_catalog.set_config('chips.production_table_lifecycle', '1', true);
  update public.poker_tables tables
     set bot_only_retention_complete_at = coalesce(tables.bot_only_retention_complete_at, pg_catalog.timezone('utc', pg_catalog.now()))
   where tables.id = batch.bot_only_table_id
     and tables.bot_only_retention_complete_at is null;

  -- The first cleanup is atomic with the lifecycle update: the TABLE row and
  -- its non-empty marker must both be visible here.  Missing rows are legal
  -- only in the already-cleaned branch above, after a prior commit.
  select tables.bot_only_retention_complete_at
    into lifecycle_marker
    from public.poker_tables tables
   where tables.id = batch.bot_only_table_id;
  if not found or lifecycle_marker is null then
    raise exception using errcode = 'P8925', message = 'Bot-only lifecycle completion marker was not persisted';
  end if;

  return prune_result || pg_catalog.jsonb_build_object('state', 'cleaned', 'registry_keys', deleted_registry_count, 'table_id', batch.bot_only_table_id);
end;
$function$;

alter function public.chips_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid,boolean,bigint,boolean) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid,boolean,bigint,boolean) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid,boolean,bigint,boolean) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_prune_and_cleanup_bot_only_archive_batch(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_registry_keys text[], p_table_id uuid, p_execute boolean DEFAULT false, p_approved_batch_id bigint DEFAULT NULL::bigint) returns jsonb language sql security definer set search_path='' as $$
 select public.chips_prune_and_cleanup_bot_only_archive_batch(p_object_path, p_transaction_ids, p_entry_ids, p_registry_keys, p_table_id, p_execute, p_approved_batch_id, false);
$$;

alter function public.chips_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid,boolean,bigint) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid,boolean,bigint) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid,boolean,bigint) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_prune_closed_human_table_archive_batch(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_table_id uuid, p_execute boolean, p_approved_batch_id bigint, p_automatic boolean) returns jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  policy public.chips_production_closed_human_table_retention_policy%rowtype;
  prune_result jsonb;
  receipt_count integer;
  registry_count bigint;
  distinct_table_count bigint;
  null_table_count bigint;
begin
  if p_execute is null then
    raise exception using errcode = 'P9235', message = 'Closed-human execute flag must not be NULL';
  end if;
  if p_table_id is null then
    raise exception using errcode = 'P9235', message = 'Closed-human table identity is required';
  end if;
  if p_object_path is null
     or p_transaction_ids is null
     or p_entry_ids is null
     or pg_catalog.cardinality(p_transaction_ids) < 1
     or pg_catalog.cardinality(p_entry_ids) < 1 then
    raise exception using errcode = 'P9235', message = 'Closed-human exact archive IDs are required';
  end if;
  if p_execute is true and p_approved_batch_id is null then
    raise exception using errcode = 'P9235', message = 'Exact closed-human approved batch is required';
  end if;
  if p_execute is false and p_approved_batch_id is not null then
    raise exception using errcode = 'P9235', message = 'Closed-human approved batch is execute-only';
  end if;

  select batches.*
    into batch
    from public.chips_ledger_archive_batches as batches
   where batches.object_path = p_object_path
   for update;
  if not found
     or batch.project_ref is distinct from 'otbqfijerkieoxwpxjnm'
     or batch.format_version is distinct from 1
     or batch.source_policy_id is distinct from 'production-ledger-closed-human-table-retention-30d-v1'
     or batch.batch_id is null
     or batch.status is distinct from 'committed'
     or batch.committed_at is null
     or batch.cutoff is null
     or coalesce(batch.raw_sha256, '') !~ '^[0-9a-f]{64}$'
     or coalesce(batch.compressed_sha256, '') !~ '^[0-9a-f]{64}$'
     or batch.object_path is distinct from ('v1/sha256/' || batch.compressed_sha256 || '.jsonl.gz')
     or batch.transaction_count is null
     or batch.entry_count is null then
    raise exception using errcode = 'P9235', message = 'Closed-human prune requires one canonical Production batch';
  end if;
  perform public.chips_assert_archive_prune_target(batch.project_ref, pg_catalog.cardinality(p_transaction_ids), batch.source_policy_id, p_automatic);

  receipt_count := pg_catalog.num_nonnulls(
    batch.pruned_at,
    batch.pruned_transaction_count,
    batch.pruned_entry_count,
    batch.pruned_transaction_ids_sha256,
    batch.pruned_entry_ids_sha256
  );
  if receipt_count not in (0, 5) then
    raise exception using errcode = 'P9235', message = 'Closed-human prune receipt is partial';
  end if;

  select policies.*
    into policy
    from public.chips_production_closed_human_table_retention_policy as policies
   where policies.policy_id = 'production-ledger-closed-human-table-retention-30d-v1';
  if not found
     or (
       (policy.enabled is true or policy.activated_at is not null)
       and not p_automatic
     )
     or (
       p_automatic
       and (policy.enabled is not true or policy.activated_at is null)
     ) then
    raise exception using errcode = 'P9235', message = 'Closed-human policy is not in the required manual-only or active automatic state';
  end if;

  if p_execute is true then
    if p_approved_batch_id is distinct from batch.batch_id
       or batch.destructive_go_at is null
       or batch.destructive_go_batch_id is distinct from batch.batch_id
       or (
         not p_automatic
         and (
           policy.canary_batch_id is distinct from batch.batch_id
           or policy.canary_confirmation is distinct from ('GO ' || batch.batch_id::text)
         )
       )
       or (
         p_automatic
         and (policy.enabled is not true or policy.activated_at is null)
       ) then
      raise exception using errcode = 'P9235', message = 'Exact closed-human batch GO is required before execute';
    end if;
  end if;

  -- The existing immutable whitelist is the source of truth for exact IDs,
  -- USER/SYSTEM/ESCROW shapes, counts, conservation, mappings and balances.
  -- Run it read-only first so lifecycle validation sees the same exact batch.
  prune_result := public.chips_prune_committed_archive_batch_internal(
    p_object_path, p_transaction_ids, p_entry_ids, false
  , p_automatic);
  if prune_result->>'state' not in ('ready', 'already_pruned') then
    raise exception using errcode = 'P9235', message = 'Closed-human exact dry-run is not ready';
  end if;
  if (prune_result->>'distinct_tables')::bigint <> 1 then
    raise exception using errcode = 'P9235', message = 'Closed-human batch must bind to exactly one table';
  end if;

  select count(*), count(distinct registry.table_id), count(*) filter (where registry.table_id is null)
    into registry_count, distinct_table_count, null_table_count
    from public.chips_transaction_idempotency as registry
   where registry.transaction_id = any(p_transaction_ids);
  if registry_count <> pg_catalog.cardinality(p_transaction_ids)
     or distinct_table_count <> 1
     or null_table_count <> 0
     or not exists (
       select 1
         from public.chips_transaction_idempotency as registry
        where registry.transaction_id = any(p_transaction_ids)
          and registry.table_id = p_table_id
     ) then
    raise exception using errcode = 'P9235', message = 'Closed-human archive table binding is not exact';
  end if;

  perform public.chips_assert_closed_human_table_lifecycle_gate(
    p_table_id, batch.cutoff, batch.batch_id
  );
  if p_execute is false or prune_result->>'state' = 'already_pruned' then
    return prune_result || pg_catalog.jsonb_build_object(
      'policy_id', batch.source_policy_id,
      'table_id', p_table_id
    );
  end if;

  perform pg_catalog.set_config('chips.production_closed_human_prune', '1', true);
  prune_result := public.chips_prune_committed_archive_batch_internal(
    p_object_path, p_transaction_ids, p_entry_ids, true
  , p_automatic);
  perform public.chips_assert_closed_human_table_lifecycle_gate(
    p_table_id, batch.cutoff, batch.batch_id
  );
  return prune_result || pg_catalog.jsonb_build_object(
    'policy_id', batch.source_policy_id,
    'table_id', p_table_id
  );
end;
$function$;

alter function public.chips_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid,boolean,bigint,boolean) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid,boolean,bigint,boolean) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid,boolean,bigint,boolean) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_prune_closed_human_table_archive_batch(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_table_id uuid, p_execute boolean DEFAULT false, p_approved_batch_id bigint DEFAULT NULL::bigint) returns jsonb language sql security definer set search_path='' as $$
 select public.chips_prune_closed_human_table_archive_batch(p_object_path, p_transaction_ids, p_entry_ids, p_table_id, p_execute, p_approved_batch_id, false);
$$;

alter function public.chips_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid,boolean,bigint) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid,boolean,bigint) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid,boolean,bigint) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_auto_prune_and_cleanup_bot_only_archive_batch(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_registry_keys text[],
  p_table_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  result jsonb;
begin
  if not public.chips_production_bot_only_retention_automatic_active() then
    raise exception using errcode = 'P8954', message = 'Automatic bot-only Production retention is not active';
  end if;
  select batches.*
    into batch
    from public.chips_ledger_archive_batches as batches
   where batches.object_path = p_object_path
   for update;
  if not found
     or batch.project_ref <> 'otbqfijerkieoxwpxjnm'
     or batch.format_version <> 2
     or batch.source_policy_id <> 'production-ledger-bot-only-retention-7d-v1'
     or batch.bot_only_table_id is distinct from p_table_id then
    raise exception using errcode = 'P8955', message = 'Automatic cleanup target is not a canonical Production bot-only batch';
  end if;
  perform public.chips_assert_production_retention_control(
    batch.source_policy_id,
    batch.transaction_count,
    true
  , true);
  if batch.destructive_go_at is null and batch.destructive_go_batch_id is not null then
    raise exception using errcode = 'P8956', message = 'Automatic bot-only batch has a partial GO';
  elsif batch.destructive_go_at is null then
    perform pg_catalog.set_config('chips.production_bot_only_go', '1', true);
    update public.chips_ledger_archive_batches as batches
       set destructive_go_at = pg_catalog.timezone('utc', pg_catalog.now()),
           destructive_go_batch_id = batch.batch_id
     where batches.batch_id = batch.batch_id
       and batches.destructive_go_at is null;
    if not found then
      raise exception using errcode = 'P8956', message = 'Automatic bot-only batch GO transition was not unique';
    end if;
  elsif batch.destructive_go_batch_id is distinct from batch.batch_id then
    raise exception using errcode = 'P8956', message = 'Automatic bot-only batch has a partial or foreign GO';
  end if;
  result := public.chips_prune_and_cleanup_bot_only_archive_batch(
    p_object_path,
    p_transaction_ids,
    p_entry_ids,
    p_registry_keys,
    p_table_id,
    true,
    batch.batch_id
  , true);
  return result || pg_catalog.jsonb_build_object(
    'automatic_policy', 'production-ledger-bot-only-retention-7d-v1'
  );
end;
$$;

alter function public.chips_auto_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid) owner to postgres;
revoke all on function public.chips_auto_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_auto_prune_and_cleanup_bot_only_archive_batch(text,uuid[],bigint[],text[],uuid) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_auto_prune_closed_human_table_archive_batch(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_table_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  policy public.chips_production_closed_human_table_retention_policy%rowtype;
  registry_count bigint;
  distinct_transaction_count bigint;
  distinct_table_count bigint;
  null_table_count bigint;
  exact_table_count bigint;
  foreign_archive_mapping_count bigint;
  receipt_count integer;
  go_count integer;
  result jsonb;
begin
  if not public.chips_production_closed_human_retention_automatic_active() then
    raise exception using errcode = 'P9269', message = 'Automatic closed-human Production retention is not active';
  end if;
  if p_object_path is null
     or p_transaction_ids is null
     or p_entry_ids is null
     or p_table_id is null
     or pg_catalog.cardinality(p_transaction_ids) < 1
     or pg_catalog.cardinality(p_entry_ids) < 1 then
    raise exception using errcode = 'P9270', message = 'Automatic closed-human exact archive binding is required';
  end if;

  select policies.*
    into policy
    from public.chips_production_closed_human_table_retention_policy as policies
   where policies.policy_id = 'production-ledger-closed-human-table-retention-30d-v1';
  if not found
     or policy.enabled is not true
     or policy.canary_batch_id is null
     or policy.canary_confirmation is distinct from ('GO ' || policy.canary_batch_id::text)
     or policy.activation_confirmation is distinct from
       ('ACTIVATE production-ledger-closed-human-table-retention-30d-v1 CANARY ' || policy.canary_batch_id::text)
     or policy.activation_go_at is null
     or policy.activated_at is null then
    raise exception using errcode = 'P9270', message = 'Automatic closed-human Production policy binding is invalid';
  end if;

  select batches.*
    into batch
    from public.chips_ledger_archive_batches as batches
   where batches.object_path = p_object_path
   for update;
  if not found
     or batch.project_ref is distinct from 'otbqfijerkieoxwpxjnm'
     or batch.format_version is distinct from 1
     or batch.source_policy_id is distinct from 'production-ledger-closed-human-table-retention-30d-v1'
     or batch.status is distinct from 'committed'
     or batch.committed_at is null
     or batch.object_path is distinct from ('v1/sha256/' || batch.compressed_sha256 || '.jsonl.gz')
     or batch.batch_id is null
     or batch.transaction_count is null
     or batch.entry_count is null
     or pg_catalog.cardinality(p_transaction_ids) <> batch.transaction_count
     or pg_catalog.cardinality(p_entry_ids) <> batch.entry_count then
    raise exception using errcode = 'P9271', message = 'Automatic closed-human target is not one canonical Production batch';
  end if;
  perform public.chips_assert_production_retention_control(
    batch.source_policy_id,
    batch.transaction_count,
    true
  , true);
  perform public.chips_assert_archive_prune_target(batch.project_ref, batch.transaction_count, batch.source_policy_id, true);

  receipt_count := pg_catalog.num_nonnulls(
    batch.pruned_at,
    batch.pruned_transaction_count,
    batch.pruned_entry_count,
    batch.pruned_transaction_ids_sha256,
    batch.pruned_entry_ids_sha256
  );
  if receipt_count not in (0, 5) then
    raise exception using errcode = 'P9272', message = 'Automatic closed-human prune receipt is partial';
  end if;
  go_count := pg_catalog.num_nonnulls(batch.destructive_go_at, batch.destructive_go_batch_id);
  if go_count not in (0, 2)
     or (go_count = 2 and batch.destructive_go_batch_id is distinct from batch.batch_id)
     or (receipt_count = 5 and go_count <> 2) then
    raise exception using errcode = 'P9272', message = 'Automatic closed-human batch GO is partial or foreign';
  end if;

  select pg_catalog.count(*),
         pg_catalog.count(distinct registry.transaction_id),
         pg_catalog.count(distinct registry.table_id),
         pg_catalog.count(*) filter (where registry.table_id is null),
         pg_catalog.count(*) filter (where registry.table_id = p_table_id),
         pg_catalog.count(*) filter (
           where registry.archive_batch_id is not null
             and registry.archive_batch_id <> batch.batch_id
         )
    into registry_count, distinct_transaction_count, distinct_table_count,
         null_table_count, exact_table_count, foreign_archive_mapping_count
    from public.chips_transaction_idempotency as registry
   where registry.transaction_id = any(p_transaction_ids);
  if registry_count <> batch.transaction_count
     or distinct_transaction_count <> batch.transaction_count
     or distinct_table_count <> 1
     or null_table_count <> 0
     or exact_table_count <> batch.transaction_count
     or foreign_archive_mapping_count <> 0 then
    raise exception using errcode = 'P9273', message = 'Automatic closed-human target registry binding is not exact';
  end if;

  perform public.chips_assert_closed_human_table_lifecycle_gate(
    p_table_id, batch.cutoff, batch.batch_id
  );

  if go_count = 0 then
    perform pg_catalog.set_config('chips.production_closed_human_go', '1', true);
    update public.chips_ledger_archive_batches as batches
       set destructive_go_at = pg_catalog.timezone('utc', pg_catalog.now()),
           destructive_go_batch_id = batch.batch_id
     where batches.batch_id = batch.batch_id
       and batches.destructive_go_at is null
       and batches.destructive_go_batch_id is null;
    if not found then
      raise exception using errcode = 'P9274', message = 'Automatic closed-human batch GO transition was not unique';
    end if;
  end if;

  perform pg_catalog.set_config('chips.production_closed_human_automatic', '1', true);
  result := public.chips_prune_closed_human_table_archive_batch(
    p_object_path,
    p_transaction_ids,
    p_entry_ids,
    p_table_id,
    true,
    batch.batch_id
  , true);
  return result || pg_catalog.jsonb_build_object(
    'automatic_policy', 'production-ledger-closed-human-table-retention-30d-v1',
    'batch_id', batch.batch_id,
    'table_id', p_table_id
  );
end;
$$;

alter function public.chips_auto_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid) owner to postgres;
revoke all on function public.chips_auto_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_auto_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_auto_prune_production_existing_30d_archive_batch(p_object_path text,p_transaction_ids uuid[],p_entry_ids bigint[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.chips_ledger_archive_batches%rowtype; result jsonb;
begin
 select * into b from public.chips_ledger_archive_batches where object_path=p_object_path for update;
 if not found or b.status<>'committed' or b.project_ref<>'otbqfijerkieoxwpxjnm'
 or b.source_policy_id is distinct from 'production-ledger-auto-retention-30d-v1'
 or b.format_version<>1 or b.archive_proof_verified_at is null
 or b.transaction_count is distinct from cardinality(p_transaction_ids) or b.entry_count is distinct from cardinality(p_entry_ids)
 or b.archived_transaction_ids_sha256 is distinct from public.chips_archive_uuid_ids_sha256(p_transaction_ids)
 or b.archived_entry_ids_sha256 is distinct from public.chips_archive_bigint_ids_sha256(p_entry_ids) then raise exception 'Automatic existing-30d exact proof mismatch'; end if;
 perform public.chips_assert_production_retention_control(b.source_policy_id,b.transaction_count,true,true);
 if pg_catalog.num_nonnulls(b.destructive_go_at,b.destructive_go_batch_id) not in (0,2)
 or (b.destructive_go_at is not null and b.destructive_go_batch_id is distinct from b.batch_id)
 or (b.pruned_at is not null and b.destructive_go_at is null) then raise exception 'Automatic existing-30d GO is partial or foreign'; end if;
 if b.destructive_go_at is null then
  perform pg_catalog.set_config('chips.production_existing_30d_automatic_go','1',true);
  update public.chips_ledger_archive_batches set destructive_go_at=pg_catalog.clock_timestamp(),destructive_go_batch_id=b.batch_id where batch_id=b.batch_id and destructive_go_at is null;
 end if;
 result:=public.chips_prune_committed_archive_batch(p_object_path,p_transaction_ids,p_entry_ids,true,true);
 return result;
end;
$$;

alter function public.chips_auto_prune_production_existing_30d_archive_batch(text,uuid[],bigint[]) owner to postgres;
revoke all on function public.chips_auto_prune_production_existing_30d_archive_batch(text,uuid[],bigint[]) from public, anon, authenticated, service_role, postgres;
grant execute on function public.chips_auto_prune_production_existing_30d_archive_batch(text,uuid[],bigint[]) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_guard_archive_batch_mutations() returns trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  call_stack text;
  old_proof_count integer;
  new_proof_count integer;
  old_receipt_count integer;
  new_receipt_count integer;
  old_bot_proof_count integer;
  new_bot_proof_count integer;
  old_cleanup_count integer;
  new_cleanup_count integer;
  proof_changed boolean;
  receipt_changed boolean;
  bot_proof_changed boolean;
  cleanup_changed boolean;
  go_changed boolean;
begin
  get diagnostics call_stack = PG_CONTEXT;
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
    or new.created_at is distinct from old.created_at
    or new.source_policy_id is distinct from old.source_policy_id then
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
  bot_proof_changed := new.bot_only_table_id is distinct from old.bot_only_table_id
    or new.bot_only_table_count is distinct from old.bot_only_table_count
    or new.bot_only_newest_created_at is distinct from old.bot_only_newest_created_at
    or new.bot_only_registry_keys_sha256 is distinct from old.bot_only_registry_keys_sha256
    or new.bot_only_out_of_scope_keys_sha256 is distinct from old.bot_only_out_of_scope_keys_sha256
    or new.bot_only_identity_count is distinct from old.bot_only_identity_count
    or new.bot_only_eligible_count is distinct from old.bot_only_eligible_count;
  cleanup_changed := new.registry_cleaned_at is distinct from old.registry_cleaned_at
    or new.registry_cleaned_key_count is distinct from old.registry_cleaned_key_count
    or new.registry_cleaned_keys_sha256 is distinct from old.registry_cleaned_keys_sha256;
  go_changed := new.destructive_go_at is distinct from old.destructive_go_at
    or new.destructive_go_batch_id is distinct from old.destructive_go_batch_id;

  if proof_changed and receipt_changed then
    raise exception 'Archive proof and prune receipt require separate transitions';
  end if;
  if receipt_changed and cleanup_changed then
    raise exception 'Archive prune receipt and registry cleanup receipt require separate transitions';
  end if;
  if receipt_changed
     and new.format_version = 2
     and (
       coalesce(pg_catalog.current_setting('chips.production_bot_only_prune', true), '') <> '1'
       or new.destructive_go_at is null
       or new.destructive_go_batch_id is distinct from new.batch_id
     ) then
    raise exception using
      errcode = 'P8911',
      message = 'Schema-v2 archive batches require the exact lifecycle operator and batch GO';
  end if;
  if (proof_changed or bot_proof_changed) and current_user <> 'chips_ledger_archive_pruner' then
    raise exception 'Archive proof may only be written by the archive pruner';
  end if;
  if bot_proof_changed
     and coalesce(pg_catalog.current_setting('chips.production_bot_only_proof', true), '') <> '1' then
    raise exception 'Bot-only proof may only be written by the lifecycle proof operator';
  end if;
  if (receipt_changed or cleanup_changed) and current_user <> 'chips_ledger_archive_pruner' then
    raise exception 'Archive receipt may only be written by the archive pruner';
  end if;
  if cleanup_changed
     and coalesce(pg_catalog.current_setting('chips.production_bot_only_cleanup', true), '') <> '1' then
    raise exception 'Registry cleanup receipt may only be written by the lifecycle cleanup operator';
  end if;
  if go_changed and not (
    current_user = 'postgres'
    and (
      coalesce(pg_catalog.current_setting('chips.production_bot_only_go', true), '') = '1'
      or coalesce(pg_catalog.current_setting('chips.production_closed_human_go', true), '') = '1'
      or coalesce(pg_catalog.current_setting('chips.production_canary', true), '') = '1'
      or (coalesce(pg_catalog.current_setting('chips.production_existing_30d_automatic_go',true),'')='1'
          and pg_catalog.strpos(call_stack,'chips_auto_prune_production_existing_30d_archive_batch')>0)
    )
  ) then
    raise exception 'Destructive GO may only be written by the exact authorization function';
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'pending' or new.status <> 'committed'
      or old.committed_at is not null or new.committed_at is null then
      raise exception 'Archive batch status may only transition pending to committed';
    end if;
  elsif new.committed_at is distinct from old.committed_at then
    raise exception 'Archive batch committed_at is immutable';
  end if;

  old_proof_count := pg_catalog.num_nonnulls(old.archived_transaction_ids_sha256, old.archived_entry_ids_sha256, old.archive_proof_verified_at);
  new_proof_count := pg_catalog.num_nonnulls(new.archived_transaction_ids_sha256, new.archived_entry_ids_sha256, new.archive_proof_verified_at);
  if old_proof_count = 0 then
    if new_proof_count not in (0, 3) then raise exception 'Archive ID proof must transition from empty to complete'; end if;
    if new_proof_count = 3 and new.status <> 'committed' then raise exception 'Archive ID proof requires a committed batch'; end if;
  elsif proof_changed then
    raise exception 'Archive ID proof cannot be replaced or cleared';
  end if;

  old_receipt_count := pg_catalog.num_nonnulls(old.pruned_at, old.pruned_transaction_count, old.pruned_entry_count, old.pruned_transaction_ids_sha256, old.pruned_entry_ids_sha256);
  new_receipt_count := pg_catalog.num_nonnulls(new.pruned_at, new.pruned_transaction_count, new.pruned_entry_count, new.pruned_transaction_ids_sha256, new.pruned_entry_ids_sha256);
  if old_receipt_count = 0 then
    if new_receipt_count not in (0, 5) then raise exception 'Archive prune receipt must transition from empty to complete'; end if;
    if new_receipt_count = 5 and new_proof_count <> 3 then raise exception 'Archive prune receipt requires an immutable ID proof'; end if;
  elsif receipt_changed then
    raise exception 'Archive prune receipt cannot be replaced or cleared';
  end if;

  old_bot_proof_count := pg_catalog.num_nonnulls(old.bot_only_table_id, old.bot_only_table_count, old.bot_only_newest_created_at, old.bot_only_registry_keys_sha256, old.bot_only_out_of_scope_keys_sha256, old.bot_only_identity_count, old.bot_only_eligible_count);
  new_bot_proof_count := pg_catalog.num_nonnulls(new.bot_only_table_id, new.bot_only_table_count, new.bot_only_newest_created_at, new.bot_only_registry_keys_sha256, new.bot_only_out_of_scope_keys_sha256, new.bot_only_identity_count, new.bot_only_eligible_count);
  if old_bot_proof_count = 0 then
    if new_bot_proof_count not in (0, 7) then raise exception 'Bot-only proof must transition from empty to complete'; end if;
    if new_bot_proof_count = 7 and (new.status <> 'committed' or new.format_version <> 2) then raise exception 'Bot-only proof requires a committed schema-v2 batch'; end if;
  elsif bot_proof_changed then
    raise exception 'Bot-only proof cannot be replaced or cleared';
  end if;

  old_cleanup_count := pg_catalog.num_nonnulls(old.registry_cleaned_at, old.registry_cleaned_key_count, old.registry_cleaned_keys_sha256);
  new_cleanup_count := pg_catalog.num_nonnulls(new.registry_cleaned_at, new.registry_cleaned_key_count, new.registry_cleaned_keys_sha256);
  if old_cleanup_count = 0 then
    if new_cleanup_count not in (0, 3) then raise exception 'Registry cleanup receipt must transition from empty to complete'; end if;
    if new_cleanup_count = 3 and new_receipt_count <> 5 then raise exception 'Registry cleanup receipt requires a complete ledger prune receipt'; end if;
    if new_cleanup_count = 3 and not (
      (new.source_policy_id = 'production-ledger-bot-only-retention-7d-v1' and new_bot_proof_count = 7)
      or (
        new.format_version = 1
        and new.source_policy_id = 'production-ledger-auto-retention-30d-v1'
        and new_bot_proof_count = 0
      )
    ) then
      raise exception 'Registry cleanup receipt requires matching immutable proof basis';
    end if;
  elsif cleanup_changed then
    raise exception 'Registry cleanup receipt cannot be replaced or cleared';
  end if;

  if old.destructive_go_at is not null and go_changed then
    raise exception 'Destructive GO cannot be replaced or cleared';
  end if;
  return new;
end;
$function$;

-- Preserve the existing disable-only API. Clear activation fields atomically
-- to satisfy the original OFF-state CHECK; E3 history still prevents re-enable.
create or replace function public.chips_set_production_retention_enabled(p_enabled boolean,p_max_transactions integer default 2,p_confirmation text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if current_user<>'postgres' or p_enabled is not false or p_max_transactions is distinct from 2
 or p_confirmation is distinct from 'DISABLE PRODUCTION RETENTION'
 or (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from '7575202818581710058' then raise exception 'Exact Production disable-only authorization required'; end if;
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm',0)) then raise exception 'Production disable lock busy'; end if;
 update public.chips_production_retention_control set enabled=false,max_transactions=2,activated_at=null,activation_confirmation=null,updated_at=clock_timestamp() where control_id is true;
 return jsonb_build_object('state','disabled','max_transactions',2);
end;
$$;
alter function public.chips_set_production_retention_enabled(boolean,integer,text) owner to postgres;
revoke all on function public.chips_set_production_retention_enabled(boolean,integer,text) from public,anon,authenticated,service_role,chips_ledger_archive_pruner;
grant execute on function public.chips_set_production_retention_enabled(boolean,integer,text) to postgres;

-- Private Storage GET/byte evidence is external to PostgreSQL. Expected durable
-- archive hashes equal compressed_sha256 above; manifest hashes are:
-- batch2 abb6b98096dd3aa04c98e450d8aea5eb9b6c5a19c2c993a134e2ca71f7caeaea
-- batch3 cd1248863ff318addbfe581d037f70778afdd79176650af05519394f5231c189
-- batch4 72e2f005c82dda1171380b3748078747ab68ac9c2e47c123a61b274c837bdd8e
create or replace function public.chips_activate_production_retention(p_confirmation text,p_preflight_sha256 text,p_preflight_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare expected jsonb; pair record; b public.chips_ledger_archive_batches%rowtype; c public.chips_production_retention_control%rowtype;
 rows_expected jsonb := $pins$[
  {
    "batch_id": 2,
    "project_ref": "otbqfijerkieoxwpxjnm",
    "status": "committed",
    "source_policy_id": "production-ledger-auto-retention-30d-v1",
    "format_version": 1,
    "transaction_count": 2,
    "entry_count": 4,
    "object_path": "v1/sha256/5e4ce1100e82555135bd761951beaaa83095a13d966306c003b7f474bf55f367.jsonl.gz",
    "raw_sha256": "7d117aef6bbc21dbce030cc0859092bed132a82c764178f585b37cc6cf0d63f0",
    "compressed_sha256": "5e4ce1100e82555135bd761951beaaa83095a13d966306c003b7f474bf55f367",
    "archived_transaction_ids_sha256": "ea3085b290ae32be4eb34419afb04ea55caddcbca0801fc7b1ca47972e3fd010",
    "archived_entry_ids_sha256": "f224a1028f71b277fe725c6c6a2097b4c44872780100a7c46666bb8dab130aa6",
    "pruned_transaction_count": 2,
    "pruned_entry_count": 4,
    "pruned_transaction_ids_sha256": "ea3085b290ae32be4eb34419afb04ea55caddcbca0801fc7b1ca47972e3fd010",
    "pruned_entry_ids_sha256": "f224a1028f71b277fe725c6c6a2097b4c44872780100a7c46666bb8dab130aa6",
    "destructive_go_batch_id": 2,
    "cutoff": "2026-08-14T21:54:00.245Z",
    "archive_proof_verified_at": "2026-09-13T21:54:01.998395Z",
    "pruned_at": "2026-09-14T08:32:49.627231Z",
    "destructive_go_at": "2026-09-14T08:32:49.309998Z",
    "registry_cleaned_at": null,
    "registry_cleaned_key_count": null,
    "registry_cleaned_keys_sha256": null
  },
  {
    "batch_id": 3,
    "project_ref": "otbqfijerkieoxwpxjnm",
    "status": "committed",
    "source_policy_id": "production-ledger-bot-only-retention-7d-v1",
    "format_version": 2,
    "transaction_count": 2,
    "entry_count": 4,
    "object_path": "v1/sha256/bec1c7db4fd65a3af000ee943c71cc100208af4a7f7cd1ab15706f9826d06ce1.jsonl.gz",
    "raw_sha256": "361ef011cfffae4fef297c1336af2127bcdfed8c633126d3149a866dcc1205d8",
    "compressed_sha256": "bec1c7db4fd65a3af000ee943c71cc100208af4a7f7cd1ab15706f9826d06ce1",
    "archived_transaction_ids_sha256": "30998c2ebc5c57f806f3221c0646762ce94b0e35edc91c60fccec1659d222265",
    "archived_entry_ids_sha256": "03d3abb1b360a614b48081beb0e9cf8fe51aadb79cacb8b6e4a9017d06951a9c",
    "pruned_transaction_count": 2,
    "pruned_entry_count": 4,
    "pruned_transaction_ids_sha256": "30998c2ebc5c57f806f3221c0646762ce94b0e35edc91c60fccec1659d222265",
    "pruned_entry_ids_sha256": "03d3abb1b360a614b48081beb0e9cf8fe51aadb79cacb8b6e4a9017d06951a9c",
    "destructive_go_batch_id": 3,
    "cutoff": "2026-09-15T11:59:30.415Z",
    "archive_proof_verified_at": "2026-09-22T11:59:35.095601Z",
    "pruned_at": "2026-09-22T14:46:43.156875Z",
    "destructive_go_at": "2026-09-22T13:00:06.487919Z",
    "bot_only_table_id": "396a48fd-4b61-4992-8635-0820f3b68c74",
    "bot_only_table_count": "1",
    "bot_only_registry_keys_sha256": "2e78bf8cf3e598f0dcd83a61c81582f8746070459122307124d38d4ff0d602f5",
    "bot_only_out_of_scope_keys_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "bot_only_identity_count": "2",
    "bot_only_eligible_count": "2",
    "registry_cleaned_key_count": "2",
    "registry_cleaned_keys_sha256": "2e78bf8cf3e598f0dcd83a61c81582f8746070459122307124d38d4ff0d602f5",
    "account_retirement_account_count": "1",
    "account_retirement_account_ids_sha256": "c342d5eb1395883fa642c17839a5a251438e59355ee9cba4c7f1fc6dffc0112f",
    "account_retirement_recovery_object_path": "account-recovery/v1/sha256/ae887c5e1b3d9441089d53604a7fb49a9fdb33ec9f3a264051db0acff3b6dc87.json.gz",
    "account_retirement_recovery_object_sha256": "ae887c5e1b3d9441089d53604a7fb49a9fdb33ec9f3a264051db0acff3b6dc87",
    "account_retirement_snapshot_sha256": "a35ad9c46440bed7c882a901c26ca18e832ce1ef1b9fff0b0da7ec8447e201ae",
    "registry_cleaned_at": "2026-09-22T14:46:43.156875Z",
    "account_retirement_at": "2026-09-22T19:44:42.167617Z"
  },
  {
    "batch_id": 4,
    "project_ref": "otbqfijerkieoxwpxjnm",
    "status": "committed",
    "source_policy_id": "production-ledger-closed-human-table-retention-30d-v1",
    "format_version": 1,
    "transaction_count": 2,
    "entry_count": 4,
    "object_path": "v1/sha256/28a2a4332723d3e60a7dfd04ab48f73132091782109780cb21c1696be39f947e.jsonl.gz",
    "raw_sha256": "20f8b84b3eeffec797d994fedbe4dc12fce48fe75b47e97568177b5b7872f90a",
    "compressed_sha256": "28a2a4332723d3e60a7dfd04ab48f73132091782109780cb21c1696be39f947e",
    "archived_transaction_ids_sha256": "0d655736aff808a8604c4acf07ad3d09422ba9becbc39c6af26b727a847a0345",
    "archived_entry_ids_sha256": "05ae84b7b64161c146501c8c114e6637cd65c6eef7c1373905ed92e87e241eda",
    "pruned_transaction_count": 2,
    "pruned_entry_count": 4,
    "pruned_transaction_ids_sha256": "0d655736aff808a8604c4acf07ad3d09422ba9becbc39c6af26b727a847a0345",
    "pruned_entry_ids_sha256": "05ae84b7b64161c146501c8c114e6637cd65c6eef7c1373905ed92e87e241eda",
    "destructive_go_batch_id": 4,
    "cutoff": "2026-09-14T18:39:21.779Z",
    "archive_proof_verified_at": "2026-10-14T19:28:07.024825Z",
    "pruned_at": "2026-10-14T19:39:19.683188Z",
    "destructive_go_at": "2026-10-14T19:39:17.466354Z",
    "registry_cleaned_at": null,
    "registry_cleaned_key_count": null,
    "registry_cleaned_keys_sha256": null
  }
]$pins$::jsonb;
 timestamp_fields text[] := array['cutoff','archive_proof_verified_at','pruned_at','destructive_go_at','registry_cleaned_at','account_retirement_at','bot_only_newest_created_at'];
begin
 if session_user<>'postgres' or current_setting('chips.production_project_ref',true) is distinct from 'otbqfijerkieoxwpxjnm'
 or (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from '7575202818581710058'
 or p_preflight_sha256 is null or p_preflight_sha256 !~ '^[0-9a-f]{64}$'
 or p_confirmation is distinct from ('ACTIVATE PRODUCTION RETENTION otbqfijerkieoxwpxjnm '||p_preflight_sha256)
 or p_preflight_at is null or p_preflight_at>pg_catalog.clock_timestamp()
 or p_preflight_at<pg_catalog.clock_timestamp()-interval '15 minutes' then raise exception 'E3 fresh owner Storage/DB attestation required'; end if;
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm',0)) then raise exception 'E3 lock busy'; end if;
 select * into c from public.chips_production_retention_control where control_id is true for update;
 if not found or not public.chips_table_fence_is_active() then raise exception 'E3 control/fence missing'; end if;
 perform 1 from public.chips_production_bot_only_retention_policy for update;
 perform 1 from public.chips_production_closed_human_table_retention_policy for update;
 perform 1 from public.chips_production_escrow_account_retention_policy for update;
 for expected in select value from jsonb_array_elements(rows_expected) loop
  select * into b from public.chips_ledger_archive_batches where batch_id=(expected->>'batch_id')::bigint for update;
  if not found or b.committed_at is null then raise exception 'E3 canary batch absent'; end if;
  if b.batch_id=3 and (b.bot_only_newest_created_at is null or b.bot_only_newest_created_at>=b.cutoff) then raise exception 'E3 bot proof age is invalid'; end if;
  for pair in select * from jsonb_each(expected) loop
   if pair.key=any(timestamp_fields) then
    if (to_jsonb(b)->>pair.key)::timestamptz is distinct from (expected->>pair.key)::timestamptz then raise exception 'E3 canary timestamp drift: %/%',b.batch_id,pair.key; end if;
   elsif (to_jsonb(b)->>pair.key) is distinct from (expected->>pair.key) then raise exception 'E3 canary evidence drift: %/%',b.batch_id,pair.key; end if;
  end loop;
 end loop;
 if exists(select 1 from public.chips_transactions where id=any(array['26899ac1-d3c2-4382-8954-06d98823278a','5815f81f-870a-4c3c-9879-ddeef0db4b1e','856278b7-ddb3-4c46-af8f-a7fefda7f1c8','9e010041-66e0-4d95-9b4a-db95ca1389b2','8948e05e-ca00-4fc4-97ec-baff3ce710a1','f9529116-fc6f-419c-a563-90487d6845ef']::uuid[]))
 or exists(select 1 from public.chips_entries where id=any(array[4469,4470,4471,4472,4741,4742,4743,4744,4747,4748,4749,4750]::bigint[]))
 or exists(select 1 from public.chips_ledger_archive_batches where project_ref='otbqfijerkieoxwpxjnm' and pruned_at is null and source_policy_id in ('production-ledger-auto-retention-30d-v1','production-ledger-bot-only-retention-7d-v1','production-ledger-closed-human-table-retention-30d-v1')) then raise exception 'E3 hot/incomplete canary or active batch'; end if;
 perform 1 from public.chips_transaction_idempotency where archive_batch_id in (2,3,4) for update;
 if (select count(*) from public.chips_transaction_idempotency where archive_batch_id=2)<>2
 or (select count(*) from public.chips_transaction_idempotency where archive_batch_id=4)<>2
 or (select count(*) from public.chips_transaction_idempotency where transaction_id=any(array['26899ac1-d3c2-4382-8954-06d98823278a','5815f81f-870a-4c3c-9879-ddeef0db4b1e']::uuid[]) and archive_batch_id=2)<>2
 or (select count(*) from public.chips_transaction_idempotency where transaction_id=any(array['8948e05e-ca00-4fc4-97ec-baff3ce710a1','f9529116-fc6f-419c-a563-90487d6845ef']::uuid[]) and archive_batch_id=4 and table_id='7f3d73e4-36c5-4b66-afe6-d1d41bea13e2')<>2
 or exists(select 1 from public.chips_transaction_idempotency where archive_batch_id=3 or table_id='396a48fd-4b61-4992-8635-0820f3b68c74') then raise exception 'E3 retained/cleaned registry mismatch'; end if;
 perform 1 from public.poker_tables where id='7f3d73e4-36c5-4b66-afe6-d1d41bea13e2' for update;
 if not exists(select 1 from public.poker_tables where id='7f3d73e4-36c5-4b66-afe6-d1d41bea13e2' and human_retention_complete_at='2026-10-14T20:39:44.985066Z'::timestamptz)
 or exists(select 1 from public.poker_tables where id='396a48fd-4b61-4992-8635-0820f3b68c74')
 or exists(select 1 from public.chips_accounts where id='c29325f1-0715-453e-b090-fde88fa2ada7' or system_key='POKER_TABLE:396a48fd-4b61-4992-8635-0820f3b68c74') then raise exception 'E3 human completion/escrow retirement missing'; end if;
 perform public.chips_assert_closed_human_table_lifecycle_gate('7f3d73e4-36c5-4b66-afe6-d1d41bea13e2','2026-09-14T18:39:21.779Z',null);
 if p_preflight_at<pg_catalog.clock_timestamp()-interval '15 minutes' then raise exception 'E3 attestation expired during DB validation'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260914092000') then
  -- Reapply never re-enables emergency-disabled control or rewrites activation.
  return jsonb_build_object('state','already_applied','enabled',c.enabled,'max_transactions',c.max_transactions);
 end if;
 if c.enabled is not false or c.max_transactions<>2 or c.existing_30d_canary_batch_id is distinct from 2::bigint
 or not exists(select 1 from public.chips_production_bot_only_retention_policy where enabled is false and canary_batch_id=3 and canary_confirmation='GO 3')
 or not exists(select 1 from public.chips_production_closed_human_table_retention_policy where enabled is false and canary_batch_id=4 and canary_confirmation='GO 4')
 or not exists(select 1 from public.chips_production_escrow_account_retention_policy where enabled is false and canary_batch_id=3 and canary_account_ids_sha256='c342d5eb1395883fa642c17839a5a251438e59355ee9cba4c7f1fc6dffc0112f' and canary_confirmation='GO 3') then raise exception 'E3 OFF/cap2/canary pointers mismatch'; end if;
 update public.chips_production_bot_only_retention_policy set enabled=true,activation_go_at=clock_timestamp(),activated_at=clock_timestamp(),activation_confirmation='ACTIVATE production-ledger-bot-only-retention-7d-v1 CANARY 3';
 update public.chips_production_closed_human_table_retention_policy set enabled=true,activation_go_at=clock_timestamp(),activated_at=clock_timestamp(),activation_confirmation='ACTIVATE production-ledger-closed-human-table-retention-30d-v1 CANARY 4';
 perform pg_catalog.set_config('chips.escrow_account_retention_policy','1',true);
 update public.chips_production_escrow_account_retention_policy set enabled=true,activation_go_at=clock_timestamp(),activated_at=clock_timestamp(),activation_confirmation='ACTIVATE production-ledger-escrow-account-retention-v1 CANARY 3 ACCOUNTS '||canary_account_ids_sha256;
 update public.chips_production_retention_control set enabled=true,max_transactions=5000,activated_at=clock_timestamp(),activation_confirmation=p_confirmation,updated_at=clock_timestamp() where control_id is true;
 return jsonb_build_object('state','activated','max_transactions',5000);
end;
$$;
alter function public.chips_activate_production_retention(text,text,timestamptz) owner to postgres;
revoke all on function public.chips_activate_production_retention(text,text,timestamptz) from public,anon,authenticated,service_role,chips_ledger_archive_pruner;
grant execute on function public.chips_activate_production_retention(text,text,timestamptz) to postgres;

-- Revoke only this transaction's delegation, preserving the managed grantor
-- and its original ADMIN/INHERIT/SET options. Failures roll back both grants.
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres granted by postgres;

select public.chips_activate_production_retention(
 current_setting('chips.production_activation_confirmation',true),
 current_setting('chips.production_preflight_sha256',true),
 nullif(current_setting('chips.production_preflight_at',true),'')::timestamptz
);
insert into supabase_migrations.schema_migrations(version) values('20260914092000')
 on conflict(version) do nothing;
commit;
