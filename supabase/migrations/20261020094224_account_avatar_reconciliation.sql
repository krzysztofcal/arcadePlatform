-- LOCAL ONLY; no remote apply/markers/reconciliation authorized.
-- Operator inventory must cite real ownership and terminal-operation evidence.
begin;
alter table private.avatar_tracking_cutover add column reconciliation_inventory jsonb not null default '{}'::jsonb check(jsonb_typeof(reconciliation_inventory)='object');

-- Original rows/acknowledgements are never rewritten. Only a canonical worker
-- may record a NEW deletion observation under a real owner/request/lease.
create function private.account_avatar_manifest_reconciled(uid uuid,rid uuid,mid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(exists(select 1 from public.profile_avatar_uploads u
 join public.account_deletion_requests r on r.request_id=rid and r.old_user_id=uid
 join private.avatar_tracking_cutover c on c.marker=r.progress->'avatarReconciliations'->mid::text->>'marker'
 where u.id=mid and u.user_id=uid and c.legacy_inventory_verified
 and c.upload_bucket='profile-avatar-uploads' and c.public_bucket='profile-avatars'
 and c.cutover_at+interval '7200 seconds'<=clock_timestamp()
 and r.progress->'avatarReconciliations'->mid::text->>'owner'=uid::text
 and r.progress->'avatarReconciliations'->mid::text->>'requestId'=rid::text
 and r.progress->'avatarReconciliations'->mid::text->>'snapshotDigest'=md5(to_jsonb(u)::text)
 and r.progress->'avatarReconciliations'->mid::text->>'deletedAt' is not null
 and r.progress->'avatarReconciliations'->mid::text->'inventory'=c.reconciliation_inventory->mid::text),false);
$$;

create function private.account_avatar_reconciliation_plan(uid uuid,rid uuid,generation bigint,marker_key text)
returns table(id uuid,source_path text,output_path text,snapshot_digest text,inventory_digest text)
language plpgsql security definer set search_path='' as $$
declare req public.account_deletion_requests; cut private.avatar_tracking_cutover; u public.profile_avatar_uploads; e jsonb;
begin
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('account-lifecycle:'||uid::text,0)) then
 raise exception using errcode='40001',message='Account lifecycle busy'; end if;
 select * into req from public.account_deletion_requests where request_id=rid for update;
 if req.old_user_id is distinct from uid or req.status<>'PROCESSING' or req.phase<>'cleanup'
 or req.lease_generation is distinct from generation or req.lease_until is null or req.lease_until<=clock_timestamp()
 or not private.account_avatar_guards_ready() then raise exception using errcode='42501',message='Avatar reconciliation lease invalid'; end if;
 select * into cut from private.avatar_tracking_cutover where marker=marker_key for share;
 if cut.marker is null or not cut.legacy_inventory_verified or cut.upload_bucket<>'profile-avatar-uploads' or cut.public_bucket<>'profile-avatars'
 or cut.cutover_at+interval '7200 seconds'>clock_timestamp() then raise exception using errcode='42501',message='Avatar inventory not ready'; end if;
 -- Validate ALL uncertain rows before any external removal, not only first batch.
 for u in select * from public.profile_avatar_uploads p where p.user_id=uid
 and (p.tracking_version is distinct from 3 or p.signing_finished_at is null or p.capability_until is null
 or (p.output_write_started_at is not null and p.output_write_finished_at is null))
 and not private.account_avatar_manifest_reconciled(uid,rid,p.id) order by p.id loop
  e:=cut.reconciliation_inventory->u.id::text;
  if (u.tracking_version is not null and u.tracking_version<>3)
  or (u.tracking_version is null and (u.consumed_at is not null or u.output_path is not null))
  or e is null or e->>'owner' is distinct from uid::text or e->>'sourcePath' is distinct from u.source_path
  or e->>'outputPath' is distinct from u.output_path or e->>'snapshotDigest' is distinct from md5(to_jsonb(u)::text)
  or coalesce(length(e->>'ownershipEvidence'),0) not between 1 and 1000
  or coalesce(length(e->>'terminalEvidence'),0) not between 1 and 1000
  or u.source_path is distinct from 'pending/'||u.id::text
  or (u.output_path is not null and u.output_path !~ '^[0-9a-f-]{36}\.webp$')
  or u.capability_until>clock_timestamp() then raise exception using errcode='42501',message='Avatar reconciliation evidence missing'; end if;
 end loop;
 return query select p.id,p.source_path,p.output_path,md5(to_jsonb(p)::text),md5((cut.reconciliation_inventory->p.id::text)::text)
 from public.profile_avatar_uploads p where p.user_id=uid
 and (p.tracking_version is distinct from 3 or p.signing_finished_at is null or p.capability_until is null
 or (p.output_write_started_at is not null and p.output_write_finished_at is null))
 and not private.account_avatar_manifest_reconciled(uid,rid,p.id) order by p.id limit 1;
