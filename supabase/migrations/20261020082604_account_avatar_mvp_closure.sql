-- MVP owner decision: unknown post-expiry in-flight completion is accepted risk.
-- Keep actual uncertainty, inventory, capability expiry, receipts and lease fences.
-- Provider fields remain historical evidence, never fabricated or rewritten.
begin;
create or replace function private.account_avatar_prepare_purge(uid uuid,rid uuid,generation bigint,marker_key text) returns void
language plpgsql security definer set search_path='' as $$
declare req public.account_deletion_requests; cut private.avatar_tracking_cutover;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-lifecycle:'||uid::text,0));
 select * into req from public.account_deletion_requests where request_id=rid for update;
 if req.old_user_id is distinct from uid or req.status<>'PROCESSING' or req.phase<>'cleanup'
    or req.lease_generation is distinct from generation or req.lease_until is null or req.lease_until<=clock_timestamp()
    or not private.account_avatar_guards_ready() then
   raise exception using errcode='42501',message='Avatar purge lease invalid';
 end if;
 select * into cut from private.avatar_tracking_cutover where marker=marker_key for share;
 if cut.marker is null or not cut.legacy_inventory_verified or cut.upload_bucket<>'profile-avatar-uploads' or cut.public_bucket<>'profile-avatars'
    or cut.cutover_at+interval '7200 seconds'>clock_timestamp()
    or exists(select 1 from public.profile_avatar_uploads where user_id=uid and
      (tracking_version is distinct from 3 or signing_finished_at is null or capability_until is null
       or capability_until>clock_timestamp()
       or source_deleted_at is null or (output_path is not null and
         (output_write_finished_at is null or output_deleted_at is null))))
    or exists(select 1 from private.account_avatar_objects where user_id=uid and deleted_at is null) then
   raise exception using errcode='42501',message='Avatar closure unconfirmed';
 end if;
 update public.account_deletion_requests set progress=jsonb_set(progress,'{avatarPurge}',
   jsonb_build_object('requestId',rid,'owner',uid,'generation',generation,'marker',marker_key)) where request_id=rid;
 -- Keep public manifests until the authorized Auth cascade. This avoids any
 -- session boolean/GUC or role-name bypass for legacy DELETE statements.
end $$;
revoke all on function private.account_avatar_prepare_purge(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function private.account_avatar_prepare_purge(uuid,uuid,bigint,text) to service_role;
commit;