end $$;

create function private.account_avatar_record_reconciliation(uid uuid,rid uuid,generation bigint,marker_key text,mid uuid,snapshot_hash text,inventory_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare candidate record; entry jsonb;
begin
 select * into candidate from private.account_avatar_reconciliation_plan(uid,rid,generation,marker_key) p where p.id=mid;
 if candidate.id is null or candidate.snapshot_digest is distinct from snapshot_hash or candidate.inventory_digest is distinct from inventory_hash then
 raise exception using errcode='42501',message='Avatar reconciliation changed'; end if;
 select reconciliation_inventory->mid::text into entry from private.avatar_tracking_cutover where marker=marker_key;
 update public.account_deletion_requests set progress_at=clock_timestamp(),actionable_since=clock_timestamp(),progress=progress||jsonb_build_object('avatarReconciliations',
 coalesce(progress->'avatarReconciliations','{}'::jsonb)||jsonb_build_object(mid::text,jsonb_build_object(
 'owner',uid,'requestId',rid,'generation',generation,'marker',marker_key,'snapshotDigest',snapshot_hash,'inventory',entry,'deletedAt',clock_timestamp())))
 where request_id=rid and status='PROCESSING' and phase='cleanup' and lease_generation=generation and lease_until>clock_timestamp();
 if not found then raise exception using errcode='42501',message='Avatar reconciliation lease invalid'; end if;
end $$;
create or replace function public.account_avatar_manifest_guard_v3() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner uuid; req public.account_deletion_requests;
begin
 owner := case when tg_op='DELETE' then old.user_id else new.user_id end;
 if owner is null then raise exception using errcode='42501',message='Avatar owner required'; end if;
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('account-lifecycle:'||owner::text,0)) then
   raise exception using errcode='40001',message='Account lifecycle busy';
 end if;
 if tg_op='DELETE' then
   -- Only the authorized Auth FK cascade may purge manifests. A plain legacy
   -- DELETE cannot satisfy parent absence + nested trigger + durable lease proof.
   select * into req from public.account_deletion_requests where old_user_id=owner;
   if pg_trigger_depth()<2 or exists(select 1 from auth.users where id=owner)
      or req.request_id is null or req.status<>'PROCESSING' or req.phase<>'auth'
      or req.lease_until is null or req.lease_until<=clock_timestamp()
      or req.progress->'cleanup'->>'done' is distinct from 'true'
      or req.progress->>'authIntent' is distinct from 'true'
      or req.progress->'avatarPurge'->>'requestId' is distinct from req.request_id::text
      or req.progress->'avatarPurge'->>'owner' is distinct from owner::text
      or ((old.tracking_version is distinct from 3 or old.signing_finished_at is null
      or old.capability_until is null or old.source_deleted_at is null
      or (old.output_path is not null and (old.output_write_finished_at is null or old.output_deleted_at is null)))
         and not private.account_avatar_manifest_reconciled(owner,req.request_id,old.id)) then
     raise exception using errcode='42501',message='Avatar manifest purge not authorized';
   end if;
   return old;
 end if;
 if tg_op='INSERT' then
   if new.tracking_version is distinct from 3 or new.source_path is distinct from 'pending/'||new.id::text
      or new.consumed_at is not null or new.signing_finished_at is not null or new.capability_until is not null
      or new.output_path is not null or new.output_write_started_at is not null or new.output_write_finished_at is not null
      or new.source_deleted_at is not null or new.output_deleted_at is not null then
     raise exception using errcode='42501',message='Avatar tracking protocol required';
   end if;
 else
   if new.id is distinct from old.id or new.user_id is distinct from old.user_id
      or new.source_path is distinct from old.source_path or new.tracking_version is distinct from old.tracking_version
      or new.declared_mime_type is distinct from old.declared_mime_type or new.declared_size is distinct from old.declared_size
      or new.created_at is distinct from old.created_at or new.expires_at is distinct from old.expires_at
      or old.tracking_version is distinct from 3
      or (old.signing_finished_at is not null and new.signing_finished_at is distinct from old.signing_finished_at)
      or (old.capability_until is not null and new.capability_until is distinct from old.capability_until)
      or (old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at)
      or (old.output_path is not null and new.output_path is distinct from old.output_path)
      or (old.output_write_started_at is not null and new.output_write_started_at is distinct from old.output_write_started_at)
      or (old.output_write_finished_at is not null and new.output_write_finished_at is distinct from old.output_write_finished_at)
      or (old.source_deleted_at is not null and new.source_deleted_at is distinct from old.source_deleted_at)
      or (old.output_deleted_at is not null and new.output_deleted_at is distinct from old.output_deleted_at) then
     raise exception using errcode='42501',message='Avatar manifest evidence is immutable';
   end if;
   if new.consumed_at is distinct from old.consumed_at then
     if new.consumed_at is null or new.output_path is null or new.output_path !~ '^[0-9a-f-]{36}\.webp$'
        or new.output_write_started_at is null or new.signing_finished_at is null then
       raise exception using errcode='42501',message='Avatar finalize intent required';
     end if;
     if not exists(select 1 from auth.users where id=owner)
        or exists(select 1 from public.account_deletion_requests where old_user_id=owner) then
       raise exception using errcode='42501',message='Account is not active';
     end if;
   elsif new.output_path is distinct from old.output_path or new.output_write_started_at is distinct from old.output_write_started_at then
     raise exception using errcode='42501',message='Avatar finalize intent must be atomic';
   end if;
 end if;
 if (new.signing_finished_at is null) <> (new.capability_until is null)
    or new.capability_until < new.signing_finished_at+interval '7200 seconds'
    or (new.output_write_finished_at is not null and new.output_write_started_at is null) then
   raise exception using errcode='42501',message='Avatar receipt invalid';
 end if;
 return new;
end $$;
create or replace function private.account_avatar_prepare_purge(uid uuid,rid uuid,generation bigint,marker_key text) returns void
language plpgsql security definer set search_path='' as $$
declare req public.account_deletion_requests; cut private.avatar_tracking_cutover;
begin
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('account-lifecycle:'||uid::text,0)) then
 raise exception using errcode='40001',message='Account lifecycle busy'; end if;
 select * into req from public.account_deletion_requests where request_id=rid for update;
 if req.old_user_id is distinct from uid or req.status<>'PROCESSING' or req.phase<>'cleanup'
    or req.lease_generation is distinct from generation or req.lease_until is null or req.lease_until<=clock_timestamp()
    or not private.account_avatar_guards_ready() then
   raise exception using errcode='42501',message='Avatar purge lease invalid';
 end if;
 select * into cut from private.avatar_tracking_cutover where marker=marker_key for share;
 if cut.marker is null or not cut.legacy_inventory_verified or cut.upload_bucket<>'profile-avatar-uploads' or cut.public_bucket<>'profile-avatars'
    or cut.cutover_at+interval '7200 seconds'>clock_timestamp()
    or exists(select 1 from public.profile_avatar_uploads where user_id=uid and not private.account_avatar_manifest_reconciled(uid,rid,id) and
      (tracking_version is distinct from 3 or signing_finished_at is null or capability_until is null
       or capability_until>clock_timestamp()
       or source_deleted_at is null or (output_path is not null and
         (output_write_finished_at is null or output_deleted_at is null))))
    or exists(select 1 from private.account_avatar_objects where user_id=uid and deleted_at is null) then
   raise exception using errcode='42501',message='Avatar closure unconfirmed';
 end if;
 update public.account_deletion_requests set progress=jsonb_set(progress,'{avatarPurge}',
   jsonb_build_object('requestId',rid,'owner',uid,'generation',generation,'marker',marker_key)) where request_id=rid and status='PROCESSING' and phase='cleanup' and lease_generation=generation and lease_until>clock_timestamp();
 if not found then raise exception using errcode='42501',message='Avatar purge lease invalid'; end if;
 -- Keep public manifests until the authorized Auth cascade. This avoids any
 -- session boolean/GUC or role-name bypass for legacy DELETE statements.
end $$;
revoke all on function private.account_avatar_manifest_reconciled(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.account_avatar_manifest_reconciled(uuid,uuid,uuid) to service_role;
revoke all on function private.account_avatar_reconciliation_plan(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function private.account_avatar_reconciliation_plan(uuid,uuid,bigint,text) to service_role;
revoke all on function private.account_avatar_record_reconciliation(uuid,uuid,bigint,text,uuid,text,text) from public,anon,authenticated;
grant execute on function private.account_avatar_record_reconciliation(uuid,uuid,bigint,text,uuid,text,text) to service_role;
commit;
